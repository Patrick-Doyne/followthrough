/**
 * A theme is three colours.
 *
 * <p>Accent, base and neutral -- by default the product's rim orange,
 * its near-black ground and its grey. Everything else in the palette is
 * derived from them through {@link THEME_RECIPE}, so a user who sets
 * three colours sees them everywhere the app draws, not just on the
 * screen where they set them.
 *
 * <p>The division of labour is deliberate: the user supplies **hue and
 * chroma**, the palette supplies **lightness**. That is what lets Light,
 * Dark and high contrast all keep working -- each is a different set of
 * lightnesses over the same three hues -- and it is what makes the
 * contrast floors provable, because the only thing varying between one
 * user's palette and another's is colourfulness, not luminance.
 *
 * <p>Resolution happens here, in TypeScript, and never in the
 * render-blocking boot script. The boot script replays the already
 * resolved map that the settings store holds, which is why the two
 * cannot drift: they read the same object rather than running the same
 * algorithm twice.
 */

import { contrastRatio, formatOklch, gamutMap, parseOklch, type Oklch } from "@/lib/color";
import { THEME_RECIPE, type PaletteKey, type Recipe } from "@/lib/theme-recipe";

export type { PaletteKey };

/** The three colours, stored as oklch strings.
 *
 * <p>oklch rather than hex because the picker's hex round trip is lossy
 * and the defaults have to reproduce the shipped stylesheet exactly. The
 * picker converts at its edges. */
export interface ThemeTriad {
  accent: string;
  base: string;
  neutral: string;
}

/** Reproduces the palette in styles.css exactly. Asserted, not assumed --
 * see theme.test.ts. */
export const DEFAULT_TRIAD: ThemeTriad = {
  accent: "oklch(0.72 0.166 52)",
  base: "oklch(0.16 0.008 250)",
  neutral: "oklch(0.68 0.012 250)",
};

/**
 * How far a role's chroma is allowed to be amplified.
 *
 * <p>A token's chroma is a ratio of its role's, so picking a vivid navy
 * base would otherwise multiply every surface's chroma by sixteen and
 * paint the app navy rather than tinting it. The gain caps that while
 * keeping the *relationships* between surfaces intact: at the cap, a
 * border is still more colourful than a background by the same factor it
 * always was. The accent is uncapped because it is the brand colour and
 * being vivid is its entire job.
 */
const MAX_GAIN: Record<TokenRole, number> = {
  accent: Number.POSITIVE_INFINITY,
  base: 4,
  neutral: 3,
};

type TokenRole = "accent" | "base" | "neutral";

/**
 * Near-black and near-white candidates for a foreground that sits on the
 * accent, tinted with the accent's own hue the way the shipped palette
 * is. High contrast drops the tint and uses true black and white, which
 * is both what it shipped with and the point of the mode.
 */
const PAIR_CANDIDATES: Record<PaletteKey, readonly { l: number; c: number }[]> = {
  dark: [
    { l: 0.17, c: 0.02 },
    { l: 0.99, c: 0.005 },
  ],
  light: [
    { l: 0.17, c: 0.02 },
    { l: 0.99, c: 0.005 },
  ],
  darkHigh: [
    { l: 0.14, c: 0.02 },
    { l: 1, c: 0 },
  ],
  lightHigh: [
    { l: 0.14, c: 0.02 },
    { l: 1, c: 0 },
  ],
};

/** Used only where the tinted pair cannot reach the floor. */
const LAST_RESORT = [
  { l: 0, c: 0 },
  { l: 1, c: 0 },
] as const;

/* The floors, plus a little.
 *
 * The margin is not superstition: resolved colours are rounded to three
 * decimals on the way into CSS, and a candidate measured at 4.4999
 * before rounding lands under the floor after it. Clearing 4.55 means
 * the value that actually ships is the value that was checked. */
const AA_TEXT = 4.55;
const UI_BOUNDARY = 3.05;

/**
 * Picks the label colour for something the user chose the colour of.
 *
 * <p>The tinted near-black and near-white are preferred because they are
 * what the shipped palette uses and they keep the accent's warmth in its
 * own label. They are not always enough: a mid-lightness accent at full
 * chroma leaves both of them just under 4.5:1, which the hue sweep found
 * at 4.33:1. Pure black and white are held back for exactly that case,
 * so the default palette is untouched and the edge of the colour space
 * still reads.
 */
