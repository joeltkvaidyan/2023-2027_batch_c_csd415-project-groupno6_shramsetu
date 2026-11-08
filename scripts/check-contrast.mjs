#!/usr/bin/env node
/**
 * Design-token gate.
 *
 * Two ways a semantic colour layer rots:
 *
 *   1. the CSS and the source of truth drift apart (someone tweaks a hex in
 *      tokens.css and the table in tokens.json still says the old one), and
 *   2. a pair someone actually renders stops meeting WCAG 2.1 — 4.5:1 for text,
 *      3:1 for UI boundaries and focus rings.
 *
 * Both are invisible in review and obvious to a worker squinting at a phone in
 * daylight, so CI checks them instead. Nothing here measures "does it look
 * nice"; it measures whether the contrast pair the app depends on still exists.
 *
 * Usage:  node scripts/check-contrast.mjs [--json]
 * Exit:   0 clean, 1 violations found.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(here, "..", "frontend", "src", "design");
const TOKENS_JSON = path.join(DESIGN_DIR, "tokens.json");
const TOKENS_CSS = path.join(DESIGN_DIR, "tokens.css");

const asJson = process.argv.includes("--json");

/** `--color-surface-raised` for the JSON key `surfaceRaised`. */
const cssVar = (name) => `--color-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

function parseCssThemes(css) {
  const themes = {};
  // Each theme is one `selector { ... }` block; :root is light, .dark is dark,
  // .hc is high contrast. Anything else (:root:lang(hi) etc.) is not a palette.
  const blockRe = /(^|\n)\s*(:root|\.dark|\.hc)\s*\{([^}]*)\}/g;
  const selectors = { ":root": "light", ".dark": "dark", ".hc": "highContrast" };
  for (const match of css.matchAll(blockRe)) {
    const values = themes[selectors[match[2]]] ?? {};
    for (const decl of match[3].matchAll(/(--color-[a-z-]+)\s*:\s*([^;]+);/g)) {
      values[decl[1]] = decl[2].trim().toLowerCase();
    }
    themes[selectors[match[2]]] = values;
  }
  return themes;
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio; symmetric, so argument order never matters. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = JSON.parse(readFileSync(TOKENS_JSON, "utf8"));
const css = readFileSync(TOKENS_CSS, "utf8");
const cssThemes = parseCssThemes(css);
const violations = [];

for (const [themeName, expected] of Object.entries(tokens.themes)) {
  const declared = cssThemes[themeName] ?? {};
  for (const [token, value] of Object.entries(expected)) {
    const raw = declared[cssVar(token)];
    if (raw === undefined) {
      violations.push(`${themeName}: tokens.css does not declare ${cssVar(token)}`);
      continue;
    }
    if (raw.replace(/\s/g, "") !== value.toLowerCase()) {
      violations.push(
        `${themeName}.${cssVar(token)}: tokens.css has ${raw}, tokens.json has ${value}`,
      );
    }
  }
  const extra = Object.keys(declared).filter((v) => !Object.keys(expected).some((t) => cssVar(t) === v));
  for (const name of extra) {
    violations.push(`${themeName}: ${name} is declared in CSS but missing from tokens.json`);
  }
}

const rows = [];
for (const [themeName, palette] of Object.entries(tokens.themes)) {
  for (const pair of tokens.pairs) {
    const fg = palette[pair.fg];
    const bg = palette[pair.bg];
    if (!fg || !bg) {
      violations.push(`${themeName}: pair ${pair.fg} on ${pair.bg} names a missing token`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const pass = ratio >= pair.min;
    rows.push({
      theme: themeName,
      pair: `${pair.fg} on ${pair.bg}`,
      ratio: Number(ratio.toFixed(2)),
      min: pair.min,
      use: pair.use,
      pass,
    });
    if (!pass) {
      violations.push(
        `${themeName}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${pair.min}:1 (${pair.use})`,
      );
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ rows, violations }, null, 2));
} else if (violations.length) {
  console.error(`Design tokens: ${violations.length} problem(s)`);
  for (const v of violations) console.error(`  ✗ ${v}`);
} else {
  const lowest = rows.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
  console.log(
    `Design tokens OK — ${rows.length} contrast pairs × ${Object.keys(tokens.themes).length} themes ` +
      `(lowest ${lowest.ratio}:1, ${lowest.pair}, ${lowest.theme})`,
  );
}

process.exit(violations.length ? 1 : 0);
