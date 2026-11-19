import { describe, expect, it } from "vitest";
import { describeCandidateInit, summariseStats } from "./webrtc-live";

describe("summariseStats", () => {
  const report = [
    { id: "T", type: "transport", selectedCandidatePairId: "P" },
    {
      id: "P",
      type: "candidate-pair",
      state: "succeeded",
      nominated: true,
      localCandidateId: "L",
      remoteCandidateId: "R",
      currentRoundTripTime: 0.012,
      availableOutgoingBitrate: 2_500_000,
      requestsSent: 9,
      responsesReceived: 8,
    },
    {
      id: "L",
      type: "local-candidate",
      candidateType: "host",
      protocol: "udp",
      address: "192.168.1.59",
      port: 50000,
    },
    {
      id: "R",
      type: "remote-candidate",
      candidateType: "prflx",
      protocol: "udp",
      address: "192.168.1.151",
      port: 61000,
    },
    {
      id: "O",
      type: "outbound-rtp",
      kind: "video",
      framesSent: 120,
      bytesSent: 1_250_000,
      frameWidth: 1280,
      frameHeight: 720,
      framesPerSecond: 24,
      qualityLimitationReason: "bandwidth",
    },
    { id: "RI", type: "remote-inbound-rtp", kind: "video", packetsLost: 3, fractionLost: 0.02 },
  ];

  it("names the path, the sender's behaviour and the receiver's view on one line", () => {
    const { line, counters } = summariseStats(report, { at: 5_000, bytesSent: 250_000 }, 10_000);
    expect(line).toBe(
      "path host udp 192.168.1.59:50000 -> prflx udp 192.168.1.151:61000 · rtt 12 ms · estimate 2500 kbit/s · checks 8/9 · sent 120 frames · 1600 kbit/s · 1280x720 · 24 fps · limited by bandwidth · backend reports lost 3 loss 2.0%",
    );
    expect(counters).toEqual({ at: 10_000, bytesSent: 1_250_000 });
  });

  it("says so when there is no path and no video yet", () => {
    expect(summariseStats([], null, 0).line).toBe("path none · no outbound video statistics");
  });
});

describe("describeCandidateInit", () => {
  it("reads type, protocol and address off the SDP line", () => {
    expect(
      describeCandidateInit({
        candidate: "candidate:1 1 UDP 2130706431 172.21.230.43 44341 typ host",
      }),
    ).toBe("host udp 172.21.230.43:44341");
  });
});
