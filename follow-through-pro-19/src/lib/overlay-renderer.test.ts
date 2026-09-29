import { describe, expect, it } from "vitest";

import {
  applyFrame,
  applyShotEvent,
  AUTHORED_VIEWPORT,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  makeFreshPersistentState,
  OVERLAY_SHORT_EDGE,
  DEFAULT_PANEL_SCALE,
  panelSize,
  PANEL_METRICS,
  remapFrameCoordinates,
  staticPanelLayout,
  viewportForFrame,
} from "@/lib/overlay-renderer";
import type { BallBox, FrameTelemetry, ShotEventMessage } from "@/types/overlay-telemetry";

function makeFrame(overrides: Partial<FrameTelemetry> = {}): FrameTelemetry {
  return {
    type: "frame",
    frame_id: 0,
    frame_width: 640,
    frame_height: 480,
    potential_shot: false,
    shot_started: false,
    ball: null,
    player: null,
    rim: null,
    net: null,
    pose: null,
    trail_frozen_at_rim: false,
    apex_point: null,
    player_distance_ft: null,
    player_speed_mph: null,
    player_stat_is_projected: false,
    shot_designation: null,
    time_to_apex: null,
    shot_duration: null,
    shot_distance_ft: null,
    ...overrides,
  };
}

function makeShotEvent(overrides: Partial<ShotEventMessage> = {}): ShotEventMessage {
  return {
    type: "shot_event",
    frame_id: 0,
    result: "make",
    makes: 0,
    misses: 0,
    shot_designation: null,
    ...overrides,
  };
}

function ballAt(centerX: number, centerY: number): BallBox {
  return { x1: null, y1: null, x2: null, y2: null, center_x: centerX, center_y: centerY };
}

describe("staticPanelLayout", () => {
  const arrangement = (width: number, height: number) => {
    const layout = staticPanelLayout(viewportForFrame(width, height));
    return layout.tracker.y > layout.summary.y ? "stacked" : "beside";
  };

  it("starts both panels at three quarters of their authored size", () => {
    const layout = staticPanelLayout(AUTHORED_VIEWPORT);
    expect(layout.summary.scale).toBe(DEFAULT_PANEL_SCALE);
    expect(layout.tracker.scale).toBe(DEFAULT_PANEL_SCALE);
    expect(panelSize("summary", layout.summary.scale)).toEqual({ width: 690, height: 592.5 });
  });

  it("puts the pair side by side on a 16:9 frame, as authored", () => {
    const layout = staticPanelLayout(AUTHORED_VIEWPORT);
    expect(layout.tracker.y).toBe(layout.summary.y);
    // Adjacent: exactly one scaled gap between them, so they read as a
    // pair rather than as two things that happen to be near each other.
    expect(layout.tracker.x - layout.summary.x).toBeCloseTo(
      (PANEL_METRICS.summary.width + PANEL_METRICS.gap) * DEFAULT_PANEL_SCALE,
      6,
    );
  });

  it("keeps it side by side on a 4:3 frame, which still has the width", () => {
    expect(arrangement(1440, 1080)).toBe("beside");
  });

  it("stacks the pair into a column on a portrait frame", () => {
    /*
     * Side by side would be 58% of a portrait frame's width, against 46%
     * of a 16:9 one. That turns the chrome into a band across the top
     * with the rim behind it, and on phone footage the rim is always high
     * in frame. Stacked, they are still adjacent -- just in a column.
     */
    expect(arrangement(2160, 3840)).toBe("stacked");
    expect(arrangement(1080, 1920)).toBe("stacked");
  });

  it("stacks on a square frame too", () => {
    expect(arrangement(1000, 1000)).toBe("stacked");
  });

  it("leaves a scaled margin from the frame edge, not a fixed one", () => {
    // A margin that stayed 48px while the panels shrank would read as a
    // panel that had drifted away from the corner.
    const layout = staticPanelLayout(AUTHORED_VIEWPORT);
    expect(layout.summary.x).toBe(PANEL_METRICS.margin * DEFAULT_PANEL_SCALE);
    expect(layout.summary.y).toBe(PANEL_METRICS.margin * DEFAULT_PANEL_SCALE);
  });
});

