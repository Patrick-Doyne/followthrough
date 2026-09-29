import {
  DEFAULT_PANEL_SCALE,
  PANEL_METRICS,
  panelSize,
  staticPanelLayout,
  type OverlayPanelLayout,
  type OverlayViewport,
  type PanelId,
  type PanelPlacement,
} from "@/lib/overlay-renderer";
import type { FrameTelemetry } from "@/types/overlay-telemetry";

/**
 * Where the overlay's panels sit, how big they are, and how a viewer
 * moves them.
 *
 * <p>The panels are drawn on a canvas, so none of this can lean on the
 * layout engine: a rectangle's position, its hit area and the effect of a
 * drag all have to be arithmetic. Keeping that arithmetic here, away from
 * both the drawing code and the React component, is what makes it
 * testable -- every rule below is a pure function of a viewport and a
 * block.
 *
 * <p>**The pair is a unit only at the moment a playback opens.** Picking a
 * video places both panels together, adjacent, in the corner that clears
 * the action. From then on they are two independent objects: either can
 * be dragged or resized on its own.
 *
 * <p>Position is therefore recomputed per recording and never carried
 * across, while size is a preference that persists. That split is the
 * point: where the panels belong is a property of the footage -- the rim
 * is on the right in one clip and the left in the next -- but how big
 * they should be is a property of the viewer.
 */

export type PanelArrangement = "row" | "column";
export type PanelCorner = "nw" | "ne" | "se" | "sw";

/**
 * How big each panel is drawn, relative to its authored size.
 *
 * <p>The one part of a layout that persists. Where the panels go is a
 * property of the recording; how big they are is a property of the
 * viewer, so it follows them from clip to clip.
 */
export interface PanelSizes {
  summary: number;
  tracker: number;
}

export const DEFAULT_PANEL_SIZES: PanelSizes = {
  summary: DEFAULT_PANEL_SCALE,
  tracker: DEFAULT_PANEL_SCALE,
};

export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How small and how large the pair may be dragged.
 *
 * <p>The floor is a legibility one. The artwork holds nothing below 26px
 * because the overlay is watched at roughly a third of the size it is
 * drawn at, which puts that label near 9px for the viewer; at 0.4 it is
 * closer to 3px, and past that the panel is decoration rather than a
 * readout. The ceiling is only a sanity bound -- the real upper limit is
 * the pair still fitting the frame, which {@link clampBlock} enforces
 * whatever this says.
 */
export const MIN_PANEL_SCALE = 0.4;
export const MAX_PANEL_SCALE = 1.75;

/**
 * Side by side, or stacked in a column.
 *
 * <p>Decided by the frame's shape, not by the recording's contents.
 * Side by side is the authored arrangement and what a 16:9 frame gets. It
 * does not survive a portrait frame: the pair would take 58% of its width
 * against 46% of a 16:9 one, which stops being a corner and becomes a
 * band across the top with the rim behind it. Both arrangements are
 * measured and the one that crowds the frame's narrower dimension less
 * wins. Stacked is still adjacent -- just vertically.
 */
export function arrangementFor(
  viewport: OverlayViewport,
  sizes: PanelSizes = DEFAULT_PANEL_SIZES,
): PanelArrangement {
  const authored = staticPanelLayout(viewport, Math.max(sizes.summary, sizes.tracker));
  return authored.tracker.y > authored.summary.y ? "column" : "row";
}

/** The gap and margin for a pair, which belong to both panels and so
 * follow the mean of their two sizes rather than either one. */
function pairSpacing(sizes: PanelSizes) {
  return spacing((sizes.summary + sizes.tracker) / 2);
}

/** The gap between the two panels, and from the frame edge, at `scale`. */
function spacing(scale: number) {
  return { gap: PANEL_METRICS.gap * scale, margin: PANEL_METRICS.margin * scale };
}

