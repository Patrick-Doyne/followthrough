import { describe, expect, it } from "vitest";

import {
  describeEncoderStats,
  parseEncoderStats,
  tuneVideoSdp,
  bitrateEnvelope,
  nextSendCapKbps,
} from "@/services/webrtc-live";

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

describe("tuneVideoSdp", () => {
  const sdp = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "m=video 9 UDP/TLS/RTP/SAVPF 108 109",
    "a=rtpmap:108 H264/90000",
    "a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    "a=rtpmap:109 rtx/90000",
    "a=fmtp:109 apt=108",
  ].join("\r\n");

  it("sets the start, floor and cap bit rates on every H.264 format line and a session cap on the video section", () => {
    const tuned = tuneVideoSdp(sdp, bitrateEnvelope(3840, 2160)).split("\r\n");
    expect(tuned).toContain("b=AS:40000");
    expect(tuned.indexOf("b=AS:40000")).toBe(
      tuned.indexOf("m=video 9 UDP/TLS/RTP/SAVPF 108 109") + 1,
    );
    expect(tuned).toContain(
      "a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=2000;x-google-min-bitrate=1000;x-google-max-bitrate=40000",
    );
    // Audio and the rtx format are untouched.
    expect(tuned).toContain("a=fmtp:111 minptime=10;useinbandfec=1");
    expect(tuned).toContain("a=fmtp:109 apt=108");
  });

  it("is idempotent", () => {
    const once = tuneVideoSdp(sdp, bitrateEnvelope(3840, 2160));
    expect(tuneVideoSdp(once, bitrateEnvelope(3840, 2160))).toBe(once);
  });

  it("scales the envelope with the captured area", () => {
    const tuned = tuneVideoSdp(sdp, bitrateEnvelope(1280, 720)).split("\r\n");
    expect(tuned).toContain("b=AS:4444");
    expect(tuned).toContain(
      "a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=2000;x-google-min-bitrate=1000;x-google-max-bitrate=4444",
    );
  });
});

describe("bitrateEnvelope", () => {
  it("gives 4K the full cap, 1080p a quarter of it, and never less than the floor", () => {
    expect(bitrateEnvelope(3840, 2160)).toEqual({
      maxBps: 40_000_000,
      maxKbps: 40_000,
      startKbps: 2_000,
      minKbps: 1_000,
    });
    expect(bitrateEnvelope(1920, 1080)).toEqual({
      maxBps: 10_000_000,
      maxKbps: 10_000,
      startKbps: 2_000,
      minKbps: 1_000,
    });
    expect(bitrateEnvelope(320, 180).maxBps).toBe(2_500_000);
  });

  it("falls back to the live capture policy's size when the track's is unknown", () => {
    expect(bitrateEnvelope(0, 0)).toEqual(bitrateEnvelope(1280, 720));
  });
});

describe("nextSendCapKbps", () => {
  it("cuts when the round trip has risen well above the link's own floor", () => {
    expect(nextSendCapKbps(4444, 900, 600, 2, 4444)).toEqual({ capKbps: 3333, cleanChecks: 0 });
    expect(nextSendCapKbps(900, 900, 600, 0, 4444)).toEqual({ capKbps: 800, cleanChecks: 0 });
  });

  it("leaves a slow but steady link alone", () => {
    expect(nextSendCapKbps(2000, 650, 600, 0, 4444)).toEqual({ capKbps: 2000, cleanChecks: 1 });
  });

  it("climbs back only after three clean checks, never past the envelope", () => {
    expect(nextSendCapKbps(1000, 40, 30, 2, 4444)).toEqual({ capKbps: 1250, cleanChecks: 0 });
    expect(nextSendCapKbps(4000, 40, 30, 2, 4444)).toEqual({ capKbps: 4444, cleanChecks: 0 });
  });

  it("holds in between, and waits until it has a baseline", () => {
    expect(nextSendCapKbps(1000, 150, 30, 2, 4444)).toEqual({ capKbps: 1000, cleanChecks: 0 });
    expect(nextSendCapKbps(1000, 150, null, 2, 4444)).toEqual({ capKbps: 1000, cleanChecks: 2 });
  });
});
