import { isIdentityMap, mapWarmHex, type OverlayAccentMap } from "@/lib/overlay-palette";

/**
 * Re-hues the logo artwork to the accent the viewer picked.
 *
 * <p>The logo is a raster, so there is no `currentColor` to set and no
 * path to restyle. The pixels themselves have to move, and the move has
 * to be the one the rest of this product already uses: keep lightness
 * exactly, offset hue, scale chroma, all in OKLCH. That is
 * `mapWarmHex`, written for the video overlay, which had the identical
 * problem -- a fixed warm artwork that had to follow an arbitrary
 * accent -- and which was rewritten once already because rotating hue
 * in HSL dropped the core orange eleven points of lightness.
 *
 * <p>Keeping lightness is correct *because of how the file is built*:
 * `scripts/gen-brand-assets.ts` has already landed the artwork's accent
 * family on L 0.72 and C 0.166, which is where every accent token in
 * the app resolves. So the shipped file is the logo at the theme's own
 * values, a hue offset lands it on another accent, and the chroma ratio
 * carries a muted or a vivid theme with it. Nothing has to be corrected
 * per render, and the default theme needs no work at all.
 *
 * <p>Two properties of the artwork make this cheap enough to do in the
 * browser:
 *
 * <ul>
 *   <li>It has around <strong>14,000 distinct colours</strong> across
 *       455,516 pixels, so a cache keyed on the packed RGB turns the
 *       OKLCH round trip into a map lookup for all but 3% of the
 *       work.</li>
 *   <li>Its greys are genuinely grey. Chroma is multiplied, so a pixel
 *       with none keeps none: the silver half of the wordmark and the
 *       white tagline stay neutral under every accent without being
 *       masked out by hand.</li>
 * </ul>
 *
 * <p>Alpha is not touched. The artwork is stored unpremultiplied, so its
 * colour channels are true colour even where it is nearly transparent,
 * and mapping them directly is correct.
 */
export type BrandTint = OverlayAccentMap;

export { overlayAccentMap as brandTint } from "@/lib/overlay-palette";

/** True when there is nothing to do and the shipped file is the answer. */
export function isUntinted(tint: BrandTint): boolean {
  return isIdentityMap(tint);
}

export function tintPixels(data: Uint8ClampedArray, tint: BrandTint): void {
  if (isUntinted(tint)) return;
  const cache = new Map<number, number>();
  const hex2 = (v: number) => v.toString(16).padStart(2, "0");

  for (let i = 0; i < data.length; i += 4) {
    // Fully transparent pixels have no colour to move, and skipping them
    // is a third of the artwork.
    if (data[i + 3] === 0) continue;

    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = (r << 16) | (g << 8) | b;

    let mapped = cache.get(key);
    if (mapped === undefined) {
      mapped = parseInt(mapWarmHex(`#${hex2(r)}${hex2(g)}${hex2(b)}`, tint).slice(1), 16);
      cache.set(key, mapped);
    }

    data[i] = (mapped >> 16) & 0xff;
    data[i + 1] = (mapped >> 8) & 0xff;
    data[i + 2] = mapped & 0xff;
  }
}

/**
 * The artwork at `src`, re-hued, as a data URL.
 *
 * <p>A data URL rather than an object URL on purpose: the result is
 * cached for as long as the accent stays put, and a data URL cannot be
 * leaked by forgetting to revoke it while somebody drags the colour
 * picker.
 */
export async function tintImage(src: string, tint: BrandTint): Promise<string> {
  if (isUntinted(tint)) return src;

  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`could not load ${src}`));
    image.src = src;
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) return src;

  ctx.drawImage(image, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  tintPixels(frame.data, tint);
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
}
