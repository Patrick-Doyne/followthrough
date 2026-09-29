import { describe, expect, it } from "vitest";

import { deriveLiveStatus, type LiveStatusInput } from "@/lib/live-status";

const healthy: LiveStatusInput = {
  active: true,
  camera: "connected",
  webrtc: "connected",
  telemetryStale: false,
  videoStalled: false,
  hidden: false,
};

const at = (patch: Partial<LiveStatusInput>) => deriveLiveStatus({ ...healthy, ...patch });

describe("deriveLiveStatus", () => {
  it("reports live only when everything is actually healthy", () => {
    const status = at({});
    expect(status.kind).toBe("live");
    expect(status.stalePicture).toBe(false);
  });

  it("never reports live while telemetry is stale", () => {
    // This is the whole point of the module. Previously a stalled
    // DataChannel left a frozen frame on screen while the indicator kept
    // saying connected.
    const status = at({ telemetryStale: true });
    expect(status.kind).toBe("reconnecting");
    expect(status.stalePicture).toBe(true);
  });

  it("never reports live while the camera clock has stopped", () => {
    const status = at({ videoStalled: true });
    expect(status.kind).toBe("reconnecting");
    expect(status.stalePicture).toBe(true);
  });

  it("distinguishes a stalled camera from stalled telemetry", () => {
    // Different causes, different fixes, so they must not share copy.
    expect(at({ videoStalled: true }).label).not.toBe(at({ telemetryStale: true }).label);
  });

  it("does not cry stale while the tab is hidden", () => {
    // A backgrounded tab is throttled by the browser. Flagging that would
    // show a false warning to anyone picking their phone back up.
    const status = at({ hidden: true, telemetryStale: true, videoStalled: true });
    expect(status.kind).toBe("live");
    expect(status.stalePicture).toBe(false);
  });

  it("puts camera problems ahead of pipeline state", () => {
    // Telling someone the pipeline is connecting when their camera is
    // blocked sends them to the wrong place.
    const status = at({ camera: "denied", webrtc: "connecting-relay" });
    expect(status.kind).toBe("disconnected");
    expect(status.label).toBe("Camera blocked");
    expect(status.action).toBe("Try again");
  });

  it("offers an action for every state the person can act on", () => {
    for (const camera of ["denied", "unavailable", "error"] as const) {
      expect(at({ camera }).action, camera).toBe("Try again");
    }
    expect(at({ webrtc: "failed" }).action).toBe("Restart session");
  });

  it("offers no action where there is nothing useful to do", () => {
    expect(at({ camera: "initializing" }).action).toBeUndefined();
    expect(at({}).action).toBeUndefined();
    expect(at({ telemetryStale: true }).action).toBeUndefined();
  });

  it("is idle before a session starts, and says what to do", () => {
    const status = at({ active: false });
    expect(status.kind).toBe("idle");
    // Copy is direction, not an apology.
    expect(status.detail).toMatch(/point the camera/i);
  });

  it("marks the picture stale whenever the link is down, not just when quiet", () => {
    // A dropped link means the frame on screen is old even though telemetry
    // did not "go quiet" in the timer's sense.
    expect(at({ webrtc: "disconnected" }).stalePicture).toBe(true);
    expect(at({ webrtc: "failed" }).stalePicture).toBe(true);
  });

  it("never reports live while the client is retrying", () => {
    // The state was added with the reconnect loop; without an explicit
    // branch it would fall through to the connected case and claim Live
    // while the link is down.
    const status = at({ webrtc: "reconnecting" });
    expect(status.kind).toBe("reconnecting");
    expect(status.stalePicture).toBe(true);
  });

  it("offers no action while a retry is in flight", () => {
    // Offering one would invite someone to restart a session that is
    // already recovering on its own.
    expect(at({ webrtc: "reconnecting" }).action).toBeUndefined();
    expect(at({ webrtc: "disconnected" }).action).toBeUndefined();
    // Terminal failure is the one that genuinely needs a person.
    expect(at({ webrtc: "failed" }).action).toBe("Restart session");
  });

  it("treats every pre-connection webrtc state as connecting", () => {
    for (const webrtc of ["idle", "connecting-relay", "waiting-for-viewer"] as const) {
      expect(at({ webrtc }).kind, webrtc).toBe("connecting");
    }
  });

  it("writes every label and detail in sentence case", () => {
    const inputs: Partial<LiveStatusInput>[] = [
      {},
      { active: false },
      { camera: "denied" },
      { camera: "unavailable" },
      { camera: "error" },
      { camera: "initializing" },
      { webrtc: "failed" },
      { webrtc: "disconnected" },
      { webrtc: "reconnecting" },
      { webrtc: "connecting-relay" },
      { telemetryStale: true },
      { videoStalled: true },
    ];
    for (const patch of inputs) {
      const { label, detail } = at(patch);
      expect(label, `label: ${label}`).not.toMatch(/^[A-Z]{2,}/);
      expect(detail.endsWith("."), `detail should be a sentence: ${detail}`).toBe(true);
    }
  });
});
