#!/usr/bin/env node
/**
 * Locale parity gate.
 *
 * ShramSetu ships six UI languages (en, hi, bn, te, ta, ml). A worker who picks
 * Odia-shaped text but reads Bengali must never hit a raw key or an English
 * sentence in the middle of a form, so CI fails the build when:
 *
 *   1. a locale is missing a key that en.json has,
 *   2. a locale carries a key that en.json does not (stale copy), or
 *   3. a locale value is byte-identical to the English string and is longer
 *      than 12 characters, which is almost always an untranslated string
 *      rather than a genuine loanword.
 *
 * Rule 3 has an allowlist (scripts/locale-allowlist.json) for strings that are
 * legitimately the same in every language: brand names, scheme names, acronyms
 * and portal/URL fragments. Every entry needs a reason, and the reviewer's job
 * is to keep that file short.
 *
 * Usage:  node scripts/check-locales.mjs [--json]
 * Exit:   0 clean, 1 violations found.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(here, "..", "frontend", "src", "i18n", "locales");
const ALLOWLIST_PATH = path.join(here, "locale-allowlist.json");

const BASE = "en";
const MIN_UNTRANSLATED_LENGTH = 12;
const asJson = process.argv.includes("--json");

/** Flatten `{a:{b:"x"}}` to `{"a.b":"x"}` so key sets compare flat. */
function flatten(value, prefix = "", out = new Map()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

function readLocale(locale) {
  const file = path.join(LOCALES_DIR, `${locale}.json`);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`Missing locale file: ${path.relative(process.cwd(), file)}`);
  }
  try {
    return flatten(JSON.parse(raw));
  } catch (err) {
    throw new Error(`${locale}.json is not valid JSON: ${err.message}`);
  }
}

const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
const allowed = new Set(allowlist.entries.map((e) => e.key));

const base = readLocale(BASE);
const locales = ["hi", "bn", "te", "ta", "ml"];
const violations = [];

for (const locale of locales) {
  const strings = readLocale(locale);

  for (const key of base.keys()) {
    if (!strings.has(key)) {
      violations.push({ type: "missing", locale, key, detail: "key absent from this locale" });
      continue;
    }
    const translated = strings.get(key);
    const english = base.get(key);
    if (
      typeof english === "string" &&
      typeof translated === "string" &&
      translated === english &&
      english.trim().length > MIN_UNTRANSLATED_LENGTH &&
      !allowed.has(key)
    ) {
      violations.push({
        type: "untranslated",
        locale,
        key,
        detail: `still English: "${english}"`,
      });
    }
  }

  for (const key of strings.keys()) {
    if (!base.has(key)) {
      violations.push({ type: "stale", locale, key, detail: "key no longer in en.json" });
    }
  }
}

// An allowlist entry for a key that no longer exists, or that is already
// translated, is dead weight — fail so the list cannot rot.
for (const entry of allowlist.entries) {
  if (!base.has(entry.key)) {
    violations.push({
      type: "allowlist-stale",
      locale: "*",
      key: entry.key,
      detail: "allowlisted key is not in en.json",
    });
    continue;
  }
  const stillNeeded = locales.some((locale) => {
    const strings = readLocale(locale);
    return strings.get(entry.key) === base.get(entry.key);
  });
  if (!stillNeeded) {
    violations.push({
      type: "allowlist-stale",
      locale: "*",
      key: entry.key,
      detail: "allowlisted key is translated in every locale; remove the entry",
    });
  }
}

if (asJson) {
  console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
} else if (violations.length === 0) {
  console.log(
    `Locale parity OK — ${base.size} keys × ${locales.length + 1} locales ` +
      `(${allowlist.entries.length} allowlisted proper nouns).`,
  );
} else {
  const byType = violations.reduce((acc, v) => {
    (acc[v.type] ??= []).push(v);
    return acc;
  }, {});
  console.error(`Locale parity FAILED — ${violations.length} violation(s).\n`);
  for (const [type, list] of Object.entries(byType)) {
    console.error(`${type} (${list.length}):`);
    for (const v of list.slice(0, 40)) {
      console.error(`  ${v.locale.padEnd(3)} ${v.key} — ${v.detail}`);
    }
    if (list.length > 40) console.error(`  … and ${list.length - 40} more`);
    console.error("");
  }
  console.error(
    "Fix the locale files, or add a justified entry to scripts/locale-allowlist.json\n" +
      "when the string is genuinely the same in every language (brand/scheme name).\n",
  );
}

process.exit(violations.length === 0 ? 0 : 1);
