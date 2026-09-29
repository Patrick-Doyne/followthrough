import { describe, expect, it } from "vitest";

import {
  needsPlaybackRendition,
  playbackSize,
  PLAYBACK_LONG_EDGE,
  type SourceFormat,
} from "@/lib/playback-format";

const source = (overrides: Partial<SourceFormat> = {}): SourceFormat => ({
  width: 3840,
  height: 2160,
  videoCodec: "h264",
  audioCodec: "aac",
  ...overrides,
});

describe("needsPlaybackRendition", () => {
  it("transcodes HEVC, which is the case this exists for", () => {
    // A phone shoots this, and the player draws a black rectangle with a
    // perfectly good overlay on top of it.
    expect(needsPlaybackRendition(source({ videoCodec: "hevc" }))).toBe(true);
  });

  it("leaves a recording the browser can already play alone", () => {
    // Re-encoding a playable file would be exactly the wasted work that
    // burning the overlay in used to cost.
    for (const codec of ["h264", "vp8", "vp9", "av1"]) {
      expect(needsPlaybackRendition(source({ videoCodec: codec })), codec).toBe(false);
    }
  });

  it("treats an unknown codec as unplayable rather than assuming", () => {
    // The list is of what is known to work. Being wrong this way costs one
    // transcode; being wrong the other way ships a black player.
    expect(needsPlaybackRendition(source({ videoCodec: "prores" }))).toBe(true);
    expect(needsPlaybackRendition(source({ videoCodec: "" }))).toBe(true);
  });

  it("transcodes for an unplayable audio track on a playable video one", () => {
    expect(needsPlaybackRendition(source({ audioCodec: "pcm_s16le" }))).toBe(true);
  });

  it("does not mind a recording with no audio at all", () => {
    expect(needsPlaybackRendition(source({ audioCodec: null }))).toBe(false);
  });
});

describe("playbackSize", () => {
  it("caps the long edge, keeping the aspect ratio", () => {
    expect(playbackSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(playbackSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
  });

  it("never enlarges a recording that is already smaller", () => {
    expect(playbackSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(playbackSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("always returns even dimensions, which yuv420p requires", () => {
    for (const [w, h] of [
      [1921, 1081],
      [999, 777],
      [4001, 2251],
      [3, 3],
    ]) {
      const size = playbackSize(w as number, h as number);
      expect(size.width % 2, `${w}x${h}`).toBe(0);
      expect(size.height % 2, `${w}x${h}`).toBe(0);
    }
  });

  it("keeps the aspect ratio within a pixel of the source", () => {
    for (const [w, h] of [
      [3840, 2160],
      [2160, 3840],
      [4032, 3024],
      [2560, 1440],
    ]) {
      const size = playbackSize(w as number, h as number);
      expect(size.width / size.height, `${w}x${h}`).toBeCloseTo((w as number) / (h as number), 2);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(PLAYBACK_LONG_EDGE);
    }
  });

  it("does not divide by zero on a source that reported no size", () => {
    expect(playbackSize(0, 0)).toEqual({ width: 2, height: 2 });
  });
});
