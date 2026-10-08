import { describe, expect, it } from "vitest";

import { describeEncoderStats, parseEncoderStats } from "@/services/webrtc-live";

const report = (totalEncodeTime: number, framesEncoded: number) => [
  { type: "codec", id: "c1", mimeType: "video/H264" },
  {
    type: "outbound-rtp",
    kind: "video",
    codecId: "c1",
    encoderImplementation: "MediaCodec",
    frameWidth: 3840,
    frameHeight: 2160,
    framesPerSecond: 60,
    totalEncodeTime,
    framesEncoded,
    qualityLimitationReason: "none",
  },
  { type: "candidate-pair", state: "succeeded", currentRoundTripTime: 0.004 },
];

describe("parseEncoderStats", () => {
  it("reads the encoder's identity and output from the outbound video stats", () => {
    const parsed = parseEncoderStats(report(1.2, 300), null);
    expect(parsed?.stats).toMatchObject({
      implementation: "MediaCodec",
      codec: "video/H264",
      width: 3840,
      height: 2160,
      framesPerSecond: 60,
      qualityLimitation: "none",
    });
    // No previous sample: a mean per-frame time cannot be formed yet.
    expect(parsed?.stats.encodeMsPerFrame).toBeNull();
    expect(parsed?.counters).toEqual({ totalEncodeTime: 1.2, framesEncoded: 300 });
  });

  it("forms the per-frame encode time from the change between two samples", () => {
    const first = parseEncoderStats(report(1.2, 300), null)!;
    const second = parseEncoderStats(report(1.5, 360), first.counters)!;
    // 0.3 s over 60 frames = 5 ms per frame.
    expect(second.stats.encodeMsPerFrame).toBe(5);
  });

  it("returns null when the browser exposes no outbound video", () => {
    expect(parseEncoderStats([{ type: "candidate-pair" }], null)).toBeNull();
  });

  it("describes the encoder in one HUD line, leaving out what is not known yet", () => {
    const first = parseEncoderStats(report(1.2, 300), null)!;
    expect(describeEncoderStats(first.stats)).toBe("MediaCodec · 3840×2160 · 60 fps");
    const second = parseEncoderStats(report(1.5, 360), first.counters)!;
    expect(describeEncoderStats({ ...second.stats, qualityLimitation: "cpu" })).toBe(
      "MediaCodec · 3840×2160 · 60 fps · 5.0 ms/frame · cpu-limited",
    );
  });
});
