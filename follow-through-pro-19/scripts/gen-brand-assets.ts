/**
 * Builds every shipped brand asset from the supplied logo.
 *
 *     npx vite-node scripts/gen-brand-assets.ts
 *
 * <p>Two transforms, both of which exist because the artwork was drawn
 * for a poster rather than for this app.
 *
 * <p>**Keying.** The logo is glow on a solid black ground. Undoing that
 * composite -- alpha from the brightest channel, colour divided back out
 * -- recovers a transparent version whose faint glow is faint *orange*
 * rather than opaque dark grey. Thresholding the alpha instead keeps the
 * grey and drags a smear of fog around wherever the mark sits on
 * anything but black.
 *
 * <p>**Normalising.** Every accent token in this app resolves to L 0.72
 * and C 0.166 x the theme's chroma gain -- `--primary`, `--hero-art` and
 * the rest. The artwork's own accent family was measured at L 0.697 and
 * C 0.212: a little darker and a lot more saturated, which is why it
 * read as heavier than the controls beside it even once its lightness
 * had been matched. A colour carrying more chroma at the same lightness
 * looks darker, so the fix for "the logo looks darker than the theme"
 * is chroma, not lightness.
 *
 * <p>Both are applied here rather than at runtime so that the shipped
 * file is *already* the logo at the app's own accent values. That buys
 * three things: the default theme needs no canvas pass and no
 * hold-back-until-ready on first paint, the re-hueing code at runtime
 * collapses to a hue offset and the accent's own chroma ratio, and the
 * numbers live in one place instead of being reapplied per render.
 *
 * <p>Both are scaled by how chromatic a pixel already is, so the silver
 * half of the wordmark and the white tagline stay neutral.
 */
import { createCanvas, loadImage, type Canvas } from "canvas";
import { writeFileSync } from "node:fs";

import { gamutMap, hexToOklch, oklchToHex } from "../src/lib/color";

const SOURCE = "brand-source/followthrough-logo.png";
const OUT = "public";

/** Where every accent token in the app sits. See `resolveHero`. */
const TOKEN_L = 0.72;
const TOKEN_C = 0.166;

/** Below this chroma a pixel is the wordmark's silver, not the accent. */
const NEUTRAL_C = 0.08;

/**
 * How much of the ground shows through the mark.
 *
 * <p>This is what actually made the logo read dark, and it took three
 * attempts to find because it is not a colour problem at all. The
 * artwork's own colours are fine -- measured, they average L 0.754,
 * above the accent tokens' 0.72. But most of the mark is *glow*, which
 * is semi-transparent, so the band shows through it: composited over
 * `--hero`, the mean fell to **L 0.521 with half the mark below 0.50**.
 * No amount of re-colouring reaches that, because the thing making it
 * dark is the background.
 *
 * <p>So the alpha is lifted. A gamma alone brightens the body but also
 * brings up the faintest haze, which on a dark ground turns into a
 * visible grey cloud around the ball -- the artwork was drawn on black,
 * where that haze is invisible and free. Clearing the bottom of the
 * alpha range first throws the haze away and lets the rest be lifted
 * much harder: measured, floor 0.08 then gamma 0.48 reads at **L 0.576
 * with 39% below 0.50**, and is the brightest setting that stays clean.
 * The soft edge survives, because only the faintest eighth is cut.
 */
const ALPHA_FLOOR = 0.08;
const ALPHA_GAMMA = 0.48;

/** `--hero`, resolved: the ground the mark stands on everywhere. */
const GROUND = "#0e1319";

/** The badge -- ball, trail, focus brackets -- measured in the source. */
const BADGE = { x: 210, y: 54, w: 579, h: 305 };

const hex2 = (v: number) => v.toString(16).padStart(2, "0");

function pixelsOf(canvas: Canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
}

/** Undoes the composite over black, then lands the accent family on the
 *  lightness and chroma the theme's own accent tokens use. */
function key(data: Uint8ClampedArray, stats: { l: number; c: number }): void {
  const dl = TOKEN_L - stats.l;
  const cr = TOKEN_C / stats.c;
  const cache = new Map<number, number>();

  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    if (m === 0) {
      data[i + 3] = 0;
      continue;
    }
    const a = m / 255;
    const r = Math.min(255, Math.round(data[i]! / a));
    const g = Math.min(255, Math.round(data[i + 1]! / a));
    const b = Math.min(255, Math.round(data[i + 2]! / a));
    const opacity = Math.pow(Math.max(0, (a - ALPHA_FLOOR) / (1 - ALPHA_FLOOR)), ALPHA_GAMMA);

    const packed = (r << 16) | (g << 8) | b;
    let mapped = cache.get(packed);
    if (mapped === undefined) {
      const source = hexToOklch(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
      mapped = source
        ? parseInt(
            oklchToHex(
              gamutMap({
                l: Math.min(1, source.l + dl * Math.min(1, source.c / NEUTRAL_C)),
                c: source.c * (1 + (cr - 1) * Math.min(1, source.c / NEUTRAL_C)),
                h: source.h,
              }),
            ).slice(1),
            16,
          )
        : packed;
      cache.set(packed, mapped);
    }
    data[i] = (mapped >> 16) & 0xff;
    data[i + 1] = (mapped >> 8) & 0xff;
    data[i + 2] = mapped & 0xff;
    data[i + 3] = Math.round(opacity * 255);
  }
}

