import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { mergeSessionShots, shotsFromTelemetry } from "@/lib/telemetry-shots";
import { videosQuery, videoTelemetryQuery } from "@/services/queries";
import type { Shot, VideoAsset, VideoTelemetryResponse } from "@/types/telemetry";

/**
 * Every shot the pipeline has written, across all processed videos.
 *
 * <p>The analytics page's source, and the wide version of
 * `useSessionShots`. It exists because the page was calling
 * `GET /analytics/shots`, which the backend does not implement -- it
 * answers 404 "No such endpoint" -- so every shot-driven chart on that
 * page was empty and the retries fired on every load.
 *
 * <p>Reading the telemetry instead is the pattern this project settled on
 * for shot data: the processing run already wrote every shot it found, so
 * there is no shots store to round-trip to, and the analytics, session and
 * video pages cannot disagree about a session because they read the same
 * files.
 *
 * <p>`noTelemetry` is reported separately from `isError`. A video with no
 * telemetry record answers 404, which is an ordinary state -- it has not
 * been processed by a build that wrote any -- and not a failure worth
 * showing a retry button for. Telling the two apart is what lets the charts
 * say "nothing has been processed yet" instead of blaming the data.
 */
export function useAllShots(): {
  shots: Shot[];
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  /** Processed videos whose telemetry came back missing. */
  noTelemetry: number;
  /** Videos that were asked for telemetry at all. */
  processed: number;
  refetch: () => void;
} {
  const videos = useQuery(videosQuery(0, 100));

  const ready = useMemo(
    () => (videos.data?.content ?? []).filter((video: VideoAsset) => video.status === "COMPLETE"),
    [videos.data],
  );

  const telemetry = useQueries({
    queries: ready.map((video: VideoAsset) => ({
      ...videoTelemetryQuery(video.videoId),
      // A missing telemetry record is a permanent answer, not a blip, so
      // retrying it three times only delays the empty state.
      retry: false,
      select: (data: VideoTelemetryResponse) =>
        shotsFromTelemetry(data, {
          videoId: video.videoId,
          sessionId: video.sessionId,
          startedAt: video.date,
        }).shots,
    })),
  });

  const shots = useMemo(
    () => mergeSessionShots(telemetry.map((query) => (query.data as Shot[] | undefined) ?? [])),
    [telemetry],
  );

  return {
    shots,
    isPending: videos.isPending || telemetry.some((q) => q.isPending),
    isFetching: videos.isFetching || telemetry.some((q) => q.isFetching),
    isError: videos.isError,
    noTelemetry: telemetry.filter((q) => q.isError).length,
    processed: ready.length,
    refetch: () => {
      void videos.refetch();
      for (const q of telemetry) void q.refetch();
    },
  };
}
