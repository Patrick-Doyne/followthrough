import { useEffect, useRef, useState } from "react";

import type { WebRTCLiveSession } from "@/services/webrtc-live";

/**
 * Watches a live session for the failure the product could not previously
 * detect: a picture that has frozen while everything still reports healthy.
 *
 * <p>Rendering is driven entirely by incoming telemetry — there is no
 * animation loop — so when the DataChannel stalls the canvas simply holds
 * its last composited frame forever, and `pc.connectionState` keeps saying
 * "connected". Nothing surfaced that. This hook is the detector.
 *
 * <p>Costs nothing on the render path by construction:
 *
 * <ul>
 *   <li>It subscribes as a *second* listener to the session's existing
 *   telemetry fan-out, so the drawing subscriber is untouched.
 *   <li>Each message writes two refs. No React state, no re-render.
 *   <li>A single 1Hz timer evaluates thresholds and calls `setState` only
 *   when one is crossed, so a stall re-renders twice, not sixty times.
 *   <li>It never reads the canvas. Sampling pixels from a 3840x2160 surface
 *   means a GPU readback stall of tens of milliseconds, which would cost the
 *   very frames it is meant to protect — and would contend with the
 *   `captureStream` feeding the recorder.
 * </ul>
 */

/** Quiet for longer than this and the picture is no longer trustworthy.
 * Generous against a ~30fps stream, short enough to catch a freeze before
 * someone takes another shot. */
const STALE_AFTER_MS = 1500;

/** The camera's own clock must advance by at least this much between
 * samples. Anything less means decoding has stopped. */
const VIDEO_PROGRESS_EPSILON = 0.02;

const SAMPLE_INTERVAL_MS = 1000;

export interface LiveHealth {
  /** Telemetry has gone quiet past the threshold. */
  telemetryStale: boolean;
  /** The camera element's currentTime has stopped advancing. */
  videoStalled: boolean;
  /** The tab is backgrounded. */
  hidden: boolean;
  /** Frames per second, derived from telemetry arrival. Null until known. */
  fps: number | null;
  /** Round-trip time in ms from the selected candidate pair. Null until known. */
  rttMs: number | null;
}

const INITIAL: LiveHealth = {
  telemetryStale: false,
  videoStalled: false,
  hidden: false,
  fps: null,
  rttMs: null,
};

export function useLiveHealth(
  session: WebRTCLiveSession | null,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): LiveHealth {
  const [health, setHealth] = useState<LiveHealth>(INITIAL);

  const lastMessageAt = useRef<number | null>(null);
  const messagesSinceSample = useRef(0);
  const lastVideoTime = useRef<number | null>(null);

  useEffect(() => {
    if (!session) {
      setHealth(INITIAL);
      lastMessageAt.current = null;
      lastVideoTime.current = null;
      messagesSinceSample.current = 0;
      return;
    }

    // Ref writes only. The drawing subscriber in FollowThroughOverlay is a
    // separate entry in the same Set and is not affected.
    const unsubscribe = session.onTelemetry(() => {
      lastMessageAt.current = performance.now();
      messagesSinceSample.current += 1;
    });

    return unsubscribe;
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const sample = () => {
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";

      // Nothing has arrived yet: that is "still connecting", not "stale".
      // Arming before the first message would flag every normal startup.
      const armed = lastMessageAt.current !== null;
      const quietFor = armed ? performance.now() - (lastMessageAt.current ?? 0) : 0;

      const fps = messagesSinceSample.current;
      messagesSinceSample.current = 0;

      const video = videoRef.current;
      let videoStalled = false;
      if (video && !video.paused && video.readyState >= 2) {
        const previous = lastVideoTime.current;
        videoStalled =
          previous !== null && Math.abs(video.currentTime - previous) < VIDEO_PROGRESS_EPSILON;
        lastVideoTime.current = video.currentTime;
      } else {
        lastVideoTime.current = null;
      }

      setHealth((prev) => {
        const next: LiveHealth = {
          // A hidden tab is throttled on purpose; treating that as a fault
          // would show a false warning to anyone who picks their phone back
          // up after it locked.
          telemetryStale: hidden ? false : armed && quietFor > STALE_AFTER_MS,
          videoStalled: hidden ? false : videoStalled,
          hidden,
          fps: armed ? fps : null,
          rttMs: prev.rttMs,
        };
        // Only re-render when something actually changed.
        return prev.telemetryStale === next.telemetryStale &&
          prev.videoStalled === next.videoStalled &&
          prev.hidden === next.hidden &&
          prev.fps === next.fps &&
          prev.rttMs === next.rttMs
          ? prev
          : next;
      });
    };

    const id = setInterval(sample, SAMPLE_INTERVAL_MS);

    // Coming back from a backgrounded tab, the clock has been throttled, so
    // the first sample would read as a long stall. Reset the baseline.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        lastMessageAt.current = performance.now();
        lastVideoTime.current = null;
        messagesSinceSample.current = 0;
      }
      sample();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session, videoRef]);

  // RTT is polled separately and more slowly: it is diagnostic detail, not a
  // health signal, and getStats() allocates a whole report each call.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const poll = async () => {
      const rtt = await session.readRoundTripTimeMs();
      if (cancelled) return;
      setHealth((prev) => (prev.rttMs === rtt ? prev : { ...prev, rttMs: rtt }));
    };

    void poll();
    const id = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session]);

  return health;
}
