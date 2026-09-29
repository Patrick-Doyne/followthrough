/**
 * Whether an uploaded recording can be played as it arrived, and what to
 * transcode it to when it cannot.
 *
 * <p>This exists because of a bug that looked like data loss. A phone
 * shoots HEVC, no Chromium-based browser will decode it
 * (`canPlayType('video/mp4; codecs="hvc1"')` returns the empty string),
 * and a `<video>` element pointed at one reports `videoWidth === 0` and
 * paints nothing. With the analysis overlay drawn on a canvas above it --
 * which does not care what the video underneath is doing -- the result is
 * a perfectly rendered overlay floating on a black rectangle. The
 * recording was fine the whole time.
 *
 * <p>Until recently the pipeline hid this by accident: it re-encoded every
 * upload in order to burn the overlay into it, and H.264 fell out of that
 * as a side effect. Taking the burn out took the accidental transcode with
 * it, which is how a fix for one thing surfaced a latent problem in
 * another.
 *
 * <p>So the transcode is now explicit and conditional, and it writes a
 * **separate** file. The upload is never modified.
 */

export interface SourceFormat {
  width: number;
  height: number;
  videoCodec: string;
  /** null when the recording carries no audio track. */
  audioCodec: string | null;
}

/**
 * Codecs a browser will actually decode.
 *
 * <p>Deliberately a list of what is known to work rather than of what is
 * known to fail: a codec nobody here has heard of is far likelier to be
 * the next HEVC than the next H.264, and being wrong in this direction
 * costs one unnecessary transcode instead of a black player.
 */
export const PLAYABLE_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
export const PLAYABLE_AUDIO_CODECS = new Set(["aac", "opus", "vorbis", "mp3"]);

/** The long edge of a generated playback copy. */
export const PLAYBACK_LONG_EDGE = 1920;

export function needsPlaybackRendition(source: SourceFormat): boolean {
  if (!PLAYABLE_VIDEO_CODECS.has(source.videoCodec)) return true;
  return source.audioCodec !== null && !PLAYABLE_AUDIO_CODECS.has(source.audioCodec);
}

/**
 * The size to encode a playback copy at.
 *
 * <p>Capped, but only ever downwards and only when re-encoding was already
 * necessary for the clip to play at all. Three things make the cap safe:
 * the player is a few hundred CSS pixels wide, the overlay is drawn on its
 * own canvas at its own resolution rather than scaled with the video, and
 * the untouched original is still there for anyone who wants every pixel.
 *
 * <p>Rounded to even numbers because yuv420p -- the pixel format every
 * browser decodes in hardware -- cannot represent odd dimensions.
 */
export function playbackSize(
  width: number,
  height: number,
  longEdge: number = PLAYBACK_LONG_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return { width: 2, height: 2 };
  const scale = Math.min(1, longEdge / longest);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}
