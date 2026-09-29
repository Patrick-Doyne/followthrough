import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  formatOklch,
  gamutMap,
  oklchToHex,
  parseOklch,
  type Oklch,
} from "@/lib/color";
import {
  DEFAULT_TRIAD,
  PALETTE_KEYS,
  paletteKeyFor,
  resolveTheme,
  THEME_PRESETS,
  THEME_TOKEN_NAMES,
  type PaletteKey,
  type ThemeTriad,
} from "@/lib/theme";

/**
 * A three-colour theme has to satisfy two things at once: leave the
 * default palette exactly as it shipped, and stay legible for every
 * colour a user can choose. Neither is checkable by looking at one
 * screenshot, so both are swept here.
 */

const CSS = readFileSync(fileURLToPath(new URL("./../styles.css", import.meta.url)), "utf8");

const SELECTOR: Record<PaletteKey, string> = {
  dark: ":root",
  light: ":root.light",
  darkHigh: ':root[data-contrast="high"]',
  lightHigh: ':root.light[data-contrast="high"]',
};

function block(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${esc}\\s*(?:,[^{]*)?\\{(.*?)\\n\\}`, "s").exec(CSS);
  const out: Record<string, string> = {};
  for (const [, name, value] of (match?.[1] ?? "").matchAll(
    /--([\w-]+):\s*(oklch\([^)]*\))\s*;/g,
  ) as Iterable<RegExpMatchArray>) {
    if (name && value) out[name] = value;
  }
  return out;
}

function shippedPalette(key: PaletteKey): Record<string, string> {
  if (key === "darkHigh") return { ...block(SELECTOR.dark), ...block(SELECTOR.darkHigh) };
  if (key === "lightHigh") {
    return { ...block(SELECTOR.light), ...block(SELECTOR.darkHigh), ...block(SELECTOR.lightHigh) };
  }
  return block(SELECTOR[key]);
}

/**
 * High contrast used to inherit its near-black accent foreground from the
 * normal palette. Resolving gives it the darker one the rest of that
 * palette already used, which is the mode doing its job -- so these two
 * are expected to differ from the stylesheet, and differ in that
 * direction.
 */
const INTENDED_DIVERGENCE = new Set([
  "darkHigh.sidebar-primary-foreground",
  "lightHigh.sidebar-primary-foreground",
]);

/** Largest per-channel 8-bit difference between two colours. */
function channelDistance(a: string, b: string): number {
  const ha = oklchToHex(parseOklch(a)!);
  const hb = oklchToHex(parseOklch(b)!);
  let worst = 0;
  for (let i = 1; i < 7; i += 2) {
    worst = Math.max(
      worst,
      Math.abs(parseInt(ha.slice(i, i + 2), 16) - parseInt(hb.slice(i, i + 2), 16)),
    );
  }
  return worst;
}

describe("the default triad reproduces the shipped palette", () => {
  for (const key of PALETTE_KEYS) {
    it(`${key}: every token resolves to what styles.css renders`, () => {
      const resolved = resolveTheme(DEFAULT_TRIAD, key);
      const drifted: string[] = [];
      for (const [name, shipped] of Object.entries(shippedPalette(key))) {
        expect(resolved, `${key}.${name} is missing from the recipe`).toHaveProperty(name);
        if (INTENDED_DIVERGENCE.has(`${key}.${name}`)) continue;
        // One 8-bit step of slack, and no more: that is gamut mapping
        // rounding, not a palette change.
        if (channelDistance(shipped, resolved[name]!) > 1) {
          drifted.push(`${name}: ${shipped} -> ${resolved[name]}`);
        }
      }
      expect(drifted).toEqual([]);
    });
  }
});

/** Hues around the circle, at chroma from grey to as vivid as sRGB holds. */
function sweepTriads(): ThemeTriad[] {
  const out: ThemeTriad[] = [DEFAULT_TRIAD];
  for (let hue = 0; hue < 360; hue += 30) {
    for (const chroma of [0, 0.04, 0.12, 0.2, 0.32]) {
      out.push({
        accent: formatOklch({ l: 0.72, c: chroma, h: hue }),
        base: formatOklch({ l: 0.16, c: chroma, h: (hue + 120) % 360 }),
        neutral: formatOklch({ l: 0.68, c: chroma, h: (hue + 240) % 360 }),
      });
    }
  }
  return out;
}

const ratio = (a: string, b: string) =>
  contrastRatio(parseOklch(a) as Oklch, parseOklch(b) as Oklch);

describe("every reachable theme stays legible", () => {
  const triads = sweepTriads();

  /** [foreground, background, floor] */
  const PAIRS: [string, string, number][] = [
    ["foreground", "background", 4.5],
    ["foreground", "card", 4.5],
    ["muted-foreground", "background", 4.5],
    ["muted-foreground", "card", 4.5],
    ["primary-foreground", "primary", 4.5],
    ["sidebar-foreground", "sidebar", 4.5],
    // `border` is deliberately absent: it is a hairline between two
    // adjacent surfaces, not a control boundary, and the shipped default
    // sits at 1.38:1. WCAG 1.4.11 is about `input`, which is here.
    ["input", "background", 3],
    ["input", "card", 3],
    ["primary", "background", 3],
  ];

  for (const key of PALETTE_KEYS) {
    for (const [fg, bg, floor] of PAIRS) {
      it(`${key}: ${fg} on ${bg} holds ${floor}:1 for all ${triads.length} triads`, () => {
        const failures: string[] = [];
        for (const triad of triads) {
          const t = resolveTheme(triad, key);
          const r = ratio(t[fg]!, t[bg]!);
          if (r < floor) failures.push(`${triad.accent} / ${triad.base}: ${r.toFixed(2)}`);
        }
        expect(failures).toEqual([]);
      });
    }

    it(`${key}: the section colour stays usable for all ${triads.length} triads`, () => {
      const failures: string[] = [];
      for (const triad of triads) {
        const t = resolveTheme(triad, key);
        const shade = t["sec"]!;
        const on = t["sec-on"]!;
        if (ratio(shade, t["card"]!) < 3) {
          failures.push(`sec on card: ${ratio(shade, t["card"]!).toFixed(2)} (${triad.accent})`);
        }
        if (ratio(on, shade) < 4.5) {
          failures.push(`sec-on on sec: ${ratio(on, shade).toFixed(2)} (${triad.accent})`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe("the hero band", () => {
  /**
   * The band is a gradient whose two stops sit in different hue
   * families, so its text has to clear both -- and it has to do that
   * for any three colours someone picks, not just the shipped ones.
   */
  for (const key of PALETTE_KEYS) {
    it(`${key}: hero text clears both gradient stops for every triad`, () => {
      const failures: string[] = [];
      for (const triad of sweepTriads()) {
        const t = resolveTheme(triad, key);
        for (const stop of ["hero", "hero-2"]) {
          for (const fg of ["hero-fg", "hero-muted"]) {
            const r = ratio(t[fg]!, t[stop]!);
            if (r < 4.5) failures.push(`${fg} on ${stop}: ${r.toFixed(2)} (${triad.accent})`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe("a brand colour cannot recolour meaning", () => {
  /**
   * A made shot is green and a miss is red because of what they mean,
   * not because of the product's palette. Whatever three colours someone
   * picks, those have to come out the other side untouched -- otherwise
   * a user with a red accent gets a chart where makes and misses are the
   * same colour.
   */
  const SEMANTIC = [
    "make-foreground",
    "miss-foreground",
    "destructive",
    "destructive-foreground",
    "live",
    "warn",
    "chart-2",
    "chart-3",
    "chart-4",
    "chart-5",
  ];

  for (const key of PALETTE_KEYS) {
    it(`${key}: pinned tokens are identical for every triad`, () => {
      const reference = resolveTheme(DEFAULT_TRIAD, key);
      for (const triad of sweepTriads()) {
        const resolved = resolveTheme(triad, key);
        for (const token of SEMANTIC) {
          expect(resolved[token], `${token} moved for ${triad.accent}`).toBe(reference[token]);
        }
      }
    });
  }

  /**
   * make and miss are the exception: they follow the theme's saturation
   * while keeping their meaning and their legibility. Asserted rather
   * than assumed, because all three properties are easy to break with a
   * one-line change to the recipe.
   */
  for (const key of PALETTE_KEYS) {
    it(`${key}: make and miss follow the theme without losing their meaning`, () => {
      const reference = resolveTheme(DEFAULT_TRIAD, key);
      let moved = 0;

      for (const triad of sweepTriads()) {
        const resolved = resolveTheme(triad, key);

        for (const token of ["make", "miss"] as const) {
          const colour = parseOklch(resolved[token] as string);
          const expected = parseOklch(reference[token] as string);
          expect(colour, `${token} unparseable for ${triad.accent}`).not.toBeNull();

          // Hue is the meaning: a make is green and a miss is red, whatever
          // accent the user picked. Rotating them would hand someone a
          // purple make and a blue miss.
          expect(colour!.h, `${token} hue moved for ${triad.accent}`).toBeCloseTo(expected!.h, 1);

          // Lightness is what carries contrast against the card, so it is
          // the palette's to set and never the theme's.
          expect(colour!.l, `${token} lightness moved for ${triad.accent}`).toBeCloseTo(
            expected!.l,
            3,
          );

          // Muted, never drained. A grey make is unreadable, not subtle.
          expect(colour!.c, `${token} greyed out for ${triad.accent}`).toBeGreaterThan(0.05);

          if (Math.abs(colour!.c - expected!.c) > 1e-6) moved += 1;
        }
      }

      // ...and they genuinely do move, or none of the above means anything.
      expect(moved, "make and miss never moved for any triad").toBeGreaterThan(0);
    });
  }
});

describe("the preset themes", () => {
  /**
   * The grounds are the accents' complements, which is the relationship
   * the shipped palette already used (52 against 250). Asserted because
   * the first set of presets quietly used analogous grounds instead and
   * the difference is the reason they looked flat -- not something a
   * reviewer would catch by reading six oklch triples.
   */
  it("puts every ground on its accent's complement", () => {
    for (const preset of THEME_PRESETS) {
      const accent = parseOklch(preset.triad.accent)!;
      const base = parseOklch(preset.triad.base)!;
      const neutral = parseOklch(preset.triad.neutral)!;
      const offset = (base.h - accent.h + 360) % 360;
      expect(offset, `${preset.label} ground offset`).toBeGreaterThan(150);
      expect(offset, `${preset.label} ground offset`).toBeLessThan(210);
      expect(neutral.h, `${preset.label} neutral shares the ground's hue`).toBeCloseTo(base.h, 5);
    }
  });

  it("keeps the ground neutral enough to read as one", () => {
    for (const preset of THEME_PRESETS) {
      expect(parseOklch(preset.triad.base)!.c, preset.label).toBeLessThanOrEqual(0.012);
    }
  });

  it("gives every accent comparable vividness", () => {
    // A fixed chroma cannot work: at the accent lightness only half the
    // hue circle reaches the default's 0.166. Each preset instead sits
    // at the same fraction of what its own hue can hold, so none of them
    // looks washed out beside the others.
    const ratios = THEME_PRESETS.map((preset) => {
      const accent = parseOklch(preset.triad.accent)!;
      let max = 0;
      for (let c = 0.4; c >= 0; c -= 0.001) {
        if (Math.abs(gamutMap({ l: accent.l, c, h: accent.h }).c - c) < 1e-3) {
          max = c;
          break;
        }
      }
      return accent.c / max;
    });
    for (const r of ratios) expect(r).toBeGreaterThan(0.85);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.08);
  });

  it("every preset stays legible in every palette", () => {
    for (const preset of THEME_PRESETS) {
      for (const key of PALETTE_KEYS) {
        const t = resolveTheme(preset.triad, key);
        expect(
          ratio(t["foreground"]!, t["background"]!),
          `${preset.label}/${key}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          ratio(t["primary-foreground"]!, t["primary"]!),
          `${preset.label}/${key}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t["sec"]!, t["card"]!), `${preset.label}/${key}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("THEME_TOKEN_NAMES", () => {
  /**
   * The list is what gets written to and cleared from the document, so
   * a token that resolveTheme produces but the list omits is resolved
   * perfectly and then silently ignored. That is what happened to the
   * hero band: every other colour followed the theme and it stayed
   * orange.
   */
  it("covers every token every palette resolves", () => {
    const named = new Set(THEME_TOKEN_NAMES);
    const missing = new Set<string>();
    for (const key of PALETTE_KEYS) {
      for (const triad of [DEFAULT_TRIAD, ...sweepTriads().slice(0, 5)]) {
        for (const token of Object.keys(resolveTheme(triad, key))) {
          if (!named.has(token)) missing.add(`${key}.${token}`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("names nothing that is never resolved", () => {
    const resolved = new Set(Object.keys(resolveTheme(DEFAULT_TRIAD, "dark")));
    expect(THEME_TOKEN_NAMES.filter((n) => !resolved.has(n))).toEqual([]);
  });
});

describe("paletteKeyFor", () => {
  it("maps theme and contrast onto the four palettes", () => {
    expect(paletteKeyFor("dark", false)).toBe("dark");
    expect(paletteKeyFor("dark", true)).toBe("darkHigh");
    expect(paletteKeyFor("light", false)).toBe("light");
    expect(paletteKeyFor("light", true)).toBe("lightHigh");
  });
});

describe("resolveTheme is defensive", () => {
  it("falls back to the default triad rather than throwing on junk", () => {
    const junk = resolveTheme({ accent: "nope", base: "", neutral: "#f00" }, "dark");
    expect(junk["primary"]).toBe(resolveTheme(DEFAULT_TRIAD, "dark")["primary"]);
  });
});
