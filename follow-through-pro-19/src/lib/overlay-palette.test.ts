import { describe, expect, it } from "vitest";

import { hexToOklch, parseOklch } from "@/lib/color";
import {
  isIdentityMap,
  mapWarmHex,
  overlayAccentMap,
  OVERLAY_ACCENT_IDENTITY,
} from "@/lib/overlay-palette";
import { DEFAULT_TRIAD, THEME_PRESETS } from "@/lib/theme";

/** Every warm colour the overlay artwork draws with, measured from it. */
const WARM = [
  "#2a1400",
  "#4a2400",
  "#5c2f00",
  "#5e2f00",
  "#a55200",
  "#af5f00",
  "#b25a00",
  "#bd6200",
  "#c96a00",
  "#ff8c00",
  "#ff9410",
  "#ffb249",
  "#ffd071",
  "#ffd992",
  "#ffd9a0",
  "#ffe0b0",
  "#ffe2a8",
  "#fff3d6",
  "#fff3d8",
];

describe("overlayAccentMap", () => {
  it("leaves the shipped accent exactly where it is", () => {
    // The one case that must be pixel-for-pixel: a user who changed
    // nothing sees exactly the overlay that was approved.
    const map = overlayAccentMap(DEFAULT_TRIAD.accent, DEFAULT_TRIAD.accent);
    expect(isIdentityMap(map)).toBe(true);
    for (const hex of WARM) expect(mapWarmHex(hex, map)).toBe(hex);
  });

  it("falls back to the identity rather than throwing on a bad value", () => {
    expect(overlayAccentMap("not a colour", DEFAULT_TRIAD.accent)).toEqual(OVERLAY_ACCENT_IDENTITY);
    expect(mapWarmHex("not a colour", { dh: 40, cr: 1 })).toBe("not a colour");
  });

  it("carries the accent's own chroma across as a ratio", () => {
    // A less saturated accent should mute the overlay with it rather than
    // leave it as vivid as the default.
    const blue = THEME_PRESETS.find((p) => p.label === "Baseline blue")!;
    const map = overlayAccentMap(blue.triad.accent, DEFAULT_TRIAD.accent);
    const accent = parseOklch(blue.triad.accent)!;
    const dflt = parseOklch(DEFAULT_TRIAD.accent)!;
    expect(map.cr).toBeCloseTo(accent.c / dflt.c, 6);
    expect(map.cr).toBeLessThan(1);
  });
});

describe("mapWarmHex", () => {
  it("holds every colour's perceptual lightness, for every shipped theme", () => {
    /*
     * This is the regression test for the bug this module was rewritten
     * to fix. The first version rotated hue in HSL, whose "lightness" is
     * not lightness: mapping the artwork's core orange #ff8c00 onto the
     * Lane red preset took it from OKLCH L 0.751 to 0.643 -- eleven
     * points darker -- while the pale highlights moved by three. The
     * report was exactly that shape: "the red is noticeably darker and
     * the other colors are more or less accurate."
     *
     * A whole-point tolerance would have passed the broken version, so
     * this asserts two decimal places.
     */
    for (const preset of THEME_PRESETS) {
      const map = overlayAccentMap(preset.triad.accent, DEFAULT_TRIAD.accent);
      for (const hex of WARM) {
        const before = hexToOklch(hex)!.l;
        const after = hexToOklch(mapWarmHex(hex, map))!.l;
        expect(after, `${preset.label} ${hex}`).toBeCloseTo(before, 2);
      }
    }
  });

  it("moves every colour by the same hue offset, keeping the family together", () => {
    // The ramp from #2a1400 to #fff3d6 is what gives the overlay depth.
    // Mapping each colour independently would flatten it.
    const map = { dh: 160, cr: 1 };
    const offsets = WARM.map((hex) => {
      const before = hexToOklch(hex)!.h;
      const after = hexToOklch(mapWarmHex(hex, map))!.h;
      return ((after - before + 540) % 360) - 180;
    });
    /*
     * Not exactly equal, and the reason is 8-bit hex rather than the
     * mapping. The two ends of the ramp are where a byte per channel says
     * least about hue: #2a1400 is near black and #fff3d8 is near white
     * with a chroma of 0.04, so one step of rounding moves their measured
     * hue by a degree. Measured spread across the family is 2.23 degrees
     * out of a 160-degree move, all of it at those ends.
     */
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(3);
  });

  it("keeps the ramp in order for every shipped theme", () => {
    // The overlay reads as lit because its colours ramp. If a mapping
    // ever reordered that ramp the artwork would come apart.
    const ordered = [...WARM].sort((a, b) => hexToOklch(a)!.l - hexToOklch(b)!.l);
    for (const preset of THEME_PRESETS) {
      const map = overlayAccentMap(preset.triad.accent, DEFAULT_TRIAD.accent);
      const ls = ordered.map((hex) => hexToOklch(mapWarmHex(hex, map))!.l);
      for (let i = 1; i < ls.length; i += 1) {
        expect(ls[i], `${preset.label} ${ordered[i]}`).toBeGreaterThanOrEqual(
          (ls[i - 1] as number) - 0.005,
        );
      }
    }
  });

  it("produces a valid six-digit hex at any hue offset", () => {
    for (let dh = -180; dh <= 180; dh += 15) {
      for (const hex of WARM) {
        expect(mapWarmHex(hex, { dh, cr: 1 })).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("keeps most of the artwork's chroma rather than washing it out", () => {
    // Holding lightness means chroma is the channel that gives way when a
    // hue cannot hold it in sRGB. That is the right trade, but a mapping
    // that dropped most of it would read as grey rather than as a theme.
    for (const preset of THEME_PRESETS) {
      const map = overlayAccentMap(preset.triad.accent, DEFAULT_TRIAD.accent);
      const core = hexToOklch(mapWarmHex("#ff8c00", map))!.c;
      const wanted = hexToOklch("#ff8c00")!.c * map.cr;
      expect(core / wanted, preset.label).toBeGreaterThan(0.85);
    }
  });
});