function pickForeground(on: Oklch | undefined, hue: number, palette: PaletteKey): Oklch {
  const score = (candidate: { l: number; c: number }) => {
    const color = gamutMap({ l: candidate.l, c: candidate.c, h: hue });
    return { color, ratio: on ? contrastRatio(color, on) : 0 };
  };
  const preferred = PAIR_CANDIDATES[palette].map(score).sort((a, b) => b.ratio - a.ratio)[0]!;
  if (preferred.ratio >= AA_TEXT || !on) return preferred.color;
  const fallback = LAST_RESORT.map(score).sort((a, b) => b.ratio - a.ratio)[0]!;
  return fallback.ratio > preferred.ratio ? fallback.color : preferred.color;
}

function isFixed(recipe: Recipe): recipe is { fixed: string } {
  return "fixed" in recipe;
}

/**
 * Resolves one palette.
 *
 * <p>Returns CSS custom property names mapped to oklch strings, ready to
 * hand to `style.setProperty`. Unknown or unparseable input falls back to
 * the default triad rather than throwing: a corrupt stored value should
 * cost the user their colours, not the whole page.
 */
export function resolveTheme(triad: ThemeTriad, palette: PaletteKey): Record<string, string> {
  const anchors: Record<TokenRole, Oklch> = {
    accent: parseOklch(triad.accent) ?? parseOklch(DEFAULT_TRIAD.accent)!,
    base: parseOklch(triad.base) ?? parseOklch(DEFAULT_TRIAD.base)!,
    neutral: parseOklch(triad.neutral) ?? parseOklch(DEFAULT_TRIAD.neutral)!,
  };
  const defaults: Record<TokenRole, Oklch> = {
    accent: parseOklch(DEFAULT_TRIAD.accent)!,
    base: parseOklch(DEFAULT_TRIAD.base)!,
    neutral: parseOklch(DEFAULT_TRIAD.neutral)!,
  };

  const gain: Record<TokenRole, number> = {
    accent: anchors.accent.c / defaults.accent.c,
    base: Math.min(anchors.base.c / defaults.base.c, MAX_GAIN.base),
    neutral: Math.min(anchors.neutral.c / defaults.neutral.c, MAX_GAIN.neutral),
  };

  const out: Record<string, string> = {};
  const resolved: Record<string, Oklch> = {};

  for (const [name, recipe] of Object.entries(THEME_RECIPE[palette])) {
    if (isFixed(recipe)) {
      out[name] = recipe.fixed;
      const parsed = parseOklch(recipe.fixed);
      if (parsed) resolved[name] = parsed;
      continue;
    }
    if (recipe.paired) continue; // needs its pair resolved first
    const anchor = anchors[recipe.role];
    const color = gamutMap({
      l: recipe.l,
      // `cMin` is a floor, not a default. A greyscale accent drives the
      // gain to zero, which without this turned a make into plain grey --
      // the one thing these two tokens may never become, since their
      // colour is the meaning. A theme may mute them; it may not drain
      // them.
      c: Math.max(recipe.cMin ?? 0, recipe.cr * defaults[recipe.role].c * gain[recipe.role]),
      // `h` pins the hue outright, for a token whose colour *is* its
      // meaning. A make is green and a miss is red whatever accent the
      // user picks -- rotating them with the accent would hand someone a
      // purple make and a blue miss. They still follow the theme, through
      // the chroma ratio above: a muted theme mutes them, a vivid one
      // lifts them. Lightness stays absolute, which is what keeps every
      // contrast floor provable in light and dark alike.
      h: recipe.h ?? (anchor.h + recipe.dh + 360) % 360,
    });
    resolved[name] = color;
    out[name] = formatOklch(color);
  }

  // Paired foregrounds last: each picks whichever of near-black and
  // near-white reads better on the token it sits on, so an accent the
  // user drags very light or very dark cannot strand its own label.
  for (const [name, recipe] of Object.entries(THEME_RECIPE[palette])) {
    if (isFixed(recipe) || !recipe.paired) continue;
    const pairName = name.replace(/-foreground$/, "");
    const hue = (anchors[recipe.role].h + recipe.dh + 360) % 360;
    const color = pickForeground(resolved[pairName], hue, palette);
    resolved[name] = color;
    out[name] = formatOklch(color);
  }

  // `input` is the one boundary WCAG 1.4.11 actually governs here, and
  // the shipped default clears it by 0.02. Any tint at all pushes it
  // under, so it is corrected rather than trusted.
  enforceFloor(out, resolved, "input", ["card", "background"], UI_BOUNDARY);

  return {
    ...out,
    ...resolveSectionShades(anchors.accent, gain.accent, palette),
    ...resolveHero(anchors, gain, palette),
  };
}

