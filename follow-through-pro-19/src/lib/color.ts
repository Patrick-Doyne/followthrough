/**
 * Colour maths for the design system: oklch to sRGB, WCAG contrast, and
 * gamut mapping.
 *
 * <p>Extracted into its own module so that the contrast test and anything
 * that generates colours share one implementation. When the assertions and
 * the generator each own a copy, they can drift and agree with each other
 * while both being wrong.
 *
 * <p>Two corrections live here relative to the earlier inline version:
 *
 * <ul>
 *   <li><b>Luminance is computed from linear-light values directly.</b> The
 *   OKLab matrices already produce linear sRGB, so applying the sRGB
 *   transfer function to them again is wrong. That bug made every mid-tone
 *   look far darker than it is — mid grey on white measured 13.4:1 instead
 *   of its true 4.5:1 — and it under-reported contrast on dark backgrounds,
 *   which is most of this product.
 *   <li><b>Out-of-gamut colours reduce chroma rather than clipping
 *   channels.</b> Clipping shifts hue and lightness unpredictably; browsers
 *   reduce chroma at constant lightness and hue. This matters most for the
 *   saturated colours a generated accent produces.
 * </ul>
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** Linear-light sRGB, which may fall outside [0,1] when out of gamut. */
export type LinearRgb = [number, number, number];

export function parseOklch(value: string): Oklch | null {
  const match = /oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(value);
  if (!match) return null;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

export function oklchToLinearRgb({ l, c, h }: Oklch): LinearRgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

const GAMUT_EPSILON = 1e-4;

export function inGamut(rgb: LinearRgb): boolean {
  return rgb.every((v) => v >= -GAMUT_EPSILON && v <= 1 + GAMUT_EPSILON);
}

/**
 * Brings a colour into sRGB by reducing chroma at constant lightness and
 * hue, the way a browser does, rather than clipping each channel.
 */
export function gamutMap(color: Oklch): Oklch {
  if (inGamut(oklchToLinearRgb(color))) return color;
  let low = 0;
  let high = color.c;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinearRgb({ ...color, c: mid }))) low = mid;
    else high = mid;
  }
  return { ...color, c: low };
}

/** WCAG relative luminance. Input is linear-light, so no transfer function. */
export function relativeLuminance(rgb: LinearRgb): number {
  const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, v))) as LinearRgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(oklchToLinearRgb(gamutMap(a)));
  const lb = relativeLuminance(oklchToLinearRgb(gamutMap(b)));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast between two token strings, or null if either is unparseable. */
export function contrastBetween(a: string, b: string): number | null {
  const ca = parseOklch(a);
  const cb = parseOklch(b);
  if (!ca || !cb) return null;
  return contrastRatio(ca, cb);
}

/* ------------------------------------------------------------------ *
 * Accent derivation
 * ------------------------------------------------------------------ */

/** Near-black and near-white candidates for text sitting on an accent. */
const FOREGROUND_CANDIDATES: Oklch[] = [
  { l: 0.16, c: 0.02, h: 0 },
  { l: 0.99, c: 0.005, h: 0 },
];

export interface AccentTarget {
  /** Lightness the palette's own accent uses; the result stays as near to
   * this as the contrast floors allow, so a preset looks like it belongs. */
  referenceL: number;
  referenceC: number;
  background: Oklch;
  card: Oklch;
}

export interface DerivedAccent {
  primary: Oklch;
  /** Whichever of near-black / near-white scores higher on the accent. */
  foreground: Oklch;
}

/**
 * Finds a usable accent for a hue within one palette.
 *
 * <p>Searches lightness exhaustively and returns the passing value nearest
 * the palette's own reference, rather than nudging iteratively from a
 * start point. Deterministic, and it cannot get stuck oscillating between
 * the two constraints — which pull in opposite directions at yellow-green,
 * where the accent wants to be light to carry black text but dark to stay
 * visible on a white page.
 *
 * <p>Both floors are real: 4.5:1 for text placed **on** the accent, and
 * 3:1 for the accent **against** the page and cards (WCAG 1.4.11, since it
 * is used for focus rings and marks).
 *
 * @returns null when no lightness satisfies both. A generator that refuses
 *   to emit a failing preset is better than one that ships a near miss.
 */
export function deriveAccent(hue: number, target: AccentTarget): DerivedAccent | null {
  const step = 0.005;
  let best: { accent: Oklch; foreground: Oklch; distance: number } | null = null;

  for (let l = 0.2; l <= 0.96 + 1e-9; l += step) {
    const accent = gamutMap({ l: Number(l.toFixed(3)), c: target.referenceC, h: hue });

    if (contrastRatio(accent, target.background) < 3) continue;
    if (contrastRatio(accent, target.card) < 3) continue;

    // Pick whichever foreground scores higher; a mid-lightness accent at a
    // hostile hue can pass with white where it fails with black.
    let foreground = FOREGROUND_CANDIDATES[0]!;
    let bestRatio = 0;
    for (const candidate of FOREGROUND_CANDIDATES) {
      const ratio = contrastRatio(candidate, accent);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        foreground = candidate;
      }
    }
    if (bestRatio < 4.5) continue;

    const distance = Math.abs(accent.l - target.referenceL);
    if (!best || distance < best.distance) best = { accent, foreground, distance };
  }

  return best ? { primary: best.accent, foreground: best.foreground } : null;
}

export function formatOklch({ l, c, h }: Oklch): string {
  const round = (n: number, places: number) => Number(n.toFixed(places));
  return `oklch(${round(l, 3)} ${round(c, 3)} ${round(h, 1)})`;
}

/* ------------------------------------------------------------------ *
 * Hex interchange
 *
 * A colour input speaks hex and the palette speaks oklch, so the theme
 * picker needs both directions. Only the picker uses these: the stored
 * triad is oklch, because a hex round trip is lossy and the default
 * triad has to reproduce the shipped palette byte for byte.
 * ------------------------------------------------------------------ */

/** Linear-light sRGB -> the 0..1 gamma-encoded values a hex string holds. */
function encodeSrgb(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function decodeSrgb(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Gamut-maps first, so an unrepresentable colour desaturates rather than
 * clipping a channel and shifting hue. */
export function oklchToHex(color: Oklch): string {
  const [r, g, b] = oklchToLinearRgb(gamutMap(color));
  const byte = (v: number) =>
    Math.round(encodeSrgb(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function hexToOklch(hex: string): Oklch | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const raw = match[1].length === 3 ? match[1].replace(/(.)/g, "$1$1") : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => decodeSrgb(parseInt(raw.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.hypot(okA, okB);
  // A neutral has no meaningful hue; keeping the arctangent's noise would
  // make two greys that look identical resolve to different families.
  const h = c < 1e-4 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;
  return { l: okL, c, h };
}
