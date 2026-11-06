/**
 * Offline document cache using IndexedDB.
 * Stores document blobs locally so workers can view their documents
 * even without internet connectivity (e.g. at construction sites).
 */

const DB_NAME = "shramsetu-documents";
const DB_VERSION = 1;
const STORE_NAME = "docs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface CachedDocument {
  id: number;
  display_name: string;
  content_type: string;
  size_bytes: number;
  blob: Blob;
  cached_at: number; // timestamp
}

/**
 * Cache a document blob for offline access.
 */
export async function cacheDocument(
  id: number,
  display_name: string,
  content_type: string,
  size_bytes: number,
  blob: Blob,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      id,
      display_name,
      content_type,
      size_bytes,
      blob,
      cached_at: Date.now(),
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Get a cached document blob.
 */
export async function getCachedDocument(id: number): Promise<CachedDocument | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Check if a document is cached.
 */
export async function isDocumentCached(id: number): Promise<boolean> {
  const doc = await getCachedDocument(id);
  return doc !== null;
}

/**
 * Get all cached document IDs.
 */
export async function getCachedDocumentIds(): Promise<number[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    request.onsuccess = () => {
      db.close();
      resolve(request.result as number[]);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Remove a cached document.
 */
export async function removeCachedDocument(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Clear all cached documents.
 */
export async function clearAllCachedDocuments(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Get total cache size estimate.
 */
export async function getCacheSizeEstimate(): Promise<number> {
  const docs = await getCachedDocumentIds();
  let total = 0;
  for (const id of docs) {
    const doc = await getCachedDocument(id);
    if (doc) total += doc.size_bytes;
  }
  return total;
}
