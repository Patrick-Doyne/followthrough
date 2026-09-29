import {
  applyFrame,
  applyShotEvent,
  AUTHORED_VIEWPORT,
  makeFreshPersistentState,
  remapFrameCoordinates,
  viewportForFrame,
  type OverlayPersistentState,
  type OverlayViewport,
} from "@/lib/overlay-renderer";
import type { FrameTelemetry, ShotEventMessage } from "@/types/overlay-telemetry";

/**
 * Rebuilds the overlay's state at any point in a recording.
 *
 * <p>The overlay is not a function of one frame. The ball trail, the
 * frozen arc, the running tally and the court calibration all accumulate
 * as the pipeline walks forward, which is fine for a live session that
 * only ever moves forwards and useless for a playhead someone can drag.
 *
 * <p>So this keeps a cursor. Moving forward applies the frames in between,
 * which is what live already does. Moving backwards, or jumping, rebuilds
 * from a bounded window rather than replaying the whole file -- an hour of
 * footage is a hundred thousand frames and rebuilding from the start on
 * every scrub would be unusable.
 *
 * <p>The window is bounded safely because the state it carries is itself
 * bounded: a trail is cleared at each shot boundary, so nothing older than
 * the previous shot can still be on screen. Court keypoints are the
 * exception -- they are sent once and then held -- so they are seeded by
 * scanning back for the last frame that carried any.
 */

/** Frames to replay when rebuilding after a jump. Comfortably longer than
 * any single shot, which is the longest-lived thing in the state. */
export const REBUILD_WINDOW = 360;

interface Indexed {
  frames: { at: number; frame: FrameTelemetry }[];
  shots: { at: number; shot: ShotEventMessage }[];
  /** Index of the last frame at or before each frame index, for seeding. */
  keypointAt: number[];
  /** The surface these coordinates were remapped onto. */
  viewport: OverlayViewport;
}

type Message = Record<string, unknown>;

/**
 * Splits a telemetry stream into what the overlay needs, once.
 *
 * <p>Coordinates are remapped here rather than per render: the pipeline
 * reports in source-video pixels and the overlay canvas is a fixed 4K
 * surface, and doing that conversion on every animation frame was pure
 * repeated work.
 */
export function indexTelemetry(messages: unknown[]): Indexed {
  const frames: Indexed["frames"] = [];
  const shots: Indexed["shots"] = [];
  const keypointAt: number[] = [];
  let lastKeypoint = -1;
  const viewport = viewportFromTelemetry(messages);

  for (const raw of messages) {
    const message = raw as Message;
    if (message["type"] === "frame") {
      const at = Number(message["frame_id"]);
      if (!Number.isFinite(at)) continue;
      const frame = remapFrameCoordinates(raw as FrameTelemetry, viewport);
      if (frame.court_keypoints) lastKeypoint = frames.length;
      keypointAt.push(lastKeypoint);
      frames.push({ at, frame });
    } else if (message["type"] === "shot_event") {
      const at = Number(message["frame_id"]);
      if (!Number.isFinite(at)) continue;
      shots.push({ at, shot: raw as ShotEventMessage });
    }
  }

  return { frames, shots, keypointAt, viewport };
}

/**
 * The surface this recording's overlay belongs on.
 *
 * <p>The pipeline reports the source's size on its `metadata` line and
 * again on every `frame`, so either will do and the metadata line is
 * usually first. Telemetry written before the pipeline reported size at
 * all falls back to the authored 16:9 surface, which is what those clips
 * were composited against anyway.
 */
export function viewportFromTelemetry(messages: unknown[]): OverlayViewport {
  for (const raw of messages) {
    const message = raw as Message;
    const width = Number(message["frame_width"]);
    const height = Number(message["frame_height"]);
    if (width > 0 && height > 0) return viewportForFrame(width, height);
  }
  return AUTHORED_VIEWPORT;
}

/** The last frame at or before `frameId`, or -1. */
export function frameIndexAt(indexed: Indexed, frameId: number): number {
  const { frames } = indexed;
  let lo = 0;
  let hi = frames.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((frames[mid] as Indexed["frames"][number]).at <= frameId) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface OverlayReplay {
  /** The overlay state as of `frameId`, ready to render. */
  stateAt: (frameId: number) => OverlayPersistentState;
  /** How many frames were applied for the last call -- for tests. */
  lastApplied: () => number;
  /**
   * Every frame in the recording, already remapped onto the viewport.
   *
   * <p>Exposed for deciding where the panels start: that needs to know
   * where the player and the ball spend the clip, and the frames have
   * already been indexed and remapped here, so reading them again from
   * the raw messages would be the same work twice.
   */
  frames: FrameTelemetry[];
  /**
   * The surface to draw on, carrying the source's aspect ratio.
   *
   * <p>The canvas has to take its width and height from this, or a
   * portrait clip gets a 16:9 overlay stretched across it and nothing
   * lines up with the picture underneath.
   */
  viewport: OverlayViewport;
}

export function createOverlayReplay(messages: unknown[]): OverlayReplay {
  const indexed = indexTelemetry(messages);
  let state = makeFreshPersistentState();
  // The frame index the state currently reflects, or -1 for fresh.
  let cursor = -1;
  let applied = 0;

  const applyRange = (from: number, to: number) => {
    for (let i = from; i <= to; i += 1) {
      const entry = indexed.frames[i] as Indexed["frames"][number];
      // Shot events land between frames and must be applied in order, or
      // a tally ticks over on the wrong side of a made basket.
      for (const { at, shot } of indexed.shots) {
        if (at > (indexed.frames[i - 1]?.at ?? -1) && at <= entry.at) {
          applyShotEvent(state, shot);
        }
      }
      applyFrame(state, entry.frame);
      applied += 1;
    }
    cursor = to;
  };

  return {
    stateAt(frameId: number) {
      applied = 0;
      const target = frameIndexAt(indexed, frameId);
      if (target < 0) {
        state = makeFreshPersistentState();
        cursor = -1;
        return state;
      }

      if (target >= cursor && target - cursor <= REBUILD_WINDOW) {
        if (target > cursor) applyRange(cursor + 1, target);
        return state;
      }

      // A jump. Rebuild from a window back, seeding the calibration from
      // whichever earlier frame last carried it so the court does not
      // vanish when someone drags the playhead.
      state = makeFreshPersistentState();
      const from = Math.max(0, target - REBUILD_WINDOW);
      const seed = indexed.keypointAt[target] ?? -1;
      if (seed >= 0 && seed < from) {
        const keypoints = (indexed.frames[seed] as Indexed["frames"][number]).frame.court_keypoints;
        if (keypoints) state.courtKeypoints = keypoints;
      }
      cursor = from - 1;
      applyRange(from, target);
      return state;
    },
    lastApplied: () => applied,
    frames: indexed.frames.map((entry) => entry.frame),
    viewport: indexed.viewport,
  };
}
