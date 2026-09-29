import { queryOptions } from "@tanstack/react-query";

import {
  analyticsService,
  calendarService,
  sessionsService,
  userService,
  videosService,
} from "./followthrough";

export const sessionsQuery = () =>
  queryOptions({ queryKey: ["sessions"], queryFn: () => sessionsService.list() });

export const sessionQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["session", sessionId],
    queryFn: () => sessionsService.get(sessionId),
  });

/*
 * There is deliberately no shots query here.
 *
 * The backend has no shot-level endpoint: it stores each processed video's
 * telemetry stream and session-level aggregates, nothing in between. Shot
 * data comes from the processing run's own telemetry instead --
 * `useSessionShots` for one session, `useAllShots` for the library, both
 * reading `videoTelemetryQuery` and deriving shots with
 * lib/telemetry-shots.ts. Add a shots query only when the backend grows
 * the endpoint, and check it against a real server before relying on it.
 */

/** GET /sessions/{id}/videos — a session's own (small, unpaginated) videos,
 * not the global /videos list. Use this to find "the video for this
 * session," not videosQuery(), which only ever holds one page of the full
 * library. */
export const sessionVideosQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["session-videos", sessionId],
    queryFn: () => sessionsService.videos(sessionId),
  });

export const summaryQuery = () =>
  queryOptions({ queryKey: ["analytics-summary"], queryFn: () => analyticsService.summary() });

export const shootingSeriesQuery = () =>
  queryOptions({ queryKey: ["analytics-shooting"], queryFn: () => analyticsService.shooting() });

export const videosQuery = (page = 0, size = 20) =>
  queryOptions({
    queryKey: ["videos", page, size],
    queryFn: () => videosService.list(page, size),
  });

export const videoQuery = (videoId: string) =>
  queryOptions({ queryKey: ["video", videoId], queryFn: () => videosService.get(videoId) });

/** staleTime: 0 is explicit, not just React Query's default — a real
 * presigned URL expires, so a cached one must never be reused across
 * mounts; always fetch a fresh one right before playback. */
/** Stored detection telemetry for a processed video, used by replay.
 * Long-lived: a finished video's telemetry never changes. */
export const videoTelemetryQuery = (videoId: string) =>
  queryOptions({
    queryKey: ["video-telemetry", videoId],
    queryFn: () => videosService.getTelemetry(videoId),
    staleTime: Infinity,
  });

export const videoPlaybackUrlQuery = (videoId: string) =>
  queryOptions({
    queryKey: ["video-playback-url", videoId],
    queryFn: () => videosService.getPlaybackUrl(videoId),
    staleTime: 0,
  });

/**
 * Omitting from/to (the dashboard's Reminders widget) and passing them (the
 * calendar page's month window) are cached as distinct entries, so the two
 * independent consumers never clobber each other's cached data.
 */
export const calendarQuery = (from?: string, to?: string) =>
  queryOptions({
    queryKey: ["calendar", from, to],
    queryFn: () => calendarService.list(from, to),
  });

export const userQuery = () =>
  queryOptions({ queryKey: ["user"], queryFn: () => userService.me() });
