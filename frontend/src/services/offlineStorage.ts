/**
 * Offline Storage Service using IndexedDB
 * Caches chat messages, documents, and grievance data for offline access
 */
import { openDB, IDBPDatabase } from "idb";
import { api } from "../api/client";
import { newSubmissionKey } from "../api/idempotency";
import { replayQueue, type ReplayOutcome } from "./syncReplay";

const DB_NAME = "shramsetu-offline";
const DB_VERSION = 1;

export interface CachedChatMessage {
  id: string;
  userId: number;
  role: "user" | "assistant";
  content: string;
  language: string;
  timestamp: number;
  synced: boolean;
}

export interface CachedDocument {
  id: string;
  userId: number;
  name: string;
  category: string;
  mimeType: string;
  data: ArrayBuffer;
  timestamp: number;
  synced: boolean;
}

export interface CachedGrievance {
  id: string;
  userId: number;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  timestamp: number;
  synced: boolean;
}

/** Payload of a queued write; the exact shape depends on the record type. */
export type SyncPayload = Record<string, unknown>;

export interface PendingSyncItem {
  id: string;
  type: "chat" | "document" | "grievance" | "wage";
  action: "create" | "update" | "delete";
  /**
   * `client_request_id` is assigned when the item is queued, not when it is
   * replayed: it must be the same key the original attempt would have used, or
   * the replay would file a duplicate. See api/idempotency.ts.
   */
  data: SyncPayload;
  timestamp: number;
}

/**
 * A row in the `settings` store. Two shapes share it: `{key, value}` for
 * key/value settings, and a named blob like the grievance draft, whose fields
 * sit next to `key` rather than under `value`.
 */
export interface SettingRecord {
  key: string;
  value?: unknown;
  updatedAt?: number;
  [extra: string]: unknown;
}

/** Unsent complaint form, restored when the worker comes back to the form. */
export interface GrievanceDraft {
  subject: string;
  description: string;
  category: string;
  employer_name: string;
  incident_location: string;
  incident_date: string;
}

interface OfflineDB {
  chatMessages: {
    key: string;
    value: CachedChatMessage;
    indexes: { "by-user": number };
  };
  documents: {
    key: string;
    value: CachedDocument;
    indexes: { "by-user": number; "by-category": string };
  };
  grievances: {
    key: string;
    value: CachedGrievance;
    indexes: { "by-user": number; "by-status": string };
  };
  pendingSync: {
    key: string;
    value: PendingSyncItem;
    indexes: { "by-type": string };
  };
  settings: {
    key: string;
    value: SettingRecord;
  };
}

let dbInstance: IDBPDatabase<OfflineDB> | null = null;

async function getDB(): Promise<IDBPDatabase<OfflineDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<OfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db: IDBPDatabase<OfflineDB>) {
      // Chat messages store
      const chatStore = db.createObjectStore("chatMessages", { keyPath: "id" });
      chatStore.createIndex("by-user", "userId");

      // Documents store
      const docStore = db.createObjectStore("documents", { keyPath: "id" });
      docStore.createIndex("by-user", "userId");
      docStore.createIndex("by-category", "category");

      // Grievances store
      const grievanceStore = db.createObjectStore("grievances", { keyPath: "id" });
      grievanceStore.createIndex("by-user", "userId");
      grievanceStore.createIndex("by-status", "status");

      // Pending sync queue
      const syncStore = db.createObjectStore("pendingSync", { keyPath: "id" });
      syncStore.createIndex("by-type", "type");

      // App settings
      db.createObjectStore("settings", { keyPath: "key" });
    },
  });

  return dbInstance;
}

// === Chat Messages ===

export async function cacheChatMessage(
  userId: number,
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    language: string;
  },
): Promise<void> {
  const db = await getDB();
  await db.put("chatMessages", {
    ...message,
    userId,
    timestamp: Date.now(),
    synced: true,
  });
}

