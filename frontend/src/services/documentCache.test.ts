/**
 * Offline cache encryption.
 *
 * jsdom has no IndexedDB, so these tests cover the parts that carry the
 * security guarantee — key derivation, AES-GCM round trip, tamper detection and
 * the LRU decision — against the real WebCrypto, plus the "locked wallet"
 * behaviour that keeps cached bytes unreadable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = { pin: null as string | null };

vi.mock("./documentSecurity", () => ({
  getSessionPin: () => session.pin,
  onWalletLock: () => () => {},
}));

const cache = await import("./documentCache");

const PIN = "4821";
const SALT = new Uint8Array(16).fill(7);

beforeEach(() => {
  session.pin = null;
});

afterEach(() => {
  session.pin = null;
});

describe("key derivation", () => {
  it("round-trips a blob with the same PIN and salt", async () => {
    const key = await cache.deriveCacheKey(PIN, SALT);
    const plaintext = new TextEncoder().encode("%PDF-1.4 wage slip").buffer;

    const { iv, ciphertext } = await cache.encryptBytes(key, plaintext);
    const decrypted = await cache.decryptBytes(key, iv, ciphertext);

    expect(new Uint8Array(decrypted)).toEqual(new Uint8Array(plaintext));
  });

  it("does not leave the plaintext readable in the ciphertext", async () => {
    const key = await cache.deriveCacheKey(PIN, SALT);
    const plaintext = new TextEncoder().encode("AADHAAR 1234 5678 9012").buffer;

    const { ciphertext } = await cache.encryptBytes(key, plaintext);

    expect(new TextDecoder().decode(ciphertext)).not.toContain("AADHAAR");
  });

  it("fails to decrypt with a different PIN", async () => {
    const key = await cache.deriveCacheKey(PIN, SALT);
    const wrongKey = await cache.deriveCacheKey("0000", SALT);
    const { iv, ciphertext } = await cache.encryptBytes(key, new ArrayBuffer(32));

    await expect(cache.decryptBytes(wrongKey, iv, ciphertext)).rejects.toThrow();
  });

  it("fails to decrypt with a different salt (salt is not cosmetic)", async () => {
    const key = await cache.deriveCacheKey(PIN, SALT);
    const otherSalt = new Uint8Array(16).fill(9);
    const otherKey = await cache.deriveCacheKey(PIN, otherSalt);
    const { iv, ciphertext } = await cache.encryptBytes(key, new ArrayBuffer(32));

    await expect(cache.decryptBytes(otherKey, iv, ciphertext)).rejects.toThrow();
  });

  it("rejects a tampered ciphertext instead of returning modified bytes", async () => {
    const key = await cache.deriveCacheKey(PIN, SALT);
    const { iv, ciphertext } = await cache.encryptBytes(key, new ArrayBuffer(64));

    new Uint8Array(ciphertext)[10] ^= 0xff;

    await expect(cache.decryptBytes(key, iv, ciphertext)).rejects.toThrow();
  });

  it("uses a fresh IV for every encryption of the same bytes", async () => {
    const key = await cache.deriveCacheKey(PIN, SALT);
    const plaintext = new ArrayBuffer(16);

    const a = await cache.encryptBytes(key, plaintext);
    const b = await cache.encryptBytes(key, plaintext);

    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
    expect(new Uint8Array(a.ciphertext)).not.toEqual(new Uint8Array(b.ciphertext));
  });
});

describe("locked wallet", () => {
  it("refuses to cache while locked — there is no key without the PIN", async () => {
    await expect(
      cache.cacheDocument(1, "aadhaar.pdf", "application/pdf", 1024, new Blob([new Uint8Array(8)])),
    ).rejects.toThrow("Unlock the wallet");
  });

  it("returns nothing for a cached document while locked, without even reading storage", async () => {
    session.pin = null;
    // No IndexedDB is defined in this environment: reaching storage at all
    // would throw, which is exactly what must not happen here.
    expect(await cache.getCachedDocument(1)).toBeNull();
  });

  it("refuses a document larger than the whole cache", async () => {
    session.pin = PIN;
    await expect(
      cache.cacheDocument(
        1,
        "huge.pdf",
        "application/pdf",
        cache.MAX_CACHE_BYTES + 1,
        new Blob([]),
      ),
    ).rejects.toThrow("larger than the offline cache limit");
  });
});

describe("LRU eviction", () => {
  const MB = 1024 * 1024;

  it("keeps everything when the new document fits", () => {
    const entries = [{ id: 1, size_bytes: 10 * MB, last_used: 1 }];
    expect(cache.selectEvictions(entries, 5 * MB, 50 * MB)).toEqual([]);
  });

  it("drops the least recently used documents first", () => {
    const entries = [
      { id: 1, size_bytes: 20 * MB, last_used: 300 },
      { id: 2, size_bytes: 20 * MB, last_used: 100 },
      { id: 3, size_bytes: 20 * MB, last_used: 200 },
    ];
    // 60 MB + 10 MB = 70 MB, need to shed 20 MB: only the oldest is enough.
    expect(cache.selectEvictions(entries, 10 * MB, 50 * MB)).toEqual([2]);
  });

  it("evicts as many as needed and no more", () => {
    const entries = [
      { id: 1, size_bytes: 20 * MB, last_used: 100 },
      { id: 2, size_bytes: 20 * MB, last_used: 200 },
      { id: 3, size_bytes: 20 * MB, last_used: 300 },
    ];
    expect(cache.selectEvictions(entries, 25 * MB, 50 * MB)).toEqual([1, 2]);
  });

  it("empties the cache when one document needs all of it", () => {
    const entries = [
      { id: 1, size_bytes: 10 * MB, last_used: 100 },
      { id: 2, size_bytes: 10 * MB, last_used: 200 },
    ];
    expect(cache.selectEvictions(entries, 50 * MB, 50 * MB)).toEqual([1, 2]);
  });
});
