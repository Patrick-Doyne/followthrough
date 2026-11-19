import { describe, expect, it } from "vitest";

import { recordingMimeType } from "@/lib/live-recording";

const frame = (frame_id: number, extra: Record<string, unknown> = {}) => ({
  type: "frame",
  frame_id,
  frame_width: 1920,
  frame_height: 1080,
  ...extra,
});

describe("recordingMimeType", () => {
  it("takes H.264 before VP8 or VP9, so a phone records in hardware", () => {
    const iphone = (type: string) =>
      type.startsWith("video/mp4") || type.includes("vp9") || type === "video/webm";
    expect(recordingMimeType(iphone)).toBe("video/mp4;codecs=avc1");
    const chromiumOnLinux = (type: string) => type.startsWith("video/webm");
    expect(recordingMimeType(chromiumOnLinux)).toBe("video/webm;codecs=h264");
  });

  it("leaves the choice to a browser that supports none of the list, or throws", () => {
    expect(recordingMimeType(() => false)).toBeUndefined();
    expect(
      recordingMimeType(() => {
        throw new TypeError("unsupported");
      }),
    ).toBeUndefined();
  });
});