/** The footprint of the two panels placed side by side or stacked. */
export function pairSize(
  arrangement: PanelArrangement,
  sizes: PanelSizes,
): { width: number; height: number } {
  const summary = panelSize("summary", sizes.summary);
  const tracker = panelSize("tracker", sizes.tracker);
  const { gap } = pairSpacing(sizes);
  return arrangement === "column"
    ? {
        width: Math.max(summary.width, tracker.width),
        height: summary.height + gap + tracker.height,
      }
    : {
        width: summary.width + gap + tracker.width,
        height: Math.max(summary.height, tracker.height),
      };
}

/** The rectangle one panel occupies. */
export function panelRect(id: PanelId, at: PanelPlacement): PanelRect {
  const { width, height } = panelSize(id, at.scale);
  return { x: at.x, y: at.y, width, height };
}

/**
 * Keeps a panel on screen and within its scale range.
 *
 * <p>Applied on the way in as well as during a drag, because a size saved
 * against one frame shape is replayed against others.
 */
export function clampPlacement(
  at: PanelPlacement,
  id: PanelId,
  viewport: OverlayViewport,
): PanelPlacement {
  const metrics = PANEL_METRICS[id];
  // Never larger than the frame itself, whatever MAX_PANEL_SCALE says.
  const fits = Math.min(viewport.width / metrics.width, viewport.height / metrics.height);
  const scale = Math.min(Math.max(at.scale, MIN_PANEL_SCALE), Math.min(MAX_PANEL_SCALE, fits));
  const { width, height } = panelSize(id, scale);
  return {
    x: Math.min(Math.max(at.x, 0), Math.max(0, viewport.width - width)),
    y: Math.min(Math.max(at.y, 0), Math.max(0, viewport.height - height)),
    scale,
  };
}

/**
 * The placement a corner drag produces, for one panel.
 *
 * <p>The opposite corner is the anchor and does not move, which is what
 * makes dragging a corner feel like resizing rather than like moving.
 * Aspect ratio cannot drift because there is only one number to solve
 * for: the pointer's offset from the anchor is measured on both axes and
 * the larger demand wins, so the panel keeps up with whichever direction
 * the hand actually went.
 */
export function resizeFromCorner(
  at: PanelPlacement,
  id: PanelId,
  corner: PanelCorner,
  pointer: { x: number; y: number },
  viewport: OverlayViewport,
): PanelPlacement {
  const metrics = PANEL_METRICS[id];
  const rect = panelRect(id, at);
  const anchor = {
    x: corner === "nw" || corner === "sw" ? rect.x + rect.width : rect.x,
    y: corner === "nw" || corner === "ne" ? rect.y + rect.height : rect.y,
  };
  const wanted = Math.max(
    Math.abs(pointer.x - anchor.x) / metrics.width,
    Math.abs(pointer.y - anchor.y) / metrics.height,
  );
  const fits = Math.min(viewport.width / metrics.width, viewport.height / metrics.height);
  const scale = Math.min(Math.max(wanted, MIN_PANEL_SCALE), Math.min(MAX_PANEL_SCALE, fits));
  const { width, height } = panelSize(id, scale);
  return clampPlacement(
    {
      x: corner === "nw" || corner === "sw" ? anchor.x - width : anchor.x,
      y: corner === "nw" || corner === "ne" ? anchor.y - height : anchor.y,
      scale,
    },
    id,
    viewport,
  );
}

// ============================================================
// WHERE THE PANELS START, FOR THIS RECORDING
// ============================================================

/** Columns in the occupancy grid. Rows follow the frame's aspect, so a
 * cell is roughly square whatever shape the recording is. */
const GRID_COLUMNS = 24;
/** Frames to sample. An hour of footage is ~100k of them and the answer
 * does not get better for reading all of them, so they are sampled evenly
 * across the whole clip rather than truncated to the start. */
const MAX_SAMPLES = 600;

/**
 * What the panels must not cover, weighted equally.
 *
 * <p>The player, the ball and the rim: the shot and the hoop. All three
 * were named, and none of them is the one worth sacrificing -- a panel
 * over the hoop hides the frame a shot resolves on, which is the one
 * anybody rewinds to.
 */