/**
 * The settings page's section colour.
 *
 * <p>One step, not five. An earlier version walked the accent down five
 * lightnesses so each tab differed, which distinguished them but meant
 * four of the five sat at a saturation nobody chose -- the palest washed
 * out and the deepest went muddy. They all use the level that read best,
 * and the icon and title do the distinguishing, which is what they were
 * already doing.
 *
 * <p>Chosen per palette so the colour clears 3:1 against the card it
 * edges and carries its own label at 4.5:1; theme.test.ts sweeps the hue
 * circle to keep that true for any accent.
 */
const SECTION_L: Record<PaletteKey, number> = {
  dark: 0.66,
  darkHigh: 0.7,
  light: 0.44,
  lightHigh: 0.38,
};

function resolveSectionShades(
  accent: Oklch,
  gain: number,
  palette: PaletteKey,
): Record<string, string> {
  const defaultAccentChroma = parseOklch(DEFAULT_TRIAD.accent)!.c;
  const shade = gamutMap({
    l: SECTION_L[palette],
    c: defaultAccentChroma * gain,
    h: accent.h,
  });
  return {
    sec: formatOklch(shade),
    "sec-on": formatOklch(pickForeground(shade, accent.h, palette)),
  };
}

/**
 * Walks a token's lightness until it clears `floor` against everything it
 * has to sit on.
 *
 * <p>Bounded and directional rather than a search: it moves away from
 * the surface behind it, one hundredth at a time, and gives up at the
 * end of the range. Hue and chroma are untouched, so the user's colour
 * survives the correction.
 */
function enforceFloor(
  out: Record<string, string>,
  resolved: Record<string, Oklch>,
  token: string,
  against: string[],
  floor: number,
): void {
  const start = resolved[token];
  if (!start) return;
  const surfaces = against.map((n) => resolved[n]).filter((c): c is Oklch => Boolean(c));
  if (surfaces.length === 0) return;

  const worst = (c: Oklch) => Math.min(...surfaces.map((s) => contrastRatio(c, s)));
  if (worst(start) >= floor) return;

  // Away from the surfaces: lighter on a dark palette, darker on a light one.
  const step = start.l < surfaces[0]!.l ? -0.01 : 0.01;
  let candidate = start;
  for (let i = 0; i < 100; i++) {
    const next = gamutMap({ ...candidate, l: candidate.l + step });
    if (next.l <= 0 || next.l >= 1) break;
    candidate = next;
    if (worst(candidate) >= floor) break;
  }
  resolved[token] = candidate;
  out[token] = formatOklch(candidate);
}

/**
 * The settings hero.
 *
 * <p>These were fixed blue-greys, which meant the largest single block
 * of colour on the page was the one thing that did not move when the
 * theme changed -- the same mistake the section colours had, and the
 * reason the plate looked dull beside cards that were following the
 * accent.
 *
 * <p>The band stays dark in both themes, so the lightnesses here are
 * near-constant; what varies is the hue. It reads as a gradient from
 * the base's own family into the accent's, which gives the plate
 * something to sit against without competing with it.
 */
function resolveHero(
  anchors: Record<TokenRole, Oklch>,
  gain: Record<TokenRole, number>,
  palette: PaletteKey,
): Record<string, string> {
  const high = palette === "darkHigh" || palette === "lightHigh";
  const baseC = parseOklch(DEFAULT_TRIAD.base)!.c;

  const hero = gamutMap({
    l: high ? 0.15 : 0.185,
    c: baseC * 1.75 * gain.base,
    h: anchors.base.h,
  });
  // The far end of the band carries the accent's hue at a chroma the eye
  // reads as a tint rather than as a second colour.
  const hero2 = gamutMap({
    l: high ? 0.19 : 0.245,
    c: Math.min(0.055, 0.035 * Math.max(1, gain.accent)),
    h: anchors.accent.h,
  });

  const fg = gamutMap({ l: high ? 1 : 0.97, c: high ? 0 : 0.004, h: anchors.base.h });
  const muted = gamutMap({ l: high ? 0.88 : 0.76, c: 0.012 * gain.base, h: anchors.base.h });

  return {
    hero: formatOklch(hero),
    "hero-2": formatOklch(hero2),
    "hero-fg": formatOklch(fg),
    "hero-muted": formatOklch(muted),
    // The court lines. Drawn in the accent rather than in white, which
    // is most of what "add colour to the plate" comes down to: it is the
    // biggest shape in the band.
    "hero-art": formatOklch(gamutMap({ l: 0.72, c: 0.166 * gain.accent, h: anchors.accent.h })),
  };
}

