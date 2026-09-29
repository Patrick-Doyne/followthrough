import { classifyShotType } from "@/lib/shot-type";
import { classifyZone, distanceFromRimFt, fromPipelineFeet } from "@/services/court-geometry";
import type { Shot, ShotType, VideoTelemetryResponse } from "@/types/telemetry";

/**
 * The processed video's own telemetry, turned into shots.
 *
 * <p>The offline pipeline writes one JSON object per line: a leading
 * `metadata` record carrying fps, then the same `frame`/`shot_event`
 * schema the live DataChannel sends. Reading the charts from that file
 * means the video review page needs nothing from the shots store --
 * the processing run already produced every fact it displays.
 *
 * <p>Nothing here is invented. A field the pipeline did not report is
 * left at zero or absent, and the display renders those as "not
 * recorded" -- a shot cannot take zero seconds, and a detector does
 * not report zero confidence.
 */

/**
 * The fields this reads off a `frame` record.
 *
 * <p>The pipeline has written the shot metrics here for far longer than it
 * has written them onto the `shot_event` itself, so this is where a clip
 * processed by an older build keeps them. Note `shot_distance_ft`, not
 * `shot_distance` -- the frame record and the shot event spell it
 * differently, which is the sort of thing that is only discoverable by
 * reading the emitter.
 *
 * <p>Each value is set once for a shot and then held until the next shot
 * resets it: `time_to_apex` from the moment the apex is confirmed,
 * `shot_duration` from the moment the shot ends, `shot_distance_ft` from
 * release. That persistence is what makes the lookup below sound.
 */
interface FrameMessage {
  type?: unknown;
  frame_id?: unknown;
  shot_duration?: unknown;
  time_to_apex?: unknown;
  shot_distance_ft?: unknown;
}

interface FrameMetrics {
  frameId: number;
  duration: number | null;
  apex: number | null;
  distance: number | null;
}

/** The fields this reads off a `shot_event`. Everything is optional
 * because an older pipeline will not have emitted all of them. */
interface ShotEventMessage {
  type?: unknown;
  frame_id?: unknown;
  result?: unknown;
  makes?: unknown;
  misses?: unknown;
  shot_designation?: unknown;
  court_x?: unknown;
  court_y?: unknown;
  shot_distance?: unknown;
  shot_duration?: unknown;
  time_to_apex?: unknown;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export interface TelemetryShots {
  shots: Shot[];
  /**
   * The pipeline's own running totals, from the last shot event.
   *
   * <p>Authoritative over counting the array: the pipeline counts
   * every attempt it decided, including any this reader could not
   * parse.
   */
  makes: number;
  misses: number;
  /** Shot events carrying no court position, so not plottable. */
  unplaced: number;
}

/**
 * The metrics belonging to the shot decided at `frame`.
 *
 * <p>Searched forward first, from the shot's own frame up to the next
 * shot's, because that is the window in which the values are this shot's:
 * `shot_duration` is only assigned once the shot ends, so the frames before
 * it still hold nothing, and the next shot's start is what clears them
 * again. Only if nothing is found there does it look backward, as far as
 * the previous shot -- which is where `time_to_apex` lives on a shot whose
 * event was written before the apex bookkeeping was flushed to a frame.
 *
 * <p>Bounded at both ends on purpose. An unbounded forward search would
 * happily return the *next* shot's duration for a shot that never got one.
 */
function metricsAt(frames: FrameMetrics[], frame: number, previous: number, next: number) {
  let duration: number | null = null;
  let apex: number | null = null;
  let distance: number | null = null;

  for (const candidate of frames) {
    if (candidate.frameId < frame) continue;
    if (candidate.frameId >= next) break;
    duration ??= candidate.duration;
    apex ??= candidate.apex;
    distance ??= candidate.distance;
    if (duration !== null && apex !== null && distance !== null) break;
  }

  if (duration === null || apex === null || distance === null) {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const candidate = frames[i] as FrameMetrics;
      if (candidate.frameId >= frame) continue;
      if (candidate.frameId <= previous) break;
      duration ??= candidate.duration;
      apex ??= candidate.apex;
      distance ??= candidate.distance;
      if (duration !== null && apex !== null && distance !== null) break;
    }
  }

  return { duration, apex, distance };
}

