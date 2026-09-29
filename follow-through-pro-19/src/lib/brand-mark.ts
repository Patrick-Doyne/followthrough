/**
 * Preparing a user-supplied logo for storage.
 *
 * <p>The mark is kept in the settings document, which is persisted to
 * localStorage and mirrored to the account as a JSON string. That makes
 * size the whole problem: a school crest straight off a website is
 * routinely a 400KB PNG, and a handful of those would blow the storage
 * quota and make every settings write expensive.
 *
 * <p>So an upload is decoded, drawn into a small square and re-encoded
 * before it is ever stored. What gets kept is a fixed-size thumbnail,
 * not the file the user picked.
 */

/** Rendered at up to 96 CSS pixels, so 192 covers a 2x display and
 * nothing beyond that is ever visible. */
export const MARK_PIXELS = 192;

/** Refused before decoding. Generous enough for any real logo and small
 * enough that a mis-picked photo fails fast instead of locking the tab
 * up decoding 40 megapixels. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** After re-encoding. A 192px mark lands far below this; the check is
 * for the pathological case where an image resists compression. */
export const MAX_STORED_BYTES = 96 * 1024;

export type MarkError =
  "not-an-image" | "too-large" | "decode-failed" | "encode-failed" | "still-too-large";

export const MARK_ERROR_COPY: Record<MarkError, string> = {
  "not-an-image": "That file isn't an image. PNG, JPEG, WebP, GIF and SVG all work.",
  "too-large": "That image is over 8MB. Try exporting a smaller copy.",
  "decode-failed": "That image couldn't be read. It may be corrupt or an unsupported format.",
  "encode-failed": "This browser couldn't process that image.",
  "still-too-large": "That image is too detailed to store. Try a simpler logo.",
};

export type MarkResult = { ok: true; dataUrl: string } | { ok: false; error: MarkError };

/**
 * Fits a source image inside a square without cropping or distorting it.
 *
 * <p>Contain rather than cover: a crest is usually wider or taller than
 * it is square, and cropping one to fill a box cuts the edges off the
 * thing that identifies it. Letterboxing is the lesser harm, and the
 * transparent margin is invisible against the plate.
 */
export function containBox(
  width: number,
  height: number,
  box: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.min(box / width, box / height);
  const dw = Math.round(width * scale);
  const dh = Math.round(height * scale);
  return { dx: Math.round((box - dw) / 2), dy: Math.round((box - dh) / 2), dw, dh };
}

/** Picks the smallest of the encodings this browser will produce. WebP
 * usually wins by a wide margin, but Safari only gained it recently, so
 * PNG has to stay in the running. */
function smallest(candidates: string[]): string | null {
  const usable = candidates.filter((c) => c.startsWith("data:image/") && c.length > 64);
  if (usable.length === 0) return null;
  return usable.reduce((best, c) => (c.length < best.length ? c : best));
}

export async function prepareBrandMark(file: File): Promise<MarkResult> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "not-an-image" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "too-large" };

  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (!image) return { ok: false, error: "decode-failed" };

    const canvas = document.createElement("canvas");
    canvas.width = MARK_PIXELS;
    canvas.height = MARK_PIXELS;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: "encode-failed" };

    // An SVG with no intrinsic size decodes to 0x0 in some browsers;
    // fall back to the box rather than dividing by zero.
    const w = image.naturalWidth || MARK_PIXELS;
    const h = image.naturalHeight || MARK_PIXELS;
    const { dx, dy, dw, dh } = containBox(w, h, MARK_PIXELS);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, dx, dy, dw, dh);

    const dataUrl = smallest([canvas.toDataURL("image/webp", 0.9), canvas.toDataURL("image/png")]);
    if (!dataUrl) return { ok: false, error: "encode-failed" };
    if (dataUrl.length > MAX_STORED_BYTES) return { ok: false, error: "still-too-large" };
    return { ok: true, dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Guards what comes back out of storage. A settings document is
 * editable by hand and syncs from the account, so the stored string is
 * treated as untrusted: only a data URL for a real image type is
 * allowed anywhere near an `img` src. */
export function isStorableMark(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) &&
    value.length <= MAX_STORED_BYTES
  );
}
