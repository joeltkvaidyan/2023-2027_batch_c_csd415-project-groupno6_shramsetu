/**
 * Offline Storage Service using IndexedDB
 * Caches chat messages, documents, and grievance data for offline access
 */
import { openDB, IDBPDatabase } from "idb";

const DB_NAME = "shramsetu-offline";
const DB_VERSION = 1;

interface OfflineDB {
  chatMessages: {
    key: string;
    value: {
      id: string;
      userId: number;
      role: "user" | "assistant";
      content: string;
      language: string;
      timestamp: number;
      synced: boolean;
    };
    indexes: { "by-user": number };
  };
  documents: {
    key: string;
    value: {
      id: string;
      userId: number;
      name: string;
      category: string;
      mimeType: string;
      data: ArrayBuffer;
      timestamp: number;
      synced: boolean;
    };
    indexes: { "by-user": number; "by-category": string };
  };
  grievances: {
    key: string;
    value: {
      id: string;
      userId: number;
      subject: string;
      description: string;
      category: string;
      priority: string;
      status: string;
      timestamp: number;
      synced: boolean;
    };
    indexes: { "by-user": number; "by-status": string };
  };
  pendingSync: {
    key: string;
    value: {
      id: string;
      type: "chat" | "document" | "grievance";
      action: "create" | "update" | "delete";
      data: any;
      timestamp: number;
    };
    indexes: { "by-type": string };
  };
  settings: {
    key: string;
    value: any;
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
  }
): Promise<void> {
  const db = await getDB();
  await db.put("chatMessages", {
    ...message,
    userId,
    timestamp: Date.now(),
    synced: true,
  });
}

export async function getCachedChatHistory(userId: number): Promise<Array<{
  id: string;
  userId: number;
  role: "user" | "assistant";
  content: string;
  language: string;
  timestamp: number;
  synced: boolean;
}>> {
  const db = await getDB();
  const messages = await db.getAllFromIndex("chatMessages", "by-user", userId);
  return messages.sort((a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp);
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
  }
): Promise<void> {
  const db = await getDB();
  await db.put("documents", {
    ...doc,
    userId,
    timestamp: Date.now(),
    synced: true,
  });
}

export async function getCachedDocuments(userId: number): Promise<any[]> {
  const db = await getDB();
  return db.getAllFromIndex("documents", "by-user", userId);
}

export async function getCachedDocument(docId: string): Promise<any | null> {
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
  }
): Promise<void> {
  const db = await getDB();
  await db.put("grievances", {
    ...grievance,
    userId,
    timestamp: Date.now(),
    synced: true,
  });
}

export async function getCachedGrievances(userId: number): Promise<any[]> {
  const db = await getDB();
  return db.getAllFromIndex("grievances", "by-user", userId);
}

// === Grievance Drafts ===
export async function cacheGrievanceDraft(draft: any): Promise<void> {
  const db = await getDB();
  await db.put("settings", { key: "grievanceDraft", ...draft, updatedAt: Date.now() });
}

export async function getCachedGrievanceDraft(): Promise<any | null> {
  const db = await getDB();
  const res = await db.get("settings", "grievanceDraft");
  return res || null;
}

export async function deleteCachedGrievanceDraft(): Promise<void> {
  const db = await getDB();
  await db.delete("settings", "grievanceDraft");
}

// === Pending Sync Queue ===

export async function addToSyncQueue(
  type: "chat" | "document" | "grievance",
  action: "create" | "update" | "delete",
  data: any
): Promise<void> {
  const db = await getDB();
  await db.put("pendingSync", {
    id: `${type}-${action}-${Date.now()}`,
    type,
    action,
    data,
    timestamp: Date.now(),
  });
}

export async function getPendingSyncItems(): Promise<Array<{
  id: string;
  type: "chat" | "document" | "grievance";
  action: "create" | "update" | "delete";
  data: Record<string, unknown>;
  timestamp: number;
}>> {
  const db = await getDB();
  return db.getAll("pendingSync");
}

export async function removeSyncItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("pendingSync", id);
}

// === Settings ===

export async function saveSetting(key: string, value: any): Promise<void> {
  const db = await getDB();
  await db.put("settings", { key, value });
}

export async function getSetting(key: string): Promise<any | null> {
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

export async function processSyncQueue(): Promise<void> {
  if (!isOnline()) return;

  const items = await getPendingSyncItems();
  for (const item of items) {
    try {
      // Process based on type and action
      console.log(`[OfflineSync] Processing: ${item.type} ${item.action}`);
      await removeSyncItem(item.id);
    } catch (error) {
      console.error(`[OfflineSync] Failed to process item ${item.id}:`, error);
    }
  }
}

// Auto-sync when coming back online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("[OfflineSync] Back online, processing queue...");
    processSyncQueue();
  });
}
