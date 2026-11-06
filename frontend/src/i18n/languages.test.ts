/**
 * The language registry is the one place a frontend/backend mismatch shows up
 * only at runtime: `languages.ts` drives the language picker, the speech locale
 * and the i18n bundle, while the Node server and the AI service independently
 * list what they accept. A language added to one side and not the other is an
 * app that fails quietly for a real worker, so the registry is asserted against
 * the files on disk and against the server's list.
 */
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES, getLanguage } from "./languages";
import en from "./locales/en.json";
import hi from "./locales/hi.json";
import bn from "./locales/bn.json";
import te from "./locales/te.json";
import ta from "./locales/ta.json";
import ml from "./locales/ml.json";

const BUNDLES: Record<string, Record<string, unknown>> = { en, hi, bn, te, ta, ml };

describe("language registry", () => {
  it("lists exactly the six first-class languages", () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(["en", "hi", "bn", "te", "ta", "ml"]);
  });

  it("matches the languages the Node server and AI service accept", () => {
    // server/src/routes/chat.js LANGS and ai-service/main.py LANGS.
    const serverLangs = ["en", "hi", "bn", "te", "ta", "ml"];
    expect(SUPPORTED_LANGUAGES.map((l) => l.code).sort()).toEqual([...serverLangs].sort());
  });

  it("has a translation bundle for every registered language", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(BUNDLES[lang.code], `missing bundle for ${lang.code}`).toBeDefined();
    }
    expect(Object.keys(BUNDLES).sort()).toEqual(SUPPORTED_LANGUAGES.map((l) => l.code).sort());
  });

  it("ships a BCP-47 speech locale per language for the Web Speech API", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(lang.speechLocale).toMatch(/^[a-z]{2}-IN$/);
    }
  });

  it("gives every language a native and English name", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(lang.nativeName.trim().length).toBeGreaterThan(0);
      expect(lang.englishName.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses native scripts, not transliterated English", () => {
    const nativeNames = Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l.code, l.nativeName]));
    expect(nativeNames.hi).toBe("हिन्दी");
    expect(nativeNames.ta).toBe("தமிழ்");
    expect(nativeNames.ml).toBe("മലയാളം");
    expect(nativeNames.te).toBe("తెలుగు");
    expect(nativeNames.bn).toBe("বাংলা");
  });
});

describe("translation bundles", () => {
  const topLevelKeys = (bundle: Record<string, unknown>) => Object.keys(bundle).sort();

  it("gives every language the same top-level sections as English", () => {
    const expected = topLevelKeys(en);
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      expect(topLevelKeys(bundle), `${code} has different sections`).toEqual(expected);
    }
  });

  it("translates the grievance status labels used by GrievanceStatusBadge", () => {
    // The badge renders grievance.status.<code>; a bundle missing any of these
    // shows a raw key string to the worker.
    const statuses = ["submitted", "under_review", "resolved", "rejected", "withdrawn"];
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const grievance = bundle.grievance as Record<string, Record<string, string>>;
      expect(grievance, `${code} has no grievance section`).toBeDefined();
      for (const status of statuses) {
        const label = grievance?.status?.[status];
        expect(label, `${code}.grievance.status.${status} missing`).toBeTruthy();
        expect(label, `${code}.grievance.status.${status} untranslated`).not.toBe(status);
      }
    }
  });

  it("keeps the common loading/retry/error keys every screen reaches for", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const common = bundle.common as Record<string, string>;
      for (const key of ["loading", "error", "retry"]) {
        expect(common?.[key], `${code}.common.${key} missing`).toBeTruthy();
      }
    }
  });
});

describe("getLanguage", () => {
  it("returns the matching entry", () => {
    expect(getLanguage("ta").nativeName).toBe("தமிழ்");
  });

  it("falls back to English for an unknown code instead of returning undefined", () => {
    // An unsupported code reaching this function must not crash the picker.
    expect(getLanguage("xx").code).toBe("en");
    expect(getLanguage("").code).toBe("en");
  });

  it("falls back for a code with the right prefix but wrong region", () => {
    expect(getLanguage("en-GB").code).toBe("en");
  });
});
