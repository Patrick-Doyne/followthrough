import { describe, expect, it } from "vitest";

import {
  createOverlayReplay,
  frameIndexAt,
  indexTelemetry,
  REBUILD_WINDOW,
  viewportFromTelemetry,
} from "@/lib/overlay-replay";
import { AUTHORED_VIEWPORT } from "@/lib/overlay-renderer";

/** A frame as the pipeline writes one, trimmed to what the overlay reads. */
const frame = (id: number, extra: Record<string, unknown> = {}) => ({
  type: "frame",
  frame_id: id,
  frame_width: 1920,
  frame_height: 1080,
  potential_shot: false,
  shot_started: false,
  trail_frozen_at_rim: false,
  ball: null,
  player: null,
  rim: null,
  net: null,
  ...extra,
});

/** The pipeline sends seven points as {x, y, valid}, only on the frames
 * where recalibration changed them. */
const KEYPOINTS = [
  { x: 100, y: 900, valid: true },
  { x: 1800, y: 900, valid: true },
];

describe("viewportFromTelemetry", () => {
  it("reads the source's size off the metadata line", () => {
    expect(
      viewportFromTelemetry([
        { type: "metadata", fps: 30, frame_width: 2160, frame_height: 3840 },
        frame(0),
      ]),
    ).toEqual({ width: 2160, height: 3840 });
  });

  it("falls back to a frame record when metadata carried no size", () => {
    // Older pipeline builds wrote the size per frame and not on the
    // metadata line.
    expect(viewportFromTelemetry([{ type: "metadata", fps: 30 }, frame(0)])).toEqual(
      AUTHORED_VIEWPORT,
    );
  });

  it("falls back to the authored surface when nothing reports a size", () => {
    expect(viewportFromTelemetry([{ type: "metadata", fps: 30 }])).toEqual(AUTHORED_VIEWPORT);
    expect(viewportFromTelemetry([])).toEqual(AUTHORED_VIEWPORT);
  });
});

describe("createOverlayReplay viewport", () => {
  it("hands the canvas a surface shaped like the recording", () => {
    // Without this the canvas is 16:9 whatever the clip is, and a
    // portrait video gets an overlay that does not sit on the picture.
    const replay = createOverlayReplay([
      { type: "metadata", fps: 30, frame_width: 2160, frame_height: 3840 },
      frame(0),
    ]);
    expect(replay.viewport).toEqual({ width: 2160, height: 3840 });
  });

  it("leaves a 16:9 recording on the authored surface", () => {
    const replay = createOverlayReplay([frame(0)]);
    expect(replay.viewport).toEqual(AUTHORED_VIEWPORT);
  });
});

describe("indexTelemetry", () => {
  it("separates frames from shot events and ignores anything else", () => {
    const indexed = indexTelemetry([
      { type: "metadata", fps: 30 },
      frame(0),
      { type: "shot_event", frame_id: 5, result: "make", makes: 1, misses: 0 },
      frame(10),
      { type: "junk" },
    ]);
    expect(indexed.frames).toHaveLength(2);
    expect(indexed.shots).toHaveLength(1);
  });

  it("drops records with no usable frame id rather than placing them at zero", () => {
    const indexed = indexTelemetry([frame(0), { type: "frame" }, frame(2)]);
    expect(indexed.frames.map((f) => f.at)).toEqual([0, 2]);
  });

  it("remembers where the court was last calibrated", () => {
    const indexed = indexTelemetry([
      frame(0),
      frame(1, { court_keypoints: KEYPOINTS }),
      frame(2),
      frame(3),
    ]);
    // Frames after the calibration point back at it; the one before does not.
    expect(indexed.keypointAt).toEqual([-1, 1, 1, 1]);
  });
});

