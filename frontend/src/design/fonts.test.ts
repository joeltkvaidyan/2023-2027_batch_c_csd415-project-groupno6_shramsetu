/**
 * The font stylesheet is generated from a remote API, so it can rot in ways
 * nothing else notices: a reference to a file that was never written (a real bug
 * this caught — weight-specific names for a shared variable-font file), a face
 * pointing at someone else's server, or a missing `font-display` that leaves a
 * worker staring at invisible text on a slow connection.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CSS = readFileSync(path.join(ROOT, "src/design/fonts.css"), "utf8");
const FONT_DIR = path.join(ROOT, "public/fonts");

const faces = CSS.split("@font-face")
  .slice(1)
  .map((chunk) => chunk.split("}")[0]);
const references = new Set(
  [...CSS.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((match) => match[1]),
);
const onDisk = new Set(readdirSync(FONT_DIR).map((file) => `/fonts/${file}`));

describe("vendored fonts", () => {
  it("declares a face for every language the app ships", () => {
    const families = new Set(
      [...CSS.matchAll(/font-family:\s*"([^"]+)"/g)].map((match) => match[1]),
    );
    for (const family of [
      "Inter",
      "Noto Sans Devanagari",
      "Noto Sans Bengali",
      "Noto Sans Telugu",
      "Noto Sans Tamil",
      "Noto Sans Malayalam",
    ]) {
      expect(families, `${family} has no @font-face`).toContain(family);
    }
  });

  it("points only at files that exist in public/fonts", () => {
    const missing = [...references].filter((url) => !existsSync(path.join(ROOT, "public", url)));
    expect(missing).toEqual([]);
  });

  it("ships no unused font file", () => {
    expect([...onDisk].filter((file) => !references.has(file))).toEqual([]);
  });

  it("never fetches a font from a third party", () => {
    expect(CSS).not.toMatch(/@font-face[\s\S]{0,400}https:\/\//);
  });

  it("swaps to the system font instead of hiding text while loading", () => {
    for (const face of faces) {
      expect(face).toContain("font-display: swap");
      expect(face).toContain('format("woff2")');
    }
  });
});
