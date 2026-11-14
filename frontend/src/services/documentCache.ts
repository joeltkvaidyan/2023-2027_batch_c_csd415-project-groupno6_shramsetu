/**
 * Offline document cache, encrypted at rest.
 *
 * Workers cache Aadhaar cards, wage slips and bank proofs so they can show them
 * at a site with no signal. The previous version wrote those blobs into
 * IndexedDB in the clear, where any script — or anyone with the device unlocked
 * and a devtools tab — could read them; the PIN only hid the list in the UI.
 *
 * Now each blob is AES-256-GCM encrypted with a key derived from the wallet PIN
 * (PBKDF2-SHA256, 310k iterations, device salt in a separate store). The PIN is
 * only ever in memory, so the ciphertext is unreadable once the wallet locks or
 * the page closes, and a wrong PIN derives a wrong key that fails the GCM tag
 * instead of returning garbage.
 *
 * The v1 store held plaintext, so opening it deletes it outright rather than
 * migrating: there is nothing worth preserving from cleartext, and dropping it
 * is the only way to guarantee those bytes are gone.
 */
import { getSessionPin, onWalletLock } from "./documentSecurity";

const DB_NAME = "shramsetu-documents";
const DB_VERSION = 2;
const STORE_NAME = "docs";
const META_STORE = "meta";
const SALT_KEY = "cache_salt";

/** Cache ceiling. Above this the least recently used documents are dropped. */
export const MAX_CACHE_BYTES = 50 * 1024 * 1024;

/** OWASP 2023 guidance for PBKDF2-SHA256. */
const PBKDF2_ITERATIONS = 310_000;

export interface CachedDocument {
  id: number;
  display_name: string;
  content_type: string;
  size_bytes: number;
  blob: Blob;
  cached_at: number;
  last_used: number;
}

interface StoredDocument {
  id: number;
  display_name: string;
  content_type: string;
  size_bytes: number;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  cached_at: number;
  last_used: number;
}

interface SizeEntry {
  id: number;
  size_bytes: number;
  last_used: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Any pre-v2 store is plaintext; drop it rather than migrate it.
      if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDB();
  try {
    const tx = db.transaction(storeName, mode);
    const result = await fn(tx.objectStore(storeName));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getOrCreateSalt(): Promise<Uint8Array> {
  const existing = await withStore(META_STORE, "readonly", (store) =>
    requestToPromise(store.get(SALT_KEY) as IDBRequest<string | undefined>),
  );
  if (existing) return base64ToBytes(existing);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  await withStore(META_STORE, "readwrite", (store) => store.put(bytesToBase64(salt), SALT_KEY));
  return salt;
}

/** PBKDF2-SHA256 → AES-256-GCM key. Not extractable: JS cannot read the bytes. */
export async function deriveCacheKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: ArrayBuffer,
): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    plaintext,
  );
  return { iv, ciphertext };
}

export async function decryptBytes(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: ArrayBuffer,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    ciphertext,
  );
}

let cachedKey: { pin: string; key: CryptoKey } | null = null;

/** Derived key for the PIN in memory, or null when the wallet is locked. */
async function currentKey(): Promise<CryptoKey | null> {
  const pin = getSessionPin();
  if (!pin) return null;
  if (cachedKey && cachedKey.pin === pin) return cachedKey.key;
  const key = await deriveCacheKey(pin, await getOrCreateSalt());
  cachedKey = { pin, key };
  return key;
}

function forgetKey() {
  cachedKey = null;
}

// A locked wallet must not keep a usable key in memory either.
onWalletLock(forgetKey);

/**
 * Which documents to drop so `incoming` bytes fit inside `maxBytes`. Oldest
 * `last_used` first, touching only as many as needed.
 */
