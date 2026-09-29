import { describe, expect, it } from "vitest";

import { extensionFor, pickMimeType } from "@/lib/overlay-export";

describe("pickMimeType", () => {
  it("returns null where MediaRecorder does not exist at all", () => {
    // Server rendering, and older browsers. The caller hides the button
    // rather than offering a download that cannot happen.
    expect(pickMimeType()).toBeNull();
  });

  it("takes the first container the browser admits to supporting", () => {
    const original = globalThis.MediaRecorder;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
      isTypeSupported: (t: string) => t.startsWith("video/webm"),
    };
    try {
      expect(pickMimeType(["video/mp4;codecs=avc1", "video/webm;codecs=vp9"])).toBe(
        "video/webm;codecs=vp9",
      );
      expect(pickMimeType(["video/mp4;codecs=avc1"])).toBeNull();
    } finally {
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = original;
    }
  });
});

describe("extensionFor", () => {
  it("names the file after what is actually inside it", () => {
    expect(extensionFor("video/mp4;codecs=avc1")).toBe("mp4");
    expect(extensionFor("video/webm;codecs=vp9")).toBe("webm");
  });
});