export const PALETTE_KEYS: PaletteKey[] = ["dark", "light", "darkHigh", "lightHigh"];

/** Every palette at once. This is what the settings store persists and
 * the boot script replays, so the first paint is already themed. */
export function resolveAllPalettes(triad: ThemeTriad): Record<PaletteKey, Record<string, string>> {
  return {
    dark: resolveTheme(triad, "dark"),
    light: resolveTheme(triad, "light"),
    darkHigh: resolveTheme(triad, "darkHigh"),
    lightHigh: resolveTheme(triad, "lightHigh"),
  };
}

export function paletteKeyFor(theme: "dark" | "light", highContrast: boolean): PaletteKey {
  if (theme === "dark") return highContrast ? "darkHigh" : "dark";
  return highContrast ? "lightHigh" : "light";
}

/**
 * Every custom property a resolved theme writes.
 *
 * <p>Needed as a list, not just as the keys of one result, because
 * clearing a custom theme means removing exactly these and nothing else.
 *
 * <p>Derived from an actual resolve rather than hand-listed. The
 * hand-written version fell out of step the moment the hero tokens were
 * added: they were resolved correctly and then never written to the
 * DOM, so a custom theme recoloured the whole page except the one band
 * at the top of it. theme.test.ts now asserts the two agree.
 */
export const THEME_TOKEN_NAMES: string[] = Object.keys(resolveTheme(DEFAULT_TRIAD, "dark"));

/** True when the triad is the shipped one, in which case styles.css
 * already says everything and nothing needs to be written inline. */
export function isDefaultTriad(triad: ThemeTriad): boolean {
  return (
    triad.accent === DEFAULT_TRIAD.accent &&
    triad.base === DEFAULT_TRIAD.base &&
    triad.neutral === DEFAULT_TRIAD.neutral
  );
}

/**
 * Named starting points.
 *
 * <p>These replace the seven accent presets. Each is a whole theme rather
 * than a hue, because the unit a user picks is now three colours; the
 * first reproduces the shipped palette exactly and the rest are somewhere
 * a team's colours might plausibly land.
 */
/**
 * Preset themes.
 *
 * <p>Built on a relationship the product was already using without
 * saying so: the shipped accent is at hue 52 and its ground at 250,
 * which is 198 degrees away -- a complement. That is not decoration. A
 * ground tinted toward the accent's complement makes the accent read as
 * more saturated than it is (simultaneous contrast), while at chroma
 * 0.008 the ground itself still reads as a neutral rather than as a
 * colour.
 *
 * <p>The first version of these presets missed that and put each ground
 * at roughly its own accent's hue. Analogous grounds are perfectly
 * valid, but they give up exactly the lift that makes the default orange
 * sit forward off the page, which is why those presets looked flat next
 * to the default.
 *
 * <p>Chroma is 89% of each hue's maximum inside sRGB, which is where the
 * shipped orange already sits. A fixed chroma would not do: at the
 * accent lightness only half the hue circle reaches 0.166, so teal and
 * gold would have come out visibly duller than orange and red.
 */
export const THEME_PRESETS: { id: string; label: string; triad: ThemeTriad }[] = [
  { id: "rim", label: "Rim orange", triad: DEFAULT_TRIAD },
  {
    id: "hardwood",
    label: "Hardwood",
    triad: {
      accent: "oklch(0.72 0.134 80)",
      base: "oklch(0.16 0.008 278)",
      neutral: "oklch(0.68 0.012 278)",
    },
  },
  {
    id: "lane",
    label: "Lane red",
    triad: {
      accent: "oklch(0.72 0.156 25)",
      base: "oklch(0.16 0.008 223)",
      neutral: "oklch(0.68 0.012 223)",
    },
  },
  {
    id: "chalk",
    label: "Chalk green",
    triad: {
      accent: "oklch(0.72 0.178 150)",
      base: "oklch(0.16 0.008 348)",
      neutral: "oklch(0.68 0.012 348)",
    },
  },
  {
    id: "baseline",
    label: "Baseline blue",
    triad: {
      accent: "oklch(0.72 0.14 245)",
      base: "oklch(0.16 0.008 83)",
      neutral: "oklch(0.68 0.012 83)",
    },
  },
  {
    id: "jersey",
    label: "Jersey violet",
    triad: {
      accent: "oklch(0.72 0.154 300)",
      base: "oklch(0.16 0.008 138)",
      neutral: "oklch(0.68 0.012 138)",
    },
  },
];