export function shotsFromTelemetry(
  telemetry: VideoTelemetryResponse,
  context: { videoId: string; sessionId: string; startedAt: string },
): TelemetryShots {
  // A zero or missing fps would put every shot at the same offset.
  const fps = num(telemetry.fps) && telemetry.fps > 0 ? telemetry.fps : 30;
  const startedAtMs = Date.parse(context.startedAt);
  const base = Number.isNaN(startedAtMs) ? 0 : startedAtMs;

  const shots: Shot[] = [];
  let makes = 0;
  let misses = 0;
  let unplaced = 0;

  /*
   * A first pass, because the shot metrics may not be on the shot event at
   * all. Clips processed before the pipeline started attaching them to the
   * event still carry them on the frame records, and those are the clips
   * already sitting in a library -- reading them here is what makes an
   * existing video's charts work without re-processing it.
   */
  const frames: FrameMetrics[] = [];
  const events: { message: ShotEventMessage; frameId: number | null }[] = [];

  for (const raw of telemetry.messages) {
    const message = raw as ShotEventMessage & FrameMessage;
    if (message.type === "frame") {
      const frameId = num(message.frame_id);
      if (frameId === null) continue;
      const duration = num(message.shot_duration);
      const apex = num(message.time_to_apex);
      const distance = num(message.shot_distance_ft);
      // Only frames that actually carry something, so the scan below is
      // over the handful of frames inside a shot rather than all of them.
      if (duration !== null || apex !== null || distance !== null) {
        frames.push({ frameId, duration, apex, distance });
      }
      continue;
    }
    if (message.type !== "shot_event") continue;
    if (message.result !== "make" && message.result !== "miss") continue;
    events.push({ message, frameId: num(message.frame_id) });
  }

  for (const [index, event] of events.entries()) {
    const message = event.message;

    makes = num(message.makes) ?? makes;
    misses = num(message.misses) ?? misses;

    const frameId = event.frameId;
    const fallback = metricsAt(
      frames,
      frameId ?? 0,
      events[index - 1]?.frameId ?? -Infinity,
      events[index + 1]?.frameId ?? Infinity,
    );
    const location = fromPipelineFeet(num(message.court_x), num(message.court_y));
    if (!location) unplaced += 1;

    const courtX = num(message.court_x);
    const courtY = num(message.court_y);
    // The pipeline's own measurement, or the distance implied by the
    // release position, which is exact whenever a position exists.
    const shotDistance =
      num(message.shot_distance) ??
      fallback.distance ??
      (courtX !== null && courtY !== null ? distanceFromRimFt(courtX, courtY) : 0);

    const designation =
      typeof message.shot_designation === "string" ? message.shot_designation : null;
    const number = shots.length + 1;
    // Frames are the pipeline's native unit; seconds are what a
    // playhead is in.
    const videoOffset = frameId === null ? null : frameId / fps;

    shots.push({
      shotId: `${context.videoId}-shot-${String(number).padStart(3, "0")}`,
      sessionId: context.sessionId,
      shotNumber: number,
      timestamp: new Date(base + (videoOffset ?? 0) * 1000).toISOString(),
      result: message.result === "make" ? "MAKE" : "MISS",
      shotType: (designation as ShotType | null) ?? classifyShotType(shotDistance),
      shotDistance,
      /*
       * The frame record's duration wins over the event's, which is the
       * one place the event is not the better source. The frame value is
       * measured to `shot_end_frame`; the event's was measured to the
       * frame it happened to be written on, and a make is only confirmed
       * six settle frames after the ball clears the rim. That added 0.2s
       * to every make and nothing to a miss -- enough to drag a make's
       * time-to-apex ratio down by ~16%, three whole buckets on the arc
       * chart, inventing a relationship between a flat arc and a make.
       * The pipeline now measures to shot_end_frame at both sites, but
       * clips already processed do not, and this reads those correctly.
       */
      shotDuration: fallback.duration ?? num(message.shot_duration) ?? 0,
      timeToApex: num(message.time_to_apex) ?? fallback.apex ?? 0,
      videoId: context.videoId,
      ...(location ? { location, zone: classifyZone(location) } : {}),
      ...(videoOffset === null ? {} : { videoOffset }),
    });
  }

  return { shots, makes, misses, unplaced };
}

/**
 * One session's shots, assembled from each of its videos' telemetry.
 *
 * <p>A session can hold more than one recording, and each telemetry
 * file numbers its own shots from one. Left alone, a two-video
 * session has two shot #1s, and anything keyed on the number -- the
 * timeline, the detail panel's heading -- shows a duplicate.
 *
 * <p>Ordered by when each shot happened rather than by which file it
 * came from, so a session recorded in two halves reads in the order
 * it was played.
 */
export function mergeSessionShots(perVideo: Shot[][]): Shot[] {
  return perVideo
    .flat()
    .slice()
    .sort((a, b) => {
      const byTime = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      if (!Number.isNaN(byTime) && byTime !== 0) return byTime;
      return (a.videoOffset ?? 0) - (b.videoOffset ?? 0);
    })
    .map((shot, index) => ({ ...shot, shotNumber: index + 1 }));
}
