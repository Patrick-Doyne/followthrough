/**
 * The container and codec a live session's recording is written in.
 */

/**
 * The formats a live recording is asked for, most preferred first. The
 * recording runs alongside the WebRTC encode of the same camera, so the
 * codec has to be one the device encodes in hardware: H.264 is, on every
 * phone and most laptops, while VP9 and VP8 are software there. An iPhone
 * answers yes to VP9-in-WebM and then spends the whole CPU on a 4K software
 * encode until the browser kills the page a few seconds into the session,
 * which is how the order below was arrived at. The last entry lets the
 * browser choose, so recording never fails to start for want of a format.
 */
export const RECORDING_FORMAT_PREFERENCE: readonly string[] = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=h264",
  "video/webm;codecs=vp8",
  "video/webm;codecs=vp9",
  "video/webm",
];

/** Pure: the first format the browser supports, or undefined for its default. */
export function recordingMimeType(
  isSupported: (type: string) => boolean,
  preference: readonly string[] = RECORDING_FORMAT_PREFERENCE,
): string | undefined {
  for (const type of preference) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* a browser that throws for a type it does not know: try the next */
    }
  }
  return undefined;
}