/** The artwork's accent family: alpha-weighted mean over the chromatic
 *  pixels, which is the colour a viewer reads as "the logo's". */
function measure(data: Uint8ClampedArray, unpremultiplied: boolean) {
  let wl = 0,
    wc = 0,
    w = 0;
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    const a = unpremultiplied ? data[i + 3]! / 255 : m / 255;
    if (a < 0.25) continue;
    const d = unpremultiplied ? 1 : a;
    const o = hexToOklch(
      `#${hex2(Math.min(255, Math.round(data[i]! / d)))}${hex2(
        Math.min(255, Math.round(data[i + 1]! / d)),
      )}${hex2(Math.min(255, Math.round(data[i + 2]! / d)))}`,
    );
    if (!o || o.c < 0.04) continue;
    wl += o.l * a;
    wc += o.c * a;
    w += a;
  }
  return { l: wl / w, c: wc / w };
}

const src = await loadImage(SOURCE);
const full = createCanvas(src.width, src.height);
full.getContext("2d").drawImage(src, 0, 0);
const raw = pixelsOf(full);

const before = measure(raw.data, false);
console.log(`source artwork      L ${before.l.toFixed(3)}  C ${before.c.toFixed(3)}`);
console.log(`accent tokens       L ${TOKEN_L}  C ${TOKEN_C}`);

key(raw.data, before);
full.getContext("2d").putImageData(raw, 0, 0);
const after = measure(pixelsOf(full).data, true);
console.log(`normalised artwork  L ${after.l.toFixed(3)}  C ${after.c.toFixed(3)}\n`);

/** Trim to ink, so the asset carries no margin of its own. */
function inkBox(data: Uint8ClampedArray, w: number, h: number) {
  let x0 = w,
    x1 = -1,
    y0 = h,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]! > 6) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(box: { x: number; y: number; w: number; h: number }, out?: { side: number }) {
  if (!out) {
    const c = createCanvas(box.w, box.h);
    c.getContext("2d").drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    return c;
  }
  // Letterboxed into a square, padded rather than cropped: the badge is
  // wider than it is tall and cutting it to fill loses the brackets.
  const c = createCanvas(out.side, out.side);
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  const scale = out.side / box.w;
  g.drawImage(
    full,
    box.x,
    box.y,
    box.w,
    box.h,
    0,
    (out.side - box.h * scale) / 2,
    out.side,
    box.h * scale,
  );
  return c;
}

const box = inkBox(pixelsOf(full).data, full.width, full.height);
const lockup = crop(box);
writeFileSync(`${OUT}/brand/followthrough-lockup.png`, lockup.toBuffer("image/png"));
console.log(`followthrough-lockup.png  ${lockup.width}x${lockup.height}`);

/* The page reserves the mark's box from its aspect ratio, so the two
   have to agree. Trimming to ink means the dimensions move whenever the
   keying does -- the alpha floor alone took it from 866x526 to 850x495 --
   so they are written out rather than copied by hand. */
writeFileSync(
  "src/lib/brand-asset.ts",
  `// Generated by scripts/gen-brand-assets.ts. Do not edit.\n` +
    `export const BRAND_LOCKUP = {\n` +
    `  src: "/brand/followthrough-lockup.png",\n` +
    `  width: ${lockup.width},\n` +
    `  height: ${lockup.height},\n` +
    `} as const;\n`,
);
console.log(`src/lib/brand-asset.ts    ${lockup.width}x${lockup.height}`);

const badge = crop(BADGE, { side: 512 });
writeFileSync(`${OUT}/brand/followthrough-badge.png`, badge.toBuffer("image/png"));
console.log(`followthrough-badge.png   512x512`);

/** The tab icons bake in the ground, because a tab strip can be any colour. */
function icon(size: number, pad: number) {
  const c = createCanvas(size, size);
  const g = c.getContext("2d");
  g.fillStyle = GROUND;
  g.fillRect(0, 0, size, size);
  g.imageSmoothingQuality = "high";
  g.drawImage(badge, pad, pad, size - pad * 2, size - pad * 2);
  return c;
}

const png32 = icon(32, 1).toBuffer("image/png");
for (const [file, size, pad] of [
  ["favicon-32.png", 32, 1],
  ["favicon-192.png", 192, 8],
  ["apple-touch-icon.png", 180, 14],
] as const) {
  writeFileSync(`${OUT}/${file}`, icon(size, pad).toBuffer("image/png"));
  console.log(`${file.padEnd(25)} ${size}x${size}`);
}

/** A single-image .ico wrapping the 32px PNG, for the bare /favicon.ico
 *  request browsers make whatever the document says. */
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(1, 4);
const dir = Buffer.alloc(16);
dir[0] = 32;
dir[1] = 32;
dir.writeUInt16LE(1, 4);
dir.writeUInt16LE(32, 6);
dir.writeUInt32LE(png32.length, 8);
dir.writeUInt32LE(22, 12);
writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([head, dir, png32]));
console.log(`favicon.ico               ${22 + png32.length} bytes`);