export async function getCachedChatHistory(userId: number): Promise<CachedChatMessage[]> {
  const db = await getDB();
  const messages = await db.getAllFromIndex("chatMessages", "by-user", userId);
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

export async function clearCachedChatHistory(userId: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("chatMessages", "readwrite");
  const index = tx.store.index("by-user");
  let cursor = await index.openCursor(userId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

// === Documents ===

export async function cacheDocument(
  userId: number,
  doc: {
    id: string;
    name: string;
    category: string;
    mimeType: string;
    data: ArrayBuffer;
  },
): Promise<void> {
  const db = await getDB();
  await db.put("documents", {
    ...doc,
    userId,
    timestamp: Date.now(),
    synced: true,
  });
}

export async function getCachedDocuments(userId: number): Promise<CachedDocument[]> {
  const db = await getDB();
  return db.getAllFromIndex("documents", "by-user", userId);
}

export async function getCachedDocument(docId: string): Promise<CachedDocument | undefined> {
  const db = await getDB();
  return db.get("documents", docId);
}

export async function deleteCachedDocument(docId: string): Promise<void> {
  const db = await getDB();
  await db.delete("documents", docId);
}

// === Grievances ===

export async function cacheGrievance(
  userId: number,
  grievance: {
    id: string;
    subject: string;
    description: string;
    category: string;
    priority: string;
    status: string;
  },
): Promise<void> {
  const db = await getDB();
  await db.put("grievances", {
    ...grievance,
    userId,
    timestamp: Date.now(),
    synced: true,
  });
}

export async function getCachedGrievances(userId: number): Promise<CachedGrievance[]> {
  const db = await getDB();
  return db.getAllFromIndex("grievances", "by-user", userId);
}

// === Grievance Drafts ===
export async function cacheGrievanceDraft(draft: GrievanceDraft): Promise<void> {
  const db = await getDB();
  await db.put("settings", { key: "grievanceDraft", ...draft, updatedAt: Date.now() });
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export async function getCachedGrievanceDraft(): Promise<GrievanceDraft | null> {
  const db = await getDB();
  const res = await db.get("settings", "grievanceDraft");
  if (!res) return null;
  // Read field by field: a draft written by an older build may be missing
  // keys or hold a non-string, and the form expects strings throughout.
  return {
    subject: asString(res.subject),
    description: asString(res.description),
    category: asString(res.category),
    employer_name: asString(res.employer_name),
    incident_location: asString(res.incident_location),
    incident_date: asString(res.incident_date),
  };
}

export async function deleteCachedGrievanceDraft(): Promise<void> {
  const db = await getDB();
  await db.delete("settings", "grievanceDraft");
}

// === Pending Sync Queue ===

export async function addToSyncQueue(
  type: "chat" | "document" | "grievance" | "wage",
  action: "create" | "update" | "delete",
  data: SyncPayload,
): Promise<void> {
  const db = await getDB();
  await db.put("pendingSync", {
    id: `${type}-${action}-${Date.now()}`,
    type,
    action,
    // A queued create is one intent: it keeps its key until the server has it.
    // A key the caller already generated wins, so the queued write and the
    // attempt that failed share one identity.
    data:
      action === "create"
        ? {
            ...data,
            client_request_id: (data.client_request_id as string | undefined) || newSubmissionKey(),
          }
        : data,
    timestamp: Date.now(),
  });
}

export async function getPendingSyncItems(): Promise<PendingSyncItem[]> {
  const db = await getDB();
  return db.getAll("pendingSync");
}

export async function removeSyncItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("pendingSync", id);
}

// === Settings ===

export async function saveSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put("settings", { key, value });
}

export async function getSetting(key: string): Promise<unknown> {
  const db = await getDB();
  const result = await db.get("settings", key);
  return result?.value ?? null;
}

// === Network Status ===

export function isOnline(): boolean {
  return navigator.onLine;
}

export function onOnlineStatusChange(callback: (online: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}

// === Sync Queue Processor ===

let replaying: Promise<ReplayOutcome | null> | null = null;

/**
 * Send queued writes, then remove only the ones the server accounted for.
 * Concurrent callers share one run: a burst of `online` events must not send the
 * same queued grievance several times at once.
 */
export function processSyncQueue(): Promise<ReplayOutcome | null> {
  if (!isOnline()) return Promise.resolve(null);
  if (replaying) return replaying;
  replaying = (async () => {
    const outcome = await replayQueue(await getPendingSyncItems(), (target, body) =>
      api.request({ method: target.method, url: target.url, data: body }),
    );
    for (const id of [...outcome.sent, ...outcome.dropped]) {
      await removeSyncItem(id);
    }
    if (outcome.dropped.length > 0) {
      // Dropped means the server refused it; a quiet drop would hide a complaint
      // that never reached the labour office.
      console.warn("[offline] dropped unreplayable queued writes:", outcome.dropped);
    }
    return outcome;
  })().finally(() => {
    replaying = null;
  });
  return replaying;
}

// Auto-sync when coming back online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void processSyncQueue();
  });
}
