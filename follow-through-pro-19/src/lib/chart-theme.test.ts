import { describe, expect, it } from "vitest";

import { contrastBetween } from "@/lib/color";
import { DEFAULT_TRIAD, PALETTE_KEYS, resolveAllPalettes, resolveTheme } from "@/lib/theme";

/**
 * The gate on chart colour now that the marks follow the theme again.
 *
 * <p>Two things have to hold. Every series must be visible on its own
 * theme's card -- that one the palettes satisfy comfortably. And make must
 * be separable from miss, which they do *not* all satisfy: in the light
 * palette the two measure 1.035:1 against each other, the same brightness.
 * That is recorded here rather than fixed in the palette, because the fix
 * chosen was a different one -- no chart leans on colour alone. Every chart
 * carries a legend whose swatch draws the mark's real shape, and make and
 * miss are drawn as circle against cross and solid against hatched.
 *
 * <p>If that second assertion ever starts passing everywhere, the shape
 * cues are still right to keep; this test exists so the reason for them is
 * not lost.
 */
const PALETTES = resolveAllPalettes(DEFAULT_TRIAD) as Record<string, Record<string, string>>;

const SERIES = ["chart-1", "chart-2", "chart-4", "make", "miss", "warn"];

/** The floor for a graphical mark that carries meaning (WCAG 1.4.11). */
const MIN_CONTRAST = 3;

describe("chart palette", () => {
  it("draws every series visibly on its own theme's card", () => {
    for (const [theme, tokens] of Object.entries(PALETTES)) {
      for (const token of SERIES) {
        const ratio = contrastBetween(tokens[token] as string, tokens["surface"] as string);
        expect(ratio, `${token} on ${theme}`).not.toBeNull();
        expect(ratio as number, `${token} on ${theme}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    }
  });

  it("keeps the axis text readable on its own card", () => {
    // Body-text contrast, not the graphical floor: these are words.
    for (const [theme, tokens] of Object.entries(PALETTES)) {
      const ratio = contrastBetween(
        tokens["muted-foreground"] as string,
        tokens["surface"] as string,
      );
      expect(ratio as number, `axis text on ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("records that colour alone cannot separate a make from a miss", () => {
    // The measurement behind the shape cues. In light mode the two are the
    // same brightness, so a greyscale print or a red-green colour-blind
    // reader has nothing to go on but the shape.
    const light = PALETTES["light"]!;
    const separation = contrastBetween(light["make"] as string, light["miss"] as string)!;
    expect(separation).toBeLessThan(1.2);

    // Dark is better, but not enough to rely on either.
    const dark = PALETTES["dark"]!;
    expect(contrastBetween(dark["make"] as string, dark["miss"] as string)!).toBeLessThan(2.5);
  });
});

/**
 * make and miss follow the user's theme now, so their legibility can no
 * longer be checked on the shipped palette alone. This sweeps the hue
 * circle and both chroma extremes -- including a greyscale theme, which
 * is what first drained them to plain grey -- and holds every result to
 * the same floor in all four palettes.
 */
describe("make and miss under a user's own theme", () => {
  const TRIADS = [
    ...Array.from({ length: 12 }, (_, i) => ({
      accent: `oklch(0.72 0.166 ${i * 30})`,
      base: "oklch(0.16 0.008 250)",
      neutral: "oklch(0.68 0.012 250)",
    })),
    // The extremes: no colour at all, and as much as the gain allows.
    { accent: "oklch(0.72 0 0)", base: "oklch(0.16 0 0)", neutral: "oklch(0.68 0 0)" },
    {
      accent: "oklch(0.72 0.37 300)",
      base: "oklch(0.16 0.06 300)",
      neutral: "oklch(0.68 0.05 300)",
    },
  ];

  it("keeps both visible on the card in every palette, for every theme", () => {
    for (const triad of TRIADS) {
      for (const key of PALETTE_KEYS) {
        const tokens = resolveTheme(triad, key);
        for (const token of ["make", "miss"] as const) {
          const ratio = contrastBetween(tokens[token] as string, tokens["surface"] as string);
          expect(ratio, `${token} on ${key} for ${triad.accent}`).not.toBeNull();
          expect(ratio as number, `${token} on ${key} for ${triad.accent}`).toBeGreaterThanOrEqual(
            MIN_CONTRAST,
          );
        }
      }
    }
  });

  it("never lets either wash out to grey", () => {
    // Including the greyscale theme, where the chroma ratio resolves to
    // zero and only the floor keeps a make green.
    for (const triad of TRIADS) {
      for (const key of PALETTE_KEYS) {
        const tokens = resolveTheme(triad, key);
        for (const token of ["make", "miss"] as const) {
          const colour = tokens[token] as string;
          const chroma = Number(colour.match(/oklch\([\d.]+ ([\d.]+)/)?.[1] ?? 0);
          expect(chroma, `${token} greyed on ${key} for ${triad.accent}`).toBeGreaterThan(0.05);
        }
      }
    }
  });
});