describe("viewportForFrame", () => {
  it("leaves any 16:9 source on the surface the artwork was authored in", () => {
    // The case that must not move: every clip the approved overlay was
    // signed off against is 16:9, whatever its resolution.
    for (const [w, h] of [
      [3840, 2160],
      [1920, 1080],
      [1280, 720],
      [7680, 4320],
    ]) {
      expect(viewportForFrame(w as number, h as number)).toEqual(AUTHORED_VIEWPORT);
    }
  });

  it("takes the source's aspect ratio, keeping the short edge fixed", () => {
    /*
     * The bug this exists for: a phone shoots 2160x3840, and squeezing
     * that onto a 16:9 surface stretched the overlay to 178% of its
     * height and 56% of its width -- visible as narrow, tall panels with
     * narrower type inside them.
     */
    for (const [w, h] of [
      [2160, 3840],
      [1080, 1920],
      [1440, 1080],
      [1000, 1000],
    ]) {
      const viewport = viewportForFrame(w as number, h as number);
      expect(Math.min(viewport.width, viewport.height)).toBe(OVERLAY_SHORT_EDGE);
      expect(viewport.width / viewport.height).toBeCloseTo((w as number) / (h as number), 3);
    }
  });

  it("falls back to the authored surface when the source size is unknown", () => {
    // Live sessions and telemetry written before the pipeline reported
    // frame size both land here.
    expect(viewportForFrame(0, 0)).toEqual(AUTHORED_VIEWPORT);
    expect(viewportForFrame(1920, 0)).toEqual(AUTHORED_VIEWPORT);
    expect(viewportForFrame(Number.NaN, 1080)).toEqual(AUTHORED_VIEWPORT);
  });
});

describe("remapFrameCoordinates", () => {
  it("does not distort a portrait source given its own surface", () => {
    // Both factors equal means the telemetry lands where the picture
    // lands. Against the authored 16:9 surface they were 1.78 and 0.56.
    const frame = makeFrame({
      frame_width: 2160,
      frame_height: 3840,
      ball: ballAt(1080, 1920),
    });
    const viewport = viewportForFrame(2160, 3840);
    const remapped = remapFrameCoordinates(frame, viewport);
    expect(remapped.ball?.center_x).toBeCloseTo(1080, 6);
    expect(remapped.ball?.center_y).toBeCloseTo(1920, 6);
  });

  it("still stretches to fill the authored surface, which is what live needs", () => {
    // A live session draws the camera frame across the whole surface with
    // one drawImage, so its coordinates have to stretch with it.
    const frame = makeFrame({ ball: ballAt(320, 240) });
    const remapped = remapFrameCoordinates(frame);
    expect(remapped.ball?.center_x).toBeCloseTo(CANVAS_WIDTH / 2, 6);
    expect(remapped.ball?.center_y).toBeCloseTo(CANVAS_HEIGHT / 2, 6);
  });

  it("returns the frame unchanged when the source resolution is missing", () => {
    const frame = makeFrame({ frame_width: 0, frame_height: 0 });
    expect(remapFrameCoordinates(frame)).toBe(frame);
  });

  it("scales boxes and the ball center from source resolution to canvas resolution", () => {
    const frame = makeFrame({
      ball: { x1: 64, y1: 48, x2: 128, y2: 96, center_x: 96, center_y: 72 },
      player: { x1: 10, y1: 20, x2: 30, y2: 40 },
    });
    const sx = CANVAS_WIDTH / 640;
    const sy = CANVAS_HEIGHT / 480;

    const remapped = remapFrameCoordinates(frame);

    expect(remapped.ball).toEqual({
      x1: 64 * sx,
      y1: 48 * sy,
      x2: 128 * sx,
      y2: 96 * sy,
      center_x: 96 * sx,
      center_y: 72 * sy,
    });
    expect(remapped.player).toEqual({ x1: 10 * sx, y1: 20 * sy, x2: 30 * sx, y2: 40 * sy });
  });

  it("scales court keypoints and pose keypoints, preserving valid flags", () => {
    const frame = makeFrame({
      court_keypoints: [
        { x: 10, y: 20, valid: true },
        { x: 0, y: 0, valid: false },
      ],
      pose: {
        left_wrist: { x: 5, y: 6, valid: true },
        right_wrist: null,
      },
    });
    const sx = CANVAS_WIDTH / 640;
    const sy = CANVAS_HEIGHT / 480;

    const remapped = remapFrameCoordinates(frame);

    expect(remapped.court_keypoints).toEqual([
      { x: 10 * sx, y: 20 * sy, valid: true },
      { x: 0, y: 0, valid: false },
    ]);
    expect(remapped.pose?.left_wrist).toEqual({ x: 5 * sx, y: 6 * sy, valid: true });
    expect(remapped.pose?.right_wrist).toBeNull();
  });

  it("scales the apex point", () => {
    const frame = makeFrame({ apex_point: { x: 100, y: 200 } });

    const remapped = remapFrameCoordinates(frame);

    expect(remapped.apex_point).toEqual({
      x: 100 * (CANVAS_WIDTH / 640),
      y: 200 * (CANVAS_HEIGHT / 480),
    });
  });

  it("leaves null box fields as null", () => {
    const remapped = remapFrameCoordinates(makeFrame());

    expect(remapped.ball).toBeNull();
    expect(remapped.player).toBeNull();
    expect(remapped.rim).toBeNull();
    expect(remapped.net).toBeNull();
  });

  it("does not mutate the original frame", () => {
    const originalBall = { x1: 64, y1: 48, x2: 128, y2: 96, center_x: 96, center_y: 72 };
    const frame = makeFrame({ ball: { ...originalBall } });

    remapFrameCoordinates(frame);

    expect(frame.ball).toEqual(originalBall);
  });
});

