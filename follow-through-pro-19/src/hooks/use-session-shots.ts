import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { mergeSessionShots, shotsFromTelemetry } from "@/lib/telemetry-shots";
import { sessionVideosQuery, videoTelemetryQuery } from "@/services/queries";
import type { Shot, VideoTelemetryResponse } from "@/types/telemetry";

/**
 * A session's shots, read from its videos' own telemetry.
 *
 * <p>The same source the video review page uses, for the same reason:
 * the processing run already wrote every shot it found, so a session's
 * analysis needs no trip to a shots store. It also means the two pages
 * cannot disagree about what happened in a session -- they are reading
 * the same files.
 *
 * <p>A session can hold several recordings, so this fans out over them
 * and merges. Only COMPLETE videos are asked for: a queued or failed
 * one has no telemetry to return, and requesting it would be a
 * guaranteed 404 per render.
 */
export function useSessionShots(sessionId: string): {
  shots: Shot[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const videos = useQuery({ ...sessionVideosQuery(sessionId), enabled: Boolean(sessionId) });

  const ready = useMemo(
    () => (videos.data ?? []).filter((video) => video.status === "COMPLETE"),
    [videos.data],
  );

  /*
   * Parsed inside `select`, so react-query memoises it per query and
   * the file is not re-read on every render of the page.
   */
  const telemetry = useQueries({
    queries: ready.map((video) => ({
      ...videoTelemetryQuery(video.videoId),
      select: (data: VideoTelemetryResponse) =>
        shotsFromTelemetry(data, {
          videoId: video.videoId,
          sessionId,
          startedAt: video.date,
        }).shots,
    })),
  });

  // Just a sort and a renumber over already-parsed arrays.
  const shots = useMemo(
    () => mergeSessionShots(telemetry.map((query) => query.data ?? [])),
    [telemetry],
  );

  return {
    shots,
    isPending: videos.isPending || telemetry.some((q) => q.isPending),
    isError: videos.isError || telemetry.some((q) => q.isError),
    refetch: () => {
      void videos.refetch();
      for (const q of telemetry) void q.refetch();
    },
  };
}