const SUBJECT_WEIGHTS = { player: 1, ball: 1, rim: 1 } as const;

export interface Occupancy {
  columns: number;
  rows: number;
  /** Row-major, summed weight per cell. Empty when nothing was sampled. */
  cells: number[];
  total: number;
}

/**
 * Where the play happens, as a coarse heat map over the frame.
 *
 * <p>Built from each recording's own telemetry, which is the whole reason
 * the starting position can be any good: a camera behind the baseline,
 * one at half court and a phone propped in a corner all put the action
 * somewhere different, and two clips from the same session can differ
 * just as much. The panels go wherever this says the action is not.
 */
export function subjectOccupancy(frames: FrameTelemetry[], viewport: OverlayViewport): Occupancy {
  const columns = GRID_COLUMNS;
  const rows = Math.max(1, Math.round((GRID_COLUMNS * viewport.height) / viewport.width));
  const cells = new Array<number>(columns * rows).fill(0);
  let total = 0;

  if (frames.length === 0) return { columns, rows, cells, total };
  const step = Math.max(1, Math.ceil(frames.length / MAX_SAMPLES));

  const mark = (x1: number, y1: number, x2: number, y2: number, weight: number) => {
    const c1 = Math.max(0, Math.floor((Math.min(x1, x2) / viewport.width) * columns));
    const c2 = Math.min(columns - 1, Math.floor((Math.max(x1, x2) / viewport.width) * columns));
    const r1 = Math.max(0, Math.floor((Math.min(y1, y2) / viewport.height) * rows));
    const r2 = Math.min(rows - 1, Math.floor((Math.max(y1, y2) / viewport.height) * rows));
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        cells[r * columns + c] = (cells[r * columns + c] ?? 0) + weight;
        total += weight;
      }
    }
  };

  for (let i = 0; i < frames.length; i += step) {
    const frame = frames[i] as FrameTelemetry;
    for (const [key, weight] of [
      ["player", SUBJECT_WEIGHTS.player],
      ["rim", SUBJECT_WEIGHTS.rim],
    ] as const) {
      const box = frame[key];
      if (box?.x1 != null && box.y1 != null && box.x2 != null && box.y2 != null) {
        mark(box.x1, box.y1, box.x2, box.y2, weight);
      }
    }
    const ball = frame.ball;
    if (ball?.center_x != null && ball.center_y != null) {
      // A point, widened to the cell around it: the ball is small and
      // fast, and what matters is the lane it travels through.
      const radius = viewport.height / GRID_COLUMNS;
      mark(
        ball.center_x - radius,
        ball.center_y - radius,
        ball.center_x + radius,
        ball.center_y + radius,
        SUBJECT_WEIGHTS.ball,
      );
    }
  }

  return { columns, rows, cells, total };
}

/** The share of all subject weight that falls under `rect`. */
export function occupancyUnder(rect: PanelRect, occupancy: Occupancy, viewport: OverlayViewport) {
  if (occupancy.total === 0) return 0;
  const { columns, rows, cells } = occupancy;
  const c1 = Math.max(0, Math.floor((rect.x / viewport.width) * columns));
  const c2 = Math.min(
    columns - 1,
    Math.ceil(((rect.x + rect.width) / viewport.width) * columns) - 1,
  );
  const r1 = Math.max(0, Math.floor((rect.y / viewport.height) * rows));
  const r2 = Math.min(rows - 1, Math.ceil(((rect.y + rect.height) / viewport.height) * rows) - 1);
  let covered = 0;
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) covered += cells[r * columns + c] ?? 0;
  }
  return covered / occupancy.total;
}