describe("makeFreshPersistentState", () => {
  it("starts with zeroed stats for every shot category and an empty trail", () => {
    const state = makeFreshPersistentState();

    expect(state.trail).toEqual([]);
    expect(state.trailFrozen).toBe(false);
    expect(state.makes).toBe(0);
    expect(state.misses).toBe(0);
    expect(state.courtKeypoints).toBeNull();
    expect(state.lastFrame).toBeNull();
    expect(state.categoryStats).toEqual({
      LAY_UP: { makes: 0, misses: 0 },
      CLS_RNG: { makes: 0, misses: 0 },
      MID_RNG: { makes: 0, misses: 0 },
      HS_3PT: { makes: 0, misses: 0 },
      NCAA_3PT: { makes: 0, misses: 0 },
      NBA_3PT: { makes: 0, misses: 0 },
    });
  });
});

describe("applyShotEvent", () => {
  it("increments makes and the matching category on a make", () => {
    const state = makeFreshPersistentState();

    applyShotEvent(state, makeShotEvent({ result: "make", shot_designation: "MID_RNG" }));

    expect(state.makes).toBe(1);
    expect(state.misses).toBe(0);
    expect(state.categoryStats.MID_RNG).toEqual({ makes: 1, misses: 0 });
  });

  it("increments misses and the matching category on a miss", () => {
    const state = makeFreshPersistentState();

    applyShotEvent(state, makeShotEvent({ result: "miss", shot_designation: "NBA_3PT" }));

    expect(state.misses).toBe(1);
    expect(state.categoryStats.NBA_3PT).toEqual({ makes: 0, misses: 1 });
  });

  it("still counts the overall total when shot_designation is null", () => {
    const state = makeFreshPersistentState();

    applyShotEvent(state, makeShotEvent({ result: "make", shot_designation: null }));

    expect(state.makes).toBe(1);
    for (const stats of Object.values(state.categoryStats)) {
      expect(stats).toEqual({ makes: 0, misses: 0 });
    }
  });
});

describe("applyFrame", () => {
  it("pushes the ball position onto the trail while a shot is potential and not frozen", () => {
    const state = makeFreshPersistentState();

    applyFrame(state, makeFrame({ potential_shot: true, ball: ballAt(10, 20) }));

    expect(state.trail).toEqual([{ x: 10, y: 20 }]);
  });

  it("clears the trail when a release candidate expires without a shot starting", () => {
    const state = makeFreshPersistentState();

    applyFrame(state, makeFrame({ potential_shot: true, ball: ballAt(10, 20) }));
    applyFrame(state, makeFrame({ potential_shot: false, shot_started: false }));

    expect(state.trail).toEqual([]);
    expect(state.trailFrozen).toBe(false);
  });

  it("clears the trail once an active shot ends", () => {
    const state = makeFreshPersistentState();

    applyFrame(state, makeFrame({ potential_shot: true, ball: ballAt(10, 20) }));
    applyFrame(
      state,
      makeFrame({ potential_shot: true, shot_started: true, ball: ballAt(15, 25) }),
    );
    expect(state.trail).toEqual([
      { x: 10, y: 20 },
      { x: 15, y: 25 },
    ]);

    applyFrame(state, makeFrame({ potential_shot: false, shot_started: false }));

    expect(state.trail).toEqual([]);
    expect(state.trailFrozen).toBe(false);
  });

  it("freezes the trail at the rim and stops accumulating further points", () => {
    const state = makeFreshPersistentState();

    applyFrame(state, makeFrame({ potential_shot: true, ball: ballAt(10, 20) }));
    applyFrame(
      state,
      makeFrame({
        potential_shot: true,
        shot_started: true,
        trail_frozen_at_rim: true,
        ball: ballAt(15, 25),
      }),
    );

    expect(state.trailFrozen).toBe(true);
    expect(state.trail).toEqual([{ x: 10, y: 20 }]);

    applyFrame(
      state,
      makeFrame({ potential_shot: true, shot_started: true, ball: ballAt(30, 40) }),
    );

    expect(state.trail).toEqual([{ x: 10, y: 20 }]);
  });

  it("does not push a trail point when the ball is absent", () => {
    const state = makeFreshPersistentState();

    applyFrame(state, makeFrame({ potential_shot: true, ball: null }));

    expect(state.trail).toEqual([]);
  });

  it("tracks the most recently applied frame", () => {
    const state = makeFreshPersistentState();
    const frame = makeFrame({ frame_id: 42 });

    applyFrame(state, frame);

    expect(state.lastFrame).toBe(frame);
  });

  it("retains the last known court keypoints across frames that omit them", () => {
    const state = makeFreshPersistentState();
    const keypoints = [{ x: 1, y: 2, valid: true }];

    applyFrame(state, makeFrame({ court_keypoints: keypoints }));
    applyFrame(state, makeFrame());

    expect(state.courtKeypoints).toBe(keypoints);
  });
});
