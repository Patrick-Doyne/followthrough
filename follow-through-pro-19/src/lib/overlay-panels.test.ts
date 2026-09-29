import { describe, expect, it } from "vitest";

import {
  arrangementFor,
  bestPanelLayout,
  clampPlacement,
  DEFAULT_PANEL_SIZES,
  MAX_PANEL_SCALE,
  MIN_PANEL_SCALE,
  occupancyUnder,
  pairSize,
  panelRect,
  resizeFromCorner,
  subjectOccupancy,
} from "@/lib/overlay-panels";
import {
  AUTHORED_VIEWPORT,
  DEFAULT_PANEL_SCALE,
  PANEL_METRICS,
  staticPanelLayout,
  viewportForFrame,
} from "@/lib/overlay-renderer";
import type { FrameTelemetry } from "@/types/overlay-telemetry";

const VP = AUTHORED_VIEWPORT;

/** A frame carrying just the boxes the placement cares about. */
function frameWith(overrides: Partial<FrameTelemetry>): FrameTelemetry {
  return {
    type: "frame",
    frame_id: 0,
    frame_width: VP.width,
    frame_height: VP.height,
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

/** A player standing in one quadrant for the whole clip. */
function clipWithPlayerIn(quadrant: "nw" | "ne" | "sw" | "se"): FrameTelemetry[] {
  const left = quadrant === "nw" || quadrant === "sw";
  const top = quadrant === "nw" || quadrant === "ne";
  const x1 = left ? VP.width * 0.05 : VP.width * 0.55;
  const y1 = top ? VP.height * 0.05 : VP.height * 0.55;
  return Array.from({ length: 40 }, () =>
    frameWith({
      player: { x1, y1, x2: x1 + VP.width * 0.4, y2: y1 + VP.height * 0.4 },
    }),
  );
}

/** Play filling a horizontal band of the frame, for forcing the search
 * away from the top corners. */
function bandOfPlay(y1: number, y2: number, x1 = 0, x2 = 1): FrameTelemetry[] {
  return Array.from({ length: 20 }, () =>
    frameWith({
      player: {
        x1: VP.width * x1,
        y1: VP.height * y1,
        x2: VP.width * x2,
        y2: VP.height * y2,
      },
    }),
  );
}

describe("bestPanelLayout", () => {
  it("keeps the authored corner when the frame tells it nothing", () => {
    // No telemetry means no reason to move, and the approved design is
    // top-left. A tie has to go to it rather than to whichever corner the
    // search happened to visit last.
    const empty = subjectOccupancy([], VP);
    expect(bestPanelLayout(VP, empty)).toEqual(staticPanelLayout(VP));
  });

  it("moves the panels out of the corner the player spends the clip in", () => {
    const layout = bestPanelLayout(VP, subjectOccupancy(clipWithPlayerIn("nw"), VP));
    expect(layout.summary.x).toBeGreaterThan(VP.width / 2);
  });

  it("finds a clear corner wherever the play is", () => {
    // Which corner is not the point and is over-specifying: the
    // requirement is that the panels end up off the action. With the
    // player bottom-left, the authored top-left is already clear and
    // keeps the tie -- that is correct, not a miss.
    for (const quadrant of ["nw", "ne", "sw", "se"] as const) {
      const occupancy = subjectOccupancy(clipWithPlayerIn(quadrant), VP);
      const layout = bestPanelLayout(VP, occupancy);
      for (const id of ["summary", "tracker"] as const) {
        expect(
          occupancyUnder(panelRect(id, layout[id]), occupancy, VP),
          `${id}, player in ${quadrant}`,
        ).toBeLessThan(0.05);
      }
    }
  });

  it("keeps the two panels adjacent wherever it puts them", () => {
    // "Next to each other" is the requirement; which corner, and which of
    // the two leads, are the variables.
    for (const quadrant of ["nw", "ne", "sw", "se"] as const) {
      const layout = bestPanelLayout(VP, subjectOccupancy(clipWithPlayerIn(quadrant), VP));
      const gap = PANEL_METRICS.gap * DEFAULT_PANEL_SCALE;
      const summary = panelRect("summary", layout.summary);
      const tracker = panelRect("tracker", layout.tracker);
      const between = Math.max(
        Math.max(summary.x, tracker.x) -
          Math.min(summary.x + summary.width, tracker.x + tracker.width),
        Math.max(summary.y, tracker.y) -
          Math.min(summary.y + summary.height, tracker.y + tracker.height),
      );
      expect(between, `player in ${quadrant}`).toBeCloseTo(gap, 6);
    }
  });

  it("gives the corner to the summary panel, whichever corner it is", () => {
    /*
     * The summary is the larger of the two, so it takes the corner and
     * the tracker trails inward. The other way round leaves the bigger
     * panel floating with dead space between it and the corner it was
     * placed for -- which means the order has to flip against a
     * right-hand or bottom corner rather than always running
     * left-to-right.
     */
    const cases: [string, FrameTelemetry[]][] = [
      ["action top-left", clipWithPlayerIn("nw")],
      ["action top-right", clipWithPlayerIn("ne")],
      ["action across the top", bandOfPlay(0, 0.5)],
      ["action top and bottom-left", [...bandOfPlay(0, 0.5), ...bandOfPlay(0.5, 1, 0, 0.5)]],
    ];
    for (const [name, frames] of cases) {
      const layout = bestPanelLayout(VP, subjectOccupancy(frames, VP));
      const summary = panelRect("summary", layout.summary);
      const tracker = panelRect("tracker", layout.tracker);
      const inset = (r: typeof summary) => ({
        x: Math.min(r.x, VP.width - (r.x + r.width)),
        y: Math.min(r.y, VP.height - (r.y + r.height)),
      });
      const s = inset(summary);
      const t = inset(tracker);
      expect(s.x, `${name}: horizontal`).toBeLessThanOrEqual(t.x + 0.001);
      expect(s.y, `${name}: vertical`).toBeLessThanOrEqual(t.y + 0.001);
    }
  });

  it("keeps both panels inside the frame in every corner", () => {
    for (const quadrant of ["nw", "ne", "sw", "se"] as const) {
      const layout = bestPanelLayout(VP, subjectOccupancy(clipWithPlayerIn(quadrant), VP));
      for (const id of ["summary", "tracker"] as const) {
        const rect = panelRect(id, layout[id]);
        expect(rect.x, `${id} ${quadrant}`).toBeGreaterThanOrEqual(0);
        expect(rect.y, `${id} ${quadrant}`).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width, `${id} ${quadrant}`).toBeLessThanOrEqual(VP.width + 0.001);
        expect(rect.y + rect.height, `${id} ${quadrant}`).toBeLessThanOrEqual(VP.height + 0.001);
      }
    }
  });

  it("still stacks on a portrait frame, wherever the play is", () => {
    // The arrangement is decided by the frame's shape and the corner by
    // the telemetry. Those are separate questions and stay separate.
    const portrait = viewportForFrame(2160, 3840);
    const frames = Array.from({ length: 20 }, () =>
      frameWith({
        frame_width: 2160,
        frame_height: 3840,
        player: { x1: 100, y1: 100, x2: 900, y2: 1400 },
      }),
    );
    const layout = bestPanelLayout(portrait, subjectOccupancy(frames, portrait));
    // Stacked, and flush against the same vertical edge -- which is the
    // right-hand one here, since the play is on the left.
    expect(layout.tracker.y).toBeGreaterThan(layout.summary.y);
    const summary = panelRect("summary", layout.summary);
    const tracker = panelRect("tracker", layout.tracker);
    expect(summary.x + summary.width).toBeCloseTo(tracker.x + tracker.width, 6);
  });
});

describe("subjectOccupancy", () => {
  it("weighs the ball even though it is only a point", () => {
    const frames = Array.from({ length: 10 }, () =>
      frameWith({ ball: { x1: null, y1: null, x2: null, y2: null, center_x: 200, center_y: 200 } }),
    );
    const occupancy = subjectOccupancy(frames, VP);
    expect(occupancy.total).toBeGreaterThan(0);
    expect(occupancyUnder({ x: 0, y: 0, width: 600, height: 600 }, occupancy, VP)).toBeGreaterThan(
      0.5,
    );
  });

  it("reports nothing for a clip with no detections", () => {
    const occupancy = subjectOccupancy([frameWith({})], VP);
    expect(occupancy.total).toBe(0);
    expect(occupancyUnder({ x: 0, y: 0, width: 100, height: 100 }, occupancy, VP)).toBe(0);
  });

  it("samples a long clip instead of reading every frame of it", () => {
    // An hour is ~100k frames and the answer does not improve for reading
    // all of them; this just has to stay quick enough to run on mount.
    const frames = Array.from({ length: 100_000 }, () =>
      frameWith({ player: { x1: 10, y1: 10, x2: 200, y2: 200 } }),
    );
    const started = performance.now();
    const occupancy = subjectOccupancy(frames, VP);
    expect(performance.now() - started).toBeLessThan(250);
    expect(occupancy.total).toBeGreaterThan(0);
  });
});

describe("clampPlacement", () => {
  it("keeps a panel from being dragged off the frame", () => {
    const off = clampPlacement({ x: -500, y: -500, scale: 0.75 }, "summary", VP);
    expect(off.x).toBe(0);
    expect(off.y).toBe(0);

    const far = clampPlacement({ x: 99_999, y: 99_999, scale: 0.75 }, "summary", VP);
    const rect = panelRect("summary", far);
    expect(rect.x + rect.width).toBeCloseTo(VP.width, 6);
    expect(rect.y + rect.height).toBeCloseTo(VP.height, 6);
  });

  it("holds the scale inside its legible range", () => {
    expect(clampPlacement({ x: 0, y: 0, scale: 0.01 }, "summary", VP).scale).toBe(MIN_PANEL_SCALE);
    expect(clampPlacement({ x: 0, y: 0, scale: 99 }, "summary", VP).scale).toBe(MAX_PANEL_SCALE);
  });

  it("will not let a panel grow past the frame, whatever the range allows", () => {
    // A small recording can hold less than MAX_PANEL_SCALE, and the frame
    // is the real limit.
    const tiny = viewportForFrame(640, 360);
    const scaled = clampPlacement({ x: 0, y: 0, scale: MAX_PANEL_SCALE }, "summary", tiny);
    const rect = panelRect("summary", scaled);
    expect(rect.width).toBeLessThanOrEqual(tiny.width + 0.001);
    expect(rect.height).toBeLessThanOrEqual(tiny.height + 0.001);
  });
});

describe("resizeFromCorner", () => {
  const at = { x: 1000, y: 800, scale: 0.75 };

  it("leaves the opposite corner exactly where it was", () => {
    // This is what makes a corner drag feel like a resize rather than a
    // move: the anchor does not budge.
    const before = panelRect("summary", at);
    const after = panelRect(
      "summary",
      resizeFromCorner(at, "summary", "se", { x: 1600, y: 1300 }, VP),
    );
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);

    const nw = panelRect("summary", resizeFromCorner(at, "summary", "nw", { x: 800, y: 600 }, VP));
    expect(nw.x + nw.width).toBeCloseTo(before.x + before.width, 6);
    expect(nw.y + nw.height).toBeCloseTo(before.y + before.height, 6);
  });

  it("cannot distort the panel, whichever way the pointer goes", () => {
    const authored = PANEL_METRICS.summary.width / PANEL_METRICS.summary.height;
    for (const pointer of [
      { x: 2000, y: 810 },
      { x: 1010, y: 2000 },
      { x: 3000, y: 2000 },
      { x: 1005, y: 805 },
    ]) {
      const rect = panelRect("summary", resizeFromCorner(at, "summary", "se", pointer, VP));
      expect(rect.width / rect.height, JSON.stringify(pointer)).toBeCloseTo(authored, 6);
    }
  });

  it("follows whichever axis the hand actually moved", () => {
    const wide = resizeFromCorner(at, "summary", "se", { x: 2400, y: 810 }, VP);
    const tall = resizeFromCorner(at, "summary", "se", { x: 1010, y: 1900 }, VP);
    expect(wide.scale).toBeGreaterThan(at.scale);
    expect(tall.scale).toBeGreaterThan(at.scale);
  });

  it("stays inside the frame and the scale range", () => {
    const huge = resizeFromCorner(at, "summary", "se", { x: 99_999, y: 99_999 }, VP);
    expect(huge.scale).toBeLessThanOrEqual(MAX_PANEL_SCALE);
    const rect = panelRect("summary", huge);
    expect(rect.x + rect.width).toBeLessThanOrEqual(VP.width + 0.001);

    const nothing = resizeFromCorner(at, "summary", "se", { x: 1000, y: 800 }, VP);
    expect(nothing.scale).toBe(MIN_PANEL_SCALE);
  });
});