/**
 * Lays the two panels out inside the footprint they were given.
 *
 * <p>**The summary panel always takes the corner.** It is the larger of
 * the two, so putting it in the corner and letting the tracker trail
 * inward is what keeps the pair tight against the frame's edges; the
 * other way round leaves the bigger panel floating with dead space
 * between it and the corner it was placed for.
 *
 * <p>That means the order flips with the corner. Against a right-hand
 * corner the tracker sits to the summary's *left*, and against a bottom
 * one it sits *above*. Both panels also align to whichever edges the
 * corner anchors them to -- flush along the bottom for a bottom corner,
 * flush along the right for a right-hand one -- so the height difference
 * between them shows up as a notch pointing into the frame rather than
 * as a gap along its edge.
 */
function placePair(
  block: PanelRect,
  arrangement: PanelArrangement,
  anchor: { right: boolean; bottom: boolean },
  sizes: PanelSizes,
): OverlayPanelLayout {
  const summary = panelSize("summary", sizes.summary);
  const tracker = panelSize("tracker", sizes.tracker);
  const { gap } = pairSpacing(sizes);

  if (arrangement === "row") {
    const top = (height: number) => (anchor.bottom ? block.y + block.height - height : block.y);
    const summaryX = anchor.right ? block.x + block.width - summary.width : block.x;
    return {
      summary: { x: summaryX, y: top(summary.height), scale: sizes.summary },
      tracker: {
        x: anchor.right ? summaryX - gap - tracker.width : summaryX + summary.width + gap,
        y: top(tracker.height),
        scale: sizes.tracker,
      },
    };
  }

  const left = (width: number) => (anchor.right ? block.x + block.width - width : block.x);
  const summaryY = anchor.bottom ? block.y + block.height - summary.height : block.y;
  return {
    summary: { x: left(summary.width), y: summaryY, scale: sizes.summary },
    tracker: {
      x: left(tracker.width),
      y: anchor.bottom ? summaryY - gap - tracker.height : summaryY + summary.height + gap,
      scale: sizes.tracker,
    },
  };
}

/**
 * Where both panels start on this recording.
 *
 * <p>Recomputed for every playback rather than remembered, because the
 * right answer is a property of the footage and not of the viewer: the
 * rim is on the right in one clip and the left in the next, and a
 * position carried over from the last video is only accidentally
 * correct.
 *
 * <p>The two panels are placed together and adjacent, with the larger
 * summary panel taking the corner (see placePair). That is what picking a
 * video should give you. They stop being a pair the moment either one is
 * dragged -- that is the viewer's business, not this function's.
 *
 * <p>Two stages, so neither decision needs a weighting invented against
 * the other. The **arrangement** is settled by the frame's shape (see
 * arrangementFor). The **corner** is then settled by the telemetry alone:
 * the pair goes wherever it covers least of the player, the ball and the
 * rim. Ties go to the authored top-left, so a recording with nothing
 * happening up there still looks like the design that was signed off.
 */
export function bestPanelLayout(
  viewport: OverlayViewport,
  occupancy: Occupancy,
  sizes: PanelSizes = DEFAULT_PANEL_SIZES,
): OverlayPanelLayout {
  const arrangement = arrangementFor(viewport, sizes);
  const { width, height } = pairSize(arrangement, sizes);
  const { margin } = pairSpacing(sizes);

  const right = Math.max(margin, viewport.width - margin - width);
  const bottom = Math.max(margin, viewport.height - margin - height);
  const corners = [
    { x: margin, y: margin, right: false, bottom: false },
    { x: right, y: margin, right: true, bottom: false },
    { x: margin, y: bottom, right: false, bottom: true },
    { x: right, y: bottom, right: true, bottom: true },
  ];

  let best = corners[0] as (typeof corners)[number];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const corner of corners) {
    const score = occupancyUnder({ x: corner.x, y: corner.y, width, height }, occupancy, viewport);
    // Strictly less: the authored corner is first and keeps a tie.
    if (score < bestScore) {
      bestScore = score;
      best = corner;
    }
  }

  const placed = placePair({ x: best.x, y: best.y, width, height }, arrangement, best, sizes);
  return {
    summary: clampPlacement(placed.summary, "summary", viewport),
    tracker: clampPlacement(placed.tracker, "tracker", viewport),
  };
}
