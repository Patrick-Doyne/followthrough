import { gamutMap, hexToOklch, oklchToHex, parseOklch } from "@/lib/color";

/**
 * Re-hues the video overlay to the accent the user picked.
 *
 * <p>The overlay's drawing code carries nineteen distinct warm colours --
 * the panel edge, the trail, the arc, the lit gradients on the shot
 * graphic. Measured, every one is the same orange at a different
 * lightness: a single family, ramped, and that ramp is what gives the
 * artwork its depth. So the accent is applied as a **transform of the
 * family**, not a repaint of each member.
 *
 * <p>The transform is the one this product already uses for its own theme
 * tokens (see `scripts/gen-theme-recipe.ts`): an absolute lightness, a
 * hue offset and a chroma ratio.
 *
 * | Channel | Treatment | Why |
 * | --- | --- | --- |
 * | Lightness | kept exactly | it *is* the ramp; moving it flattens the artwork |
 * | Hue | offset by the accent's offset | this is what "following the theme" means |
 * | Chroma | scaled by the accent's ratio | a muted accent mutes the overlay with it |
 *
 * <p>All of it in OKLCH, which is the point. The first version of this
 * rotated hue in HSL, and HSL's "lightness" is not lightness: rotating the
 * artwork's core orange `#ff8c00` to the Lane red preset dropped it from
 * OKLCH L 0.751 to 0.643 -- **eleven points darker** -- while the pale
 * highlights, which have less chroma to go wrong, moved by three. That is
 * exactly the report that prompted this rewrite: "the red is noticeably
 * darker and the other colors are more or less accurate." In OKLCH the
 * same mapping holds every one of them to within 0.1 of a point.
 *
 * <p>The six neutrals -- panel body, hairlines, text -- are not mapped.
 * They are the dark chrome the overlay is drawn on, not brand.
 */

/**
 * How to move the artwork's accent family onto another accent.
 *
 * @property dh hue offset, in OKLCH degrees
 * @property cr chroma ratio, 1 for an accent as saturated as the default
 */
export interface OverlayAccentMap {
  dh: number;
  cr: number;
}

/** Leaves the artwork exactly as drawn. */
export const OVERLAY_ACCENT_IDENTITY: OverlayAccentMap = { dh: 0, cr: 1 };

export function isIdentityMap(map: OverlayAccentMap): boolean {
  return map.dh === 0 && map.cr === 1;
}

/**
 * The mapping from the shipped accent onto `accentCss`.
 *
 * <p>Measured against the *shipped accent* rather than against the hue the
 * artwork happens to be drawn at. Those are not the same number, so
 * anchoring on the artwork would nudge the approved overlay for a user who
 * had changed nothing. Against the shipped accent the default maps by
 * exactly zero, which is the one case that has to be pixel-for-pixel.
 *
 * <p>Give it the user's chosen accent -- the triad -- not a resolved
 * `primary` token. Those tokens are re-solved per palette for contrast
 * against a page background, and the overlay has no page background: it
 * sits on video, which is dark in every theme. Feeding it the light
 * palette's darker primary, or high contrast's 5-degree hue shift, would
 * move the artwork for a reason that does not apply to it.
 */
export function overlayAccentMap(accentCss: string, defaultAccentCss: string): OverlayAccentMap {
  const to = parseOklch(accentCss);
  const from = parseOklch(defaultAccentCss);
  if (!to || !from || from.c <= 0) return OVERLAY_ACCENT_IDENTITY;
  return { dh: to.h - from.h, cr: to.c / from.c };
}

/**
 * Moves one of the artwork's warm colours onto the mapped family.
 *
 * <p>Out-of-gamut results are resolved by reducing chroma, never by
 * clipping channels: chroma is the one of the three we have already
 * agreed to negotiate, and clipping would move lightness and hue too.
 */
export function mapWarmHex(hex: string, map: OverlayAccentMap): string {
  if (isIdentityMap(map)) return hex;
  const source = hexToOklch(hex);
  if (!source) return hex;
  return oklchToHex(
    gamutMap({ l: source.l, c: Math.max(0, source.c * map.cr), h: source.h + map.dh }),
  );
}
