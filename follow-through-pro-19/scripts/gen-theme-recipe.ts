/**
 * Generates src/lib/theme-recipe.ts from the palettes in src/styles.css.
 *
 * <p>Run with `npx tsx scripts/gen-theme-recipe.ts`. The output is
 * committed; this is not a build step.
 *
 * <p>The recipe is how a three-colour theme becomes a full palette. Each
 * token records which of the three roles it belongs to, its absolute
 * lightness, its hue as an offset from the role's hue, and its chroma as
 * a ratio of the role's chroma. Feed the default triad back in and every
 * token resolves to the value it was extracted from -- which is the
 * point: a user who never opens the picker must see exactly the palette
 * that shipped, and that property is asserted in theme.test.ts rather
 * than assumed.
 *
 * <p>Extracted rather than hand-written because there are 124 values
 * across four palettes and transcribing them is how a palette quietly
 * drifts from the stylesheet that actually renders.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseOklch, type Oklch } from "../src/lib/color.ts";

const STYLES = fileURLToPath(new URL("../src/styles.css", import.meta.url));
const OUT = fileURLToPath(new URL("../src/lib/theme-recipe.ts", import.meta.url));
const css = readFileSync(STYLES, "utf8");

const PALETTES = {
  dark: ":root",
  light: ":root.light",
  darkHigh: ':root[data-contrast="high"]',
  lightHigh: ':root.light[data-contrast="high"]',
} as const;

function block(selector: string): Record<string, Oklch> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc}\\s*(?:,[^{]*)?\\{(.*?)\\n\\}`, "s").exec(css);
  const out: Record<string, Oklch> = {};
  for (const [, n, v] of (m?.[1] ?? "").matchAll(/--([\w-]+):\s*(oklch\([^)]*\))\s*;/g)) {
    const parsed = n && v ? parseOklch(v) : null;
    if (n && parsed) out[n] = parsed;
  }
  return out;
}

/** Borders and secondary text are what "grey" means in the default theme. */
const NEUTRAL = new Set([
  "muted-foreground",
  "border",
  "input",
  "grid",
  "sidebar-border",
  "court-line",
]);
/** The brand mark: anything that is the accent or sits on it. */
const ACCENT = new Set([
  "primary",
  "primary-foreground",
  "ring",
  "chart-1",
  "sidebar-primary",
  "sidebar-primary-foreground",
]);
/**
 * Meaning, not brand, and pinned outright: these do not move with the
 * theme at all.
 */
const FIXED = new Set([
  "destructive",
  "destructive-foreground",
  "make-foreground",
  "miss-foreground",
  "live",
  "warn",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
]);
/**
 * Meaning in the hue, brand in the chroma.
 *
 * <p>A make is green and a miss is red whatever colours a team picks --
 * rotating them with the accent would produce a purple make and a blue
 * miss, and the chart legend would be the only thing left saying which was
 * which. So the hue is pinned and the *saturation* follows the accent, so
 * the pair sits with the rest of the theme instead of beside it.
 *
 * <p>Their lightness stays whatever the palette extracted, which is what
 * keeps them legible in light and dark: it is the lightness, not the hue,
 * that carries contrast against the card.
 */
const SEMANTIC_HUE: Record<string, "accent" | "base" | "neutral"> = {
  make: "accent",
  miss: "accent",
};

/** Picks near-black or near-white against the resolved accent, whichever
 * wins, instead of trusting the extracted lightness for every hue. */
const PAIRED = new Set(["primary-foreground", "sidebar-primary-foreground"]);

/**
 * Every palette is measured against the *default triad*, not against its
 * own background and primary.
 *
 * <p>Anchoring per palette looked right and was wrong: the light theme's
 * background carries chroma 0.002 where the triad's base carries 0.008,
 * so every light token came out with a chroma ratio four times too large
 * and the resolver, which multiplies by the triad's chroma, produced a
 * blue wash. The ratio and the multiplier have to be against the same
 * reference or they do not cancel.
 */
const ANCHOR = {
  accent: parseOklch("oklch(0.72 0.166 52)")!,
  base: parseOklch("oklch(0.16 0.008 250)")!,
  neutral: parseOklch("oklch(0.68 0.012 250)")!,
};

