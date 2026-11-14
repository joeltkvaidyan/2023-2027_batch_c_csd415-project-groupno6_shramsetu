/**
 * Reading a value that came back from localStorage must never throw.
 *
 * `JSON.parse(localStorage.getItem(k) || "{}")` is the tempting one-liner, and
 * it crashes the page in two ordinary situations: a truncated write (the tab
 * was closed mid-write, or storage was cleared between tabs) and a value that
 * is valid JSON but not the shape we expect. A dashboard that dies on a corrupt
 * cache entry is a dashboard the user cannot use to fix it, so every read falls
 * back instead.
 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return fallback;
    return parsed as T;
  } catch {
    // Unreadable (private mode) or unparsable (corrupt): drop it so the next
    // write starts clean rather than failing on the same bytes again.
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing else to do */
    }
    return fallback;
  }
}

/** Best-effort write: storage being unavailable must not break a page. */
export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — the server remains the source of truth */
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to remove */
  }
}