describe("placement is per recording", () => {
  it("gives two clips with the action on opposite sides opposite answers", () => {
    /*
     * The thing this whole mechanism exists for. The rim is on the right
     * in one recording and the left in the next, and a position carried
     * over from the last video would only be accidentally right.
     */
    const rightSide = bestPanelLayout(VP, subjectOccupancy(clipWithPlayerIn("ne"), VP));
    const leftSide = bestPanelLayout(VP, subjectOccupancy(clipWithPlayerIn("nw"), VP));
    expect(rightSide.summary.x).toBeLessThan(VP.width / 2);
    expect(leftSide.summary.x).toBeGreaterThan(VP.width / 2);
  });

  it("will not park the pair over the hoop", () => {
    // The rim carries the same weight as the player and the ball: a panel
    // over the hoop hides the frame a shot resolves on.
    const rimTopLeft = Array.from({ length: 30 }, () =>
      frameWith({
        rim: { x1: 60, y1: 60, x2: VP.width * 0.45, y2: VP.height * 0.45 },
      }),
    );
    const occupancy = subjectOccupancy(rimTopLeft, VP);
    const layout = bestPanelLayout(VP, occupancy);
    for (const id of ["summary", "tracker"] as const) {
      expect(occupancyUnder(panelRect(id, layout[id]), occupancy, VP), id).toBeLessThan(0.05);
    }
  });

  it("reads the whole clip, not just the frame it opens on", () => {
    // The player starts top-left and finishes bottom-right; neither half
    // of the clip alone would give the right answer.
    const frames = [...clipWithPlayerIn("nw"), ...clipWithPlayerIn("se")];
    const occupancy = subjectOccupancy(frames, VP);
    const layout = bestPanelLayout(VP, occupancy);
    expect(occupancyUnder(panelRect("summary", layout.summary), occupancy, VP)).toBeLessThan(0.05);
  });
});