export function selectEvictions(
  entries: SizeEntry[],
  incoming: number,
  maxBytes: number = MAX_CACHE_BYTES,
): number[] {
  let total = entries.reduce((sum, entry) => sum + entry.size_bytes, 0) + incoming;
  if (total <= maxBytes) return [];

  const victims: number[] = [];
  for (const entry of [...entries].sort((a, b) => a.last_used - b.last_used)) {
    if (total <= maxBytes) break;
    victims.push(entry.id);
    total -= entry.size_bytes;
  }
  return victims;
}

/**
 * Cache a document for offline access. Throws when the wallet is locked (no
 * PIN in memory ⇒ no key) or the document can never fit.
 */
export async function cacheDocument(
  id: number,
  display_name: string,
  content_type: string,
  size_bytes: number,
  blob: Blob,
): Promise<void> {
  if (size_bytes > MAX_CACHE_BYTES) {
    throw new Error("Document is larger than the offline cache limit");
  }
  const key = await currentKey();
  if (!key) throw new Error("Unlock the wallet with your PIN to cache documents offline");

  const plaintext = await blob.arrayBuffer();
  const { iv, ciphertext } = await encryptBytes(key, plaintext);

  const existing = await listEntries();
  const others = existing.filter((entry) => entry.id !== id);
  for (const victim of selectEvictions(others, ciphertext.byteLength)) {
    await removeCachedDocument(victim);
  }

  const record: StoredDocument = {
    id,
    display_name,
    content_type,
    size_bytes,
    iv,
    ciphertext,
    cached_at: Date.now(),
    last_used: Date.now(),
  };
  await withStore(STORE_NAME, "readwrite", (store) => store.put(record));
}

/** All cached records, metadata only — never decrypts. */
async function listEntries(): Promise<SizeEntry[]> {
  const records = await withStore(STORE_NAME, "readonly", (store) =>
    requestToPromise(store.getAll() as IDBRequest<StoredDocument[]>),
  );
  return records.map(({ id, size_bytes, last_used }) => ({ id, size_bytes, last_used }));
}

/**
 * Read a cached document, decrypting it. Returns null when nothing is cached,
 * or when the wallet is locked — there is no key then, by design.
 */
export async function getCachedDocument(id: number): Promise<CachedDocument | null> {
  const key = await currentKey();
  if (!key) return null;

  const record = await withStore(STORE_NAME, "readonly", (store) =>
    requestToPromise(store.get(id) as IDBRequest<StoredDocument | undefined>),
  );
  if (!record) return null;

  let plaintext: ArrayBuffer;
  try {
    plaintext = await decryptBytes(key, record.iv, record.ciphertext);
  } catch {
    // Wrong PIN or tampered record: treat as a cache miss rather than handing
    // back bytes whose integrity failed.
    return null;
  }

  const last_used = Date.now();
  await withStore(STORE_NAME, "readwrite", (store) => store.put({ ...record, last_used }));

  return {
    id: record.id,
    display_name: record.display_name,
    content_type: record.content_type,
    size_bytes: record.size_bytes,
    blob: new Blob([plaintext], { type: record.content_type }),
    cached_at: record.cached_at,
    last_used,
  };
}

export async function isDocumentCached(id: number): Promise<boolean> {
  return (await getCachedDocumentIds()).includes(id);
}

export async function getCachedDocumentIds(): Promise<number[]> {
  const entries = await listEntries();
  return entries.map((entry) => entry.id);
}

export async function removeCachedDocument(id: number): Promise<void> {
  await withStore(STORE_NAME, "readwrite", (store) => store.delete(id));
}

/**
 * Drop every document and rotate the salt, so any copy of the old ciphertext
 * that survives is undecryptable even with the same PIN.
 */
export async function clearAllCachedDocuments(): Promise<void> {
  forgetKey();
  await withStore(STORE_NAME, "readwrite", (store) => store.clear());
  await withStore(META_STORE, "readwrite", (store) => store.delete(SALT_KEY));
}

/** Bytes currently held, from the stored metadata. */
export async function getCacheSizeEstimate(): Promise<number> {
  const entries = await listEntries();
  return entries.reduce((sum, entry) => sum + entry.size_bytes, 0);
}
