/**
 * Text size is one of the few settings that must survive a reload and apply
 * before the first paint — a worker who set A++ and then gets 17px back on the
 * next visit will conclude the button does nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyTextScale, readTextScale, scaleValue, writeTextScale } from "./textScale";

describe("text scale", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.textScale;
  });

  it("defaults to the base step when nothing is stored", () => {
    expect(readTextScale()).toBe("base");
  });

  it("round-trips a stored choice", () => {
    writeTextScale("largest");
    expect(readTextScale()).toBe("largest");
  });

  it("ignores a corrupt or unknown stored value instead of scaling to NaN", () => {
    // A value from an older build, or a truncated write, must not become 1.3×
    // of NaN — which would collapse the whole page to a default 16px.
    localStorage.setItem("shramsetu.textScale", JSON.stringify({ value: "huge" }));
    expect(readTextScale()).toBe("base");
    localStorage.setItem("shramsetu.textScale", "{not json");
    expect(readTextScale()).toBe("base");
  });

  it("sets the root custom property the stylesheet multiplies against", () => {
    applyTextScale("large");
    expect(document.documentElement.style.getPropertyValue("--text-scale")).toBe("1.15");
    expect(document.documentElement.dataset.textScale).toBe("large");
    expect(scaleValue("largest")).toBe(1.3);
  });

  it("does nothing when there is no document to write to", () => {
    expect(() => applyTextScale("base", null)).not.toThrow();
  });
});