describe("sizes a viewer has chosen", () => {
  it("places the pair at those sizes, still adjacent", () => {
    // Size persists across clips while position does not, so the starting
    // placement has to be built from whatever sizes the viewer settled on
    // rather than from the default.
    const sizes = { summary: 1.2, tracker: 0.5 };
    const layout = bestPanelLayout(VP, subjectOccupancy([], VP), sizes);
    expect(layout.summary.scale).toBe(1.2);
    expect(layout.tracker.scale).toBe(0.5);

    const summary = panelRect("summary", layout.summary);
    expect(layout.tracker.x).toBeGreaterThan(summary.x + summary.width);
    expect(layout.tracker.x - (summary.x + summary.width)).toBeLessThan(PANEL_METRICS.gap * 1.2);
  });

  it("still fits the pair inside the frame at an awkward pair of sizes", () => {
    for (const sizes of [
      { summary: MAX_PANEL_SCALE, tracker: MAX_PANEL_SCALE },
      { summary: MAX_PANEL_SCALE, tracker: MIN_PANEL_SCALE },
      { summary: MIN_PANEL_SCALE, tracker: MAX_PANEL_SCALE },
    ]) {
      const layout = bestPanelLayout(VP, subjectOccupancy([], VP), sizes);
      for (const id of ["summary", "tracker"] as const) {
        const rect = panelRect(id, layout[id]);
        expect(rect.x + rect.width, `${id} ${JSON.stringify(sizes)}`).toBeLessThanOrEqual(
          VP.width + 0.001,
        );
        expect(rect.y + rect.height, `${id} ${JSON.stringify(sizes)}`).toBeLessThanOrEqual(
          VP.height + 0.001,
        );
      }
    }
  });

  it("measures the pair's footprint from both sizes, not one", () => {
    const uneven = pairSize("row", { summary: 1, tracker: 0.5 });
    const even = pairSize("row", DEFAULT_PANEL_SIZES);
    expect(uneven.width).not.toBeCloseTo(even.width, 3);
    expect(arrangementFor(VP, DEFAULT_PANEL_SIZES)).toBe("row");
  });
});