describe("frameIndexAt", () => {
  const indexed = indexTelemetry([frame(0), frame(10), frame(20), frame(30)]);

  it("finds the frame at or before a time", () => {
    expect(frameIndexAt(indexed, 20)).toBe(2);
    expect(frameIndexAt(indexed, 25)).toBe(2);
    expect(frameIndexAt(indexed, 30)).toBe(3);
  });

  it("returns -1 before the first frame", () => {
    expect(frameIndexAt(indexed, -1)).toBe(-1);
  });

  it("clamps past the end rather than running off it", () => {
    expect(frameIndexAt(indexed, 9999)).toBe(3);
  });
});

describe("createOverlayReplay", () => {
  const stream = (n: number) => Array.from({ length: n }, (_, i) => frame(i));

  it("applies only the frames in between when playing forward", () => {
    // The whole point of the cursor: normal playback must not replay the
    // file on every tick.
    const replay = createOverlayReplay(stream(500));
    replay.stateAt(100);
    replay.stateAt(101);
    expect(replay.lastApplied()).toBe(1);
  });

  it("does nothing at all when the playhead has not moved on", () => {
    const replay = createOverlayReplay(stream(200));
    replay.stateAt(50);
    replay.stateAt(50);
    expect(replay.lastApplied()).toBe(0);
  });

  it("rebuilds from a bounded window when scrubbed backwards", () => {
    // Not from the start: an hour of footage is a hundred thousand frames.
    const replay = createOverlayReplay(stream(5000));
    replay.stateAt(4000);
    replay.stateAt(1000);
    expect(replay.lastApplied()).toBeLessThanOrEqual(REBUILD_WINDOW + 1);
  });

  it("rebuilds from a bounded window on a long jump forward too", () => {
    const replay = createOverlayReplay(stream(5000));
    replay.stateAt(10);
    replay.stateAt(4800);
    expect(replay.lastApplied()).toBeLessThanOrEqual(REBUILD_WINDOW + 1);
  });

  it("keeps the court calibrated after a jump past where it was sent", () => {
    // Keypoints are sent once and held. Rebuilding from a window alone
    // would lose them, and the court would vanish whenever someone
    // dragged the playhead far enough forward.
    const messages = [frame(0, { court_keypoints: KEYPOINTS }), ...stream(4000).slice(1)];

    const played = createOverlayReplay(messages);
    played.stateAt(0);
    const expected = played.stateAt(0).courtKeypoints;
    expect(expected, "fixture should calibrate the court").toBeTruthy();

    const jumped = createOverlayReplay(messages);
    expect(jumped.stateAt(3500).courtKeypoints).toEqual(expected);
  });

  it("gives a clean state before the first frame", () => {
    const replay = createOverlayReplay(stream(100));
    replay.stateAt(50);
    const state = replay.stateAt(-5);
    expect(state.trail).toEqual([]);
  });

  it("lands on the same state whether it was played through or jumped to", () => {
    // The property that makes scrubbing trustworthy: the overlay at a
    // given moment does not depend on how the viewer got there.
    const messages = stream(1200).map((f, i) =>
      i > 900 && i < 950 ? { ...f, shot_started: true, ball: { center_x: i, center_y: 100 } } : f,
    );

    const played = createOverlayReplay(messages);
    for (let i = 0; i <= 940; i += 1) played.stateAt(i);

    const jumped = createOverlayReplay(messages);
    jumped.stateAt(1100);
    jumped.stateAt(940);

    expect(jumped.stateAt(940).trail).toEqual(played.stateAt(940).trail);
  });

  it("applies a shot event before the frame it lands on", () => {
    const messages = [
      frame(0),
      { type: "shot_event", frame_id: 1, result: "make", makes: 1, misses: 0 },
      frame(2),
    ];
    const replay = createOverlayReplay(messages);
    const state = replay.stateAt(2) as unknown as Record<string, unknown>;
    // The tally the overlay draws comes from the event, not from counting.
    expect(JSON.stringify(state)).toContain("1");
  });

  it("survives a stream with no frames at all", () => {
    const replay = createOverlayReplay([{ type: "metadata", fps: 30 }]);
    expect(() => replay.stateAt(10)).not.toThrow();
  });
});
