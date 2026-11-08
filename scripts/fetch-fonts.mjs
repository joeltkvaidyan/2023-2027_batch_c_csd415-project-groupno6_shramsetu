#!/usr/bin/env node
/**
 * Self-host the UI fonts.
 *
 * ShramSetu's users open it on a mid-range Android phone, often on a metered
 * connection, sometimes behind a network where fonts.googleapis.com is slow or
 * blocked outright. A Google Fonts request is a third-party round trip before
 * any text is readable, and it hands Google a log of who is reading a wage
 * complaint. So the faces are vendored into public/fonts and declared locally.
 *
 * The CSS Google serves is already split into unicode-range subsets, which is
 * what makes a six-language app affordable: a Hindi user downloads the Latin
 * subset and the Devanagari subset, never Tamil or Malayalam. We keep those
 * rules and rewrite only the URLs, so per-script loading behaviour survives.
 *
 * Usage:  node scripts/fetch-fonts.mjs
 * Writes: frontend/public/fonts/*.woff2 and frontend/src/design/fonts.css
 *
 * Re-run it when a family or weight changes — do not hand-edit fonts.css.
 */
import { mkdirSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const FONT_DIR = path.join(ROOT, "frontend", "public", "fonts");
const CSS_OUT = path.join(ROOT, "frontend", "src", "design", "fonts.css");

// One Latin face for the interface; one sans per script for the five Indian
// languages the app ships. Two weights only — 400 for body, 600 for emphasis
// and buttons — because every extra weight is another download on a phone.
const FAMILIES = [
  { query: "Inter:wght@400;500;600;700", label: "Inter" },
  { query: "Noto+Sans+Devanagari:wght@400;600", label: "NotoSansDevanagari" },
  { query: "Noto+Sans+Bengali:wght@400;600", label: "NotoSansBengali" },
  { query: "Noto+Sans+Telugu:wght@400;600", label: "NotoSansTelugu" },
  { query: "Noto+Sans+Tamil:wght@400;600", label: "NotoSansTamil" },
  { query: "Noto+Sans+Malayalam:wght@400;600", label: "NotoSansMalayalam" },
];

// A Chrome UA is what makes the API return woff2 rather than legacy formats.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const cssUrl = (query) =>
  `https://fonts.googleapis.com/css2?family=${query}&display=swap&subset=latin,latin-ext`;

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

mkdirSync(FONT_DIR, { recursive: true });
// Rebuild from scratch so a dropped weight does not linger as dead weight.
for (const file of readdirSync(FONT_DIR)) {
  if (file.endsWith(".woff2")) rmSync(path.join(FONT_DIR, file));
}

const blocks = [];
const seen = new Map();
let total = 0;

for (const family of FAMILIES) {
  const css = await fetchText(cssUrl(family.query));
  const faces = css.split("@font-face").slice(1).map((chunk) => chunk.split("}")[0]);
  if (faces.length === 0) throw new Error(`no @font-face returned for ${family.query}`);


  for (const face of faces) {
    // Google has two ways to hand back a woff2: a path ending in `.woff2`, and
    // the `l/font?kit=…` endpoint with no extension at all. Which one a node
    // returns varies between requests, so neither the extension nor the path
    // shape can be trusted — the \`format('woff2')\` on the rule is the signal.
    const src = /url\(\s*(https:\/\/[^)]+?)\s*\)\s*format\(\s*['"]woff2['"]\s*\)/.exec(face);
    const range = /unicode-range:\s*([^;]+);/.exec(face);
    const weight = /font-weight:\s*([^;]+);/.exec(face);
    const style = /font-style:\s*([^;]+);/.exec(face);
    if (!src) continue;

    const url = src[1];
    // Google returns one file per subset that covers the whole weight axis for a
    // variable family, so the same URL appears under several weights. The file
    // name therefore must NOT include the weight: a weight-specific name would
    // point the 600 face at a file that was never written. Dedupe on the URL and
    // let every weight's rule reference the single file.
    let name = seen.get(url);
    if (!name) {
      const kit = /[?&]kit=([^&]+)/.exec(url)?.[1];
      const slug = (kit ?? url.split("/").pop().split("?")[0]).replace(/[^A-Za-z0-9._-]/g, "");
      name = `${family.label}-${slug}`;
      seen.set(url, name);
      const bytes = await fetchBinary(url);
      writeFileSync(path.join(FONT_DIR, name), bytes);
      total += bytes.length;
    }

    blocks.push(
      [
        "@font-face {",
        `  font-family: "${faceFamily(face) ?? family.label.replace(/([a-z])([A-Z])/g, "$1 $2")}";`,
        `  font-style: ${style?.[1]?.trim() ?? "normal"};`,
        `  font-weight: ${weight?.[1]?.trim() ?? "400"};`,
        "  font-display: swap;",
        `  src: url("/fonts/${name}") format("woff2");`,
        range ? `  unicode-range: ${range[1].trim()};` : null,
        "}",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

/** The family name Google declared, so the CSS and our stack cannot disagree. */
function faceFamily(face) {
  return /font-family:\s*'([^']+)'/.exec(face)?.[1] ?? /font-family:\s*"([^"]+)"/.exec(face)?.[1];
}

const header = `/*
 * Vendored fonts. Generated by scripts/fetch-fonts.mjs — do not edit by hand.
 *
 * \`font-display: swap\` on every face: on a slow connection the worker reads the
 * system font immediately instead of watching a blank paragraph. The
 * unicode-range blocks are Google's subsets, so a language only downloads the
 * ranges its text actually uses.
 *
 * ${seen.size} files, ${(total / 1024 / 1024).toFixed(2)} MB total, self-hosted:
 * no third-party request, no cookie, nothing to unblock.
 */
`;

writeFileSync(CSS_OUT, header + "\n" + blocks.join("\n\n") + "\n");

const size = (dir) =>
  readdirSync(dir).reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
console.log(
  `Vendored ${seen.size} woff2 files (${(size(FONT_DIR) / 1024).toFixed(0)} kB) → ${path.relative(
    ROOT,
    CSS_OUT,
  )}`,
);
