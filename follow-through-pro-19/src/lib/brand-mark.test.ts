import { describe, expect, it } from "vitest";

import { containBox, isStorableMark, MAX_STORED_BYTES } from "@/lib/brand-mark";

/**
 * The canvas half of this module needs a browser, so what is asserted
 * here is the part that decides whether something is safe to store and
 * how it is fitted -- which is also the part with the security question
 * in it.
 */

describe("containBox", () => {
  it("fits a wide image without cropping it", () => {
    const { dx, dy, dw, dh } = containBox(400, 100, 192);
    expect(dw).toBe(192);
    expect(dh).toBe(48);
    expect(dx).toBe(0);
    // Letterboxed, not cropped: a crest cut to fill a square loses the
    // edges that identify it.
    expect(dy).toBe(72);
  });

  it("fits a tall image without cropping it", () => {
    const { dx, dy, dw, dh } = containBox(100, 400, 192);
    expect(dh).toBe(192);
    expect(dw).toBe(48);
    expect(dy).toBe(0);
    expect(dx).toBe(72);
  });

  it("leaves a square image alone", () => {
    expect(containBox(500, 500, 192)).toEqual({ dx: 0, dy: 0, dw: 192, dh: 192 });
  });

  it("scales a small image up rather than pinning it to a corner", () => {
    const { dw, dh } = containBox(24, 24, 192);
    expect(dw).toBe(192);
    expect(dh).toBe(192);
  });
});

describe("isStorableMark", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";

  it("accepts a rasterised data URL", () => {
    expect(isStorableMark(png)).toBe(true);
    expect(isStorableMark("data:image/webp;base64,UklGRg==")).toBe(true);
  });

  it("rejects an SVG data URL", () => {
    // Uploads may be SVG, but prepareBrandMark rasterises them, so an
    // SVG arriving here came from a hand-edited document or a synced
    // account rather than from the picker. SVG is the one image type
    // that can carry script, and this string ends up in an `img` src.
    expect(isStorableMark("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBe(false);
    expect(isStorableMark("data:image/svg+xml,<svg onload='alert(1)'/>")).toBe(false);
  });

  it("rejects anything that is not a base64 image data URL", () => {
    for (const value of [
      "https://example.com/logo.png",
      "javascript:alert(1)",
      "data:text/html;base64,PGgxPmhpPC9oMT4=",
      "",
      null,
      undefined,
      42,
      { toString: () => png },
    ]) {
      expect(isStorableMark(value), String(value)).toBe(false);
    }
  });

  it("rejects a mark too large to carry in the settings document", () => {
    expect(isStorableMark(`data:image/png;base64,${"A".repeat(MAX_STORED_BYTES)}`)).toBe(false);
  });
});
