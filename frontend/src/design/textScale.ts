/**
 * Text size control (A / A+ / A++).
 *
 * The base font is 17px and every dimension in the app is in rem, so scaling the
 * document root scales text *and* tap targets together — a worker who needs
 * larger type also gets easier-to-hit buttons, which is the point.
 *
 * The choice is stored in localStorage and applied before React renders (see
 * main.tsx) so the page never paints at the wrong size and then jumps.
 */
import { readJson, writeJson } from "../utils/storage";

export type TextScale = "base" | "large" | "largest";

export const TEXT_SCALES: { value: TextScale; label: string; scale: number }[] = [
  { value: "base", label: "A", scale: 1 },
  { value: "large", label: "A+", scale: 1.15 },
  { value: "largest", label: "A++", scale: 1.3 },
];

const STORAGE_KEY = "shramsetu.textScale";

const isTextScale = (value: unknown): value is TextScale =>
  value === "base" || value === "large" || value === "largest";

export function readTextScale(): TextScale {
  // Stored as an object because the shared safe reader only trusts JSON
  // objects — a bare string there would silently read back as the default.
  const stored = readJson<{ value?: unknown }>(STORAGE_KEY, {});
  return isTextScale(stored.value) ? stored.value : "base";
}

export function scaleValue(scale: TextScale): number {
  return TEXT_SCALES.find((s) => s.value === scale)?.scale ?? 1;
}

/** Sets the root custom property the stylesheet multiplies its base size by. */
export function applyTextScale(scale: TextScale, root: HTMLElement | null = null): void {
  const el = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!el) return;
  el.style.setProperty("--text-scale", String(scaleValue(scale)));
  // Exposed so automated checks (and a developer) can read the current step.
  el.dataset.textScale = scale;
}

export function writeTextScale(scale: TextScale): void {
  writeJson(STORAGE_KEY, { value: scale });
  applyTextScale(scale);
}