const round = (n: number, p: number) => Number(n.toFixed(p));
const lines: string[] = [];

for (const [key, selector] of Object.entries(PALETTES)) {
  // The high-contrast blocks are overrides, so they inherit the rest.
  const base =
    key === "darkHigh"
      ? { ...block(PALETTES.dark) }
      : key === "lightHigh"
        ? { ...block(PALETTES.light), ...block(PALETTES.darkHigh) }
        : {};
  const tokens = { ...base, ...block(selector) };
  const roleOf = (n: string) => (NEUTRAL.has(n) ? "neutral" : ACCENT.has(n) ? "accent" : "base");

  const entries: string[] = [];
  for (const [name, v] of Object.entries(tokens)) {
    if (FIXED.has(name)) {
      entries.push(
        `    "${name}": { fixed: "oklch(${round(v.l, 3)} ${round(v.c, 3)} ${round(v.h, 1)})" },`,
      );
      continue;
    }
    const semantic = SEMANTIC_HUE[name];
    if (semantic) {
      const a = ANCHOR[semantic];
      entries.push(
        // Half the shipped chroma: enough headroom for a theme to mute
        // the pair noticeably, not enough to let it grey them out.
        `    "${name}": { role: "${semantic}", l: ${round(v.l, 3)}, dh: 0, h: ${round(v.h, 1)}, cr: ${round(v.c / a.c, 4)}, cMin: ${round(v.c * 0.5, 4)} },`,
      );
      continue;
    }
    const role = roleOf(name);
    const a = ANCHOR[role];
    // A chroma-free token has no hue to preserve; anchor it at 0 offset so
    // it stays chroma-free whatever the user picks.
    const dh = v.c < 1e-6 ? 0 : round(((v.h - a.h + 540) % 360) - 180, 1);
    const cr = a.c < 1e-6 ? 0 : round(v.c / a.c, 4);
    const paired = PAIRED.has(name) ? ", paired: true" : "";
    entries.push(
      `    "${name}": { role: "${role}", l: ${round(v.l, 3)}, dh: ${dh}, cr: ${cr}${paired} },`,
    );
  }
  lines.push(`  ${key}: {\n${entries.join("\n")}\n  },`);
}

const header = `/**
 * GENERATED by scripts/gen-theme-recipe.ts -- do not edit by hand.
 *
 * How a three-colour theme becomes a palette. Every token names the role
 * it follows (accent, base or neutral), its absolute lightness, its hue
 * as a degree offset from that role's hue, and its chroma as a ratio of
 * that role's chroma. \`fixed\` tokens carry meaning rather than brand --
 * a make stays green -- so they ignore the triad entirely.
 *
 * Lightness is absolute because the theme, not the user, decides how
 * light a surface is; that is what keeps Light, Dark and high contrast
 * meaningful and keeps every contrast floor provable.
 */

export interface TokenRecipe {
  role: "accent" | "base" | "neutral";
  /** Absolute lightness. Supplied by the palette, never by the user. */
  l: number;
  /** Hue offset in degrees from the role's chosen hue. */
  dh: number;
  /**
   * An absolute hue, overriding role + dh.
   *
   * <p>For a token whose colour carries its meaning: a make is green and a
   * miss is red whatever the accent. Its chroma still follows the theme,
   * so the pair mutes and lifts with everything else.
   */
  h?: number;
  /** Chroma as a multiple of the role's chosen chroma. */
  cr: number;
  /**
   * A floor under the resolved chroma.
   *
   * <p>Only for tokens whose colour is their meaning. A greyscale accent
   * drives the chroma ratio to nothing, and a grey make is not a muted
   * make -- it is an unreadable one.
   */
  cMin?: number;
  /** Resolve as near-black or near-white against its pair, whichever wins. */
  paired?: boolean;
}

export type Recipe = TokenRecipe | { fixed: string };

export type PaletteKey = "dark" | "light" | "darkHigh" | "lightHigh";

export const THEME_RECIPE: Record<PaletteKey, Record<string, Recipe>> = {
`;

writeFileSync(OUT, header + lines.join("\n") + "\n};\n");
console.log(`wrote ${OUT}`);
