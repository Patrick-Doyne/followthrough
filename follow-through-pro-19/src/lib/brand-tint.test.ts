import { describe, expect, it } from "vitest";

import { brandTint, tintPixels } from "@/lib/brand-tint";
import { hexToOklch } from "@/lib/color";
import { DEFAULT_TRIAD } from "@/lib/theme";

/** A violet accent: the furthest the picker gets from the shipped orange. */
const VIOLET = brandTint("oklch(0.7 0.19 300)", DEFAULT_TRIAD.accent);

/** The shipped accent, which is the case that must stay untouched. */
const SHIPPED = brandTint(DEFAULT_TRIAD.accent, DEFAULT_TRIAD.accent);

function pixels(...rgba: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(rgba);
}

function hexAt(data: Uint8ClampedArray, i = 0): string {
  const byte = (v: number) => v.toString(16).padStart(2, "0");
  return `#${byte(data[i]!)}${byte(data[i + 1]!)}${byte(data[i + 2]!)}`;
}

describe("tintPixels", () => {
  it("leaves the artwork alone on the shipped accent", () => {
    const data = pixels(255, 140, 0, 255, 12, 34, 56, 128);
    const before = [...data];
    tintPixels(data, SHIPPED);
    expect([...data]).toEqual(before);
  });

  it("moves a warm pixel onto the accent's hue and keeps its lightness", () => {
    const data = pixels(255, 140, 0, 255);
    const source = hexToOklch("#ff8c00")!;
    tintPixels(data, VIOLET);
    const mapped = hexToOklch(hexAt(data))!;

    // Lightness is the artwork's depth, and the shipped file is already
    // built at the accent tokens' own lightness, so there is nothing
    // left to correct here -- see scripts/gen-brand-assets.ts.
    expect(mapped.l).toBeCloseTo(source.l, 2);
    expect(((mapped.h - source.h - VIOLET.dh) % 360) + 360).toBeCloseTo(360, 0);
  });

  it("leaves greys grey, so the silver wordmark survives every accent", () => {
    const data = pixels(200, 200, 200, 255);
    const before = hexToOklch("#c8c8c8")!;
    tintPixels(data, VIOLET);
    const after = hexToOklch(hexAt(data))!;
    // Chroma is scaled, so a pixel with none keeps none, and lightness
    // is untouched -- the silver survives every accent.
    expect(after.c).toBeLessThan(0.005);
    expect(after.l).toBeCloseTo(before.l, 2);
  });

  it("never touches alpha, and skips what is fully transparent", () => {
    const data = pixels(255, 140, 0, 200, 255, 140, 0, 0);
    tintPixels(data, VIOLET);
    expect(data[3]).toBe(200);
    expect(data[7]).toBe(0);
    // The transparent pixel keeps its stored colour: with the artwork
    // unpremultiplied there is nothing there to look at anyway.
    expect([data[4], data[5], data[6]]).toEqual([255, 140, 0]);
  });
});
