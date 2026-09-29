import { useEffect, useRef, useState } from "react";

import type { WebRTCLiveSession } from "@/services/webrtc-live";
import { distanceFromRimFt, fromPipelineFeet } from "@/services/court-geometry";
import type { ShotDesignation } from "@/types/overlay-telemetry";
import type { CourtLocation } from "@/types/telemetry";

/**
 * The running score for the live stage, counted from the same DataChannel
 * messages the canvas counts.
 *
 * <p>There used to be two tallies on this screen showing the same labels
 * from unrelated sources: the page counted a synthetic shot stream, while
 * the canvas counted real `shot_event` messages from the detection
 * pipeline. They disagreed because they were never the same data. Deriving
 * the DOM readout from the DataChannel makes disagreement impossible rather
 * than merely unlikely.
 *
 * <p>This re-renders on shot events only — a handful per session — not on
 * frames, so it costs nothing on the hot path.
 */

export interface LiveShot {
  result: "make" | "miss";
  designation: ShotDesignation | null;
  /** Monotonic counter, so a repeat of the same result still reads as new. */
  sequence: number;
  /** When it arrived, epoch ms. Recorded per shot rather than read at
   * render time, which gave every shot the same fabricated timestamp. */
  at: number;
  /**
   * Where it was taken, in court space, or null when the pipeline could
   * not place it. Derived from the `court_x`/`court_y` the detector now
   * emits at release.
   */
  location: CourtLocation | null;
  /** Feet from the rim, seconds, seconds. Null until the pipeline has
   * reported them for this shot. */
  distanceFt: number | null;
  durationSeconds: number | null;
  timeToApexSeconds: number | null;
}

export interface LiveScore {
  makes: number;
  misses: number;
  attempts: number;
  /** 0-100, or null before the first attempt — not zero, which would read
   * as "missed everything" rather than "nothing yet". */
  percentage: number | null;
  /** Consecutive makes. Reset by any miss. */
  streak: number;
  /** Best streak this session, so a run that ends is still worth something. */
  bestStreak: number;
  lastShot: LiveShot | null;
  /** Newest first. Capped, because a long session should not grow the list
   * without bound and only the recent end is ever looked at live. */
  history: LiveShot[];
}

const HISTORY_MAX = 50;

export const EMPTY_LIVE_SCORE: LiveScore = {
  makes: 0,
  misses: 0,
  attempts: 0,
  percentage: null,
  streak: 0,
  bestStreak: 0,
  lastShot: null,
  history: [],
};

export function useLiveScore(session: WebRTCLiveSession | null): LiveScore {
  const [score, setScore] = useState<LiveScore>(EMPTY_LIVE_SCORE);

  // Frame metrics live in a ref, never state: frames arrive ~30 times a
  // second and putting them in state would re-render the whole live screen
  // on every one of them. Only a shot event changes what is displayed.
  const latestFrameMetrics = useRef<{
    distanceFt: number | null;
    durationSeconds: number | null;
    timeToApexSeconds: number | null;
  }>({ distanceFt: null, durationSeconds: null, timeToApexSeconds: null });

  useEffect(() => {
    if (!session) {
      setScore(EMPTY_LIVE_SCORE);
      latestFrameMetrics.current = {
        distanceFt: null,
        durationSeconds: null,
        timeToApexSeconds: null,
      };
      return;
    }

    return session.onTelemetry((message) => {
      if (message.type === "frame") {
        // Carried on frames rather than on the shot event, so the most
        // recent non-null values are what belong to the shot about to be
        // decided.
        if (message.shot_distance_ft !== null) {
          latestFrameMetrics.current.distanceFt = message.shot_distance_ft;
        }
        if (message.shot_duration !== null) {
          latestFrameMetrics.current.durationSeconds = message.shot_duration;
        }
        if (message.time_to_apex !== null) {
          latestFrameMetrics.current.timeToApexSeconds = message.time_to_apex;
        }
        return;
      }
      if (message.type !== "shot_event") return;

      setScore((prev) => {
        const made = message.result === "make";
        // The pipeline sends its own running totals; trust those over a
        // local increment, which would drift if a message were ever missed.
        const makes = message.makes ?? prev.makes + (made ? 1 : 0);
        const misses = message.misses ?? prev.misses + (made ? 0 : 1);
        const attempts = makes + misses;
        const streak = made ? prev.streak + 1 : 0;

        const metrics = latestFrameMetrics.current;
        const shot: LiveShot = {
          result: message.result,
          designation: message.shot_designation ?? null,
          sequence: prev.lastShot ? prev.lastShot.sequence + 1 : 1,
          at: Date.now(),
          location: fromPipelineFeet(message.court_x, message.court_y),
          // Prefer what the pipeline measured; fall back to the distance
          // implied by the release position, which is exact whenever a
          // position exists. Computed here because the raw feet are only
          // available on this message.
          // The event's own measurement first: it is self-contained
          // and cannot belong to the previous attempt. Then the
          // frame-carried value, for a pipeline that predates the
          // event fields. Then the distance implied by the release
          // position, which is exact whenever a position exists.
          distanceFt:
            message.shot_distance ??
            metrics.distanceFt ??
            (typeof message.court_x === "number" && typeof message.court_y === "number"
              ? distanceFromRimFt(message.court_x, message.court_y)
              : null),
          durationSeconds: message.shot_duration ?? metrics.durationSeconds,
          timeToApexSeconds: message.time_to_apex ?? metrics.timeToApexSeconds,
        };
        // Cleared so the next shot cannot inherit this one's numbers if
        // the pipeline goes quiet between attempts.
        latestFrameMetrics.current = {
          distanceFt: null,
          durationSeconds: null,
          timeToApexSeconds: null,
        };

        return {
          makes,
          misses,
          attempts,
          percentage: attempts === 0 ? null : Math.round((makes / attempts) * 100),
          streak,
          bestStreak: Math.max(prev.bestStreak, streak),
          lastShot: shot,
          history: [shot, ...prev.history].slice(0, HISTORY_MAX),
        };
      });
    });
  }, [session]);

  return score;
}
