import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Cpu, ListOrdered, Target, TrendingUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { ShotDetailPanel } from "@/components/analytics/ShotDetailPanel";
import { SessionProgressChart } from "@/components/analytics/SessionProgressChart";
import { ShotLocationChart } from "@/components/analytics/ShotLocationChart";
import { SectionCard } from "@/components/common/SectionCard";
import { ResultBadge, StatusBadge } from "@/components/common/ResultBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { HeroDivider, HeroStrong, PageHero } from "@/components/common/PageHero";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { ReplayArt } from "@/components/video/ReplayArt";
import { TelemetryOverlayCanvas } from "@/components/video/TelemetryOverlayCanvas";
import { DownloadOverlayButton } from "@/components/video/DownloadOverlayButton";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video/VideoPlayer";
import { Button } from "@/components/ui/button";
import { fmtClock, fmtDate, fmtDistanceOrUnknown, fmtShotType } from "@/lib/format";
import { videoPlaybackUrlQuery, videoQuery, videoTelemetryQuery } from "@/services/queries";
import { cursorBoundaries, isTakenBy, quantiseCursor, shotAt, tallyAt } from "@/lib/shot-cursor";
import { shotsFromTelemetry } from "@/lib/telemetry-shots";
import { cn } from "@/lib/utils";
import type { Shot } from "@/types/telemetry";

export const Route = createFileRoute("/videos/$videoId")({
  validateSearch: (search: Record<string, unknown>) => ({
    t: Number(search["t"]) || 0,
  }),
  head: () => ({
    meta: [
      { title: "Session Video — FollowThrough" },
      {
        name: "description",
        content:
          "Review a recorded basketball training video alongside the shot telemetry extracted from it.",
      },
      { property: "og:title", content: "Session Video — FollowThrough" },
      {
        property: "og:description",
        content: "Video review with synchronized shot telemetry.",
      },
    ],
  }),
  component: VideoDetailRoute,
});

/** How far before a shot's own offset playback starts, so the release
 * and the run-up to it are on screen rather than already over. */
const SHOT_PREROLL_SECONDS = 2;

function VideoDetailRoute() {
  const { videoId } = Route.useParams();
  const { t } = Route.useSearch();
  const video = useQuery(videoQuery(videoId));
  const playbackUrl = useQuery(videoPlaybackUrlQuery(videoId));
  /*
   * The shots come from the video's own telemetry, not the shots
   * store.
   *
   * <p>The processing run already wrote every fact this page shows --
   * when each shot happened, whether it went in, where it was taken
   * from and the three metrics. Reading them back from the file the
   * run produced means reviewing a video needs no trip to the shots
   * store at all.
   */
  const telemetry = useQuery({
    ...videoTelemetryQuery(videoId),
    enabled: Boolean(video.data?.sessionId),
  });

  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(t);
  const playerRef = useRef<VideoPlayerHandle>(null);
  /* Held in state, not a ref: the download button only appears once both
     surfaces exist, and a ref would not re-render to reveal it. */
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [overlayCanvas, setOverlayCanvas] = useState<HTMLCanvasElement | null>(null);

  const parsed = useMemo(
    () =>
      telemetry.data && video.data
        ? shotsFromTelemetry(telemetry.data, {
            videoId,
            sessionId: video.data.sessionId,
            startedAt: video.data.date,
          })
        : null,
    [telemetry.data, video.data, videoId],
  );
  // Memoised: `?? []` is a new array every render, which would defeat
  // the memos that derive the cursor and the tallies from it.
  const shotList = useMemo(() => parsed?.shots ?? [], [parsed]);

  /*
   * The charts follow playback, but they are quantised to the shots
   * themselves rather than to the clock.
   *
   * <p>`onTimeUpdate` fires several times a second and the answer to
   * "which shots have happened" only changes when the playhead
   * crosses one -- about once a minute. Quantising means the court
   * and the figures re-render once per shot for the whole video
   * instead of a few thousand times, and the result is identical.
   */
  const boundaries = useMemo(() => cursorBoundaries(shotList), [shotList]);
  const cursor = quantiseCursor(currentTime, boundaries);
  const running = useMemo(() => tallyAt(shotList, cursor), [shotList, cursor]);

  // The caption under the player wants the real clock, not the
  // quantised one: it appears and clears within a few seconds.
  const nearestShot = shotAt(shotList, currentTime);

  /**
   * Selecting a shot opens its panel. It does **not** move the video.
   *
   * <p>Clicking a mark on a chart is a question about that shot, not
   * an instruction to jump the footage -- doing both meant you lost
   * your place every time you inspected something.
   */
  const openShot = (shot: Shot) => {
    setSelectedShot(shot);
    setDetailOpen(true);
  };

  /** The panel's own button, which is the only thing that seeks. */
  const playShot = (shot: Shot) => {
    setDetailOpen(false);
    if (typeof shot.videoOffset !== "number") return;
    // Run-up, because the offset is the moment the pipeline *decided*
    // the shot -- by then the release is over. `seek` clamps, so this
    // is safe on a shot near the start.
    playerRef.current?.seek(shot.videoOffset - SHOT_PREROLL_SECONDS);
  };

  return (
    <AppShell>
      {/* hideHeader: the band below is this page's header. */}
      <PageContainer title={video.data?.title ?? "Session video"} hideHeader>
        <PageHero
          art={<ReplayArt />}
          eyebrow="Video review"
          title={video.data?.title ?? "Session video"}
          meta={
            video.data ? (
              <>
                <span>{fmtDate(video.data.date)}</span>
                <HeroDivider />
                <span>{fmtClock(video.data.durationSeconds)}</span>
                {video.data.status === "COMPLETE" ? (
                  <>
                    <HeroDivider />
                    <span>
                      <HeroStrong>{video.data.analyzedShots}</HeroStrong> shots analysed
                    </span>
                  </>
                ) : null}
              </>
            ) : null
          }
          toolbar={
            <>
              <Button asChild variant="outline" className="hero-rail h-9 gap-1.5 px-3 text-xs">
                <Link to="/videos">
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Gallery
                </Link>
              </Button>
              {video.data ? (
                <Button asChild className="h-9 gap-1.5 px-3 text-xs shadow-none">
                  <Link to="/sessions/$sessionId" params={{ sessionId: video.data.sessionId }}>
                    <BarChart3 className="size-3.5" aria-hidden />
                    Session analytics
                  </Link>
                </Button>
              ) : null}
              {/* Only once both surfaces exist. The stored recording is
                  clean, so this is the only way to get a copy with the
                  analysis on it -- drawn in whatever theme is current at
                  the moment it is asked for. */}
              {video.data ? (
                <DownloadOverlayButton
                  className="hero-rail h-9 px-3 text-xs"
                  video={videoEl}
                  overlay={overlayCanvas}
                  title={video.data.title}
                  durationSeconds={video.data.durationSeconds}
                />
              ) : null}
            </>
          }
        />

        {video.isPending || playbackUrl.isPending ? (
          <LoadingState rows={4} label="Loading video…" />
        ) : video.isError || !video.data || playbackUrl.isError || !playbackUrl.data ? (
          <ErrorState
            title="This video didn't load"
            message="Check your connection, then try again."
            onRetry={() => {
              void video.refetch();
              void playbackUrl.refetch();
            }}
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <div className="space-y-4">
              {video.data.status === "COMPLETE" ? (
                <VideoPlayer
                  onVideoElement={setVideoEl}
                  renderOverlay={(element, paused) =>
                    /* Unconditional. Nothing in the pipeline writes the
                       analysis into a recording any more, so there is no
                       longer a class of video this would draw twice on --
                       see CppVideoProcessor. */
                    telemetry.data && element ? (
                      <TelemetryOverlayCanvas
                        video={element}
                        messages={telemetry.data.messages}
                        fps={telemetry.data.fps}
                        paused={paused}
                        onCanvas={setOverlayCanvas}
                      />
                    ) : null
                  }
                  src={playbackUrl.data.url}
                  startAt={t}
                  handleRef={playerRef}
                  onTimeUpdate={setCurrentTime}
                  overlay={
                    nearestShot ? (
                      <div className="absolute top-3 left-3 rounded-sm border border-white/15 bg-black/75 px-2.5 py-1.5 text-xs text-white">
                        <span className="metric-value font-semibold">
                          Shot #{nearestShot.shotNumber}
                        </span>{" "}
                        · {fmtDistanceOrUnknown(nearestShot.shotDistance)} ·{" "}
                        {nearestShot.shotDuration.toFixed(2)} s · {nearestShot.result}
                      </div>
                    ) : null
                  }
                />
              ) : (
                // Not watchable yet -- until processing finishes, the stored
                // file is either the raw (not-yet-overlaid) upload or not a
                // real video at all, so there's nothing worth playing back.
                <div className="flex aspect-video w-full items-center justify-center rounded-sm border border-border bg-[oklch(0.14_0.008_250)] text-sm text-muted-foreground">
                  {video.data.status === "FAILED"
                    ? "Processing failed — no video to play."
                    : "Video is still processing — check back soon."}
                </div>
              )}

              <SectionCard icon={Target} title="Shot locations in this session" bodyClassName="p-3">
                {telemetry.isPending ? (
                  <LoadingState variant="chart" />
                ) : (
                  <div className="mx-auto max-w-2xl">
                    <ShotLocationChart
                      shots={shotList}
                      cursorSeconds={cursor}
                      onSelectShot={openShot}
                      selectedShotId={selectedShot?.shotId}
                    />
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="space-y-4">
              <SectionCard
                icon={Cpu}
                title="Processing"
                actions={<StatusBadge status={video.data.status} />}
                bodyClassName="p-3"
              >
                {video.data.status === "COMPLETE" ? (
                  <div className="space-y-3">
                    {/*
                      Two rows, because "so far" and "the session" are
                      different facts. One figure that silently means
                      something different at 2:00 than at 40:00 is how
                      you teach someone not to trust it.
                    */}
                    {/* Two columns, not four: this card moved to the narrow
                        column, where four made "Analyzed shots" and
                        "Shooting %" collide and pushed "1251.2 MB"
                        onto its own line. */}
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      {[
                        ["Analyzed shots", String(video.data.analyzedShots)],
                        ["Shooting %", `${video.data.shootingPercentage.toFixed(1)}%`],
                        ["Duration", fmtClock(video.data.durationSeconds)],
                        ["File size", `${video.data.sizeMb} MB`],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="label-caps">{label}</dt>
                          <dd className="metric-value">{value}</dd>
                        </div>
                      ))}
                    </dl>

                    {shotList.length > 0 ? (
                      <p className="field-note flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs">
                        <span className="label-caps">At {fmtClock(currentTime)}</span>
                        <span className="metric-value text-foreground">
                          {running.makes} of {running.attempts}
                        </span>
                        <span className="text-muted-foreground">
                          · {running.attempts === 0 ? "—" : `${running.percentage.toFixed(1)}%`} so
                          far
                        </span>
                        <span className="text-muted-foreground">
                          · {shotList.length - running.attempts} still to come
                        </span>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {video.data.status === "FAILED"
                      ? "Processing failed for this video."
                      : "Video processing is still in progress. Stats and playback appear once it's complete."}
                  </p>
                )}
              </SectionCard>

              <SectionCard
                icon={ListOrdered}
                title="Shot timeline"
                description="Jump to a shot"
                bodyClassName="p-0"
              >
                {telemetry.isPending ? (
                  <div className="p-3">
                    <LoadingState rows={5} />
                  </div>
                ) : shotList.length === 0 ? (
                  <div className="p-3">
                    <EmptyState
                      title="No shots detected"
                      message="This video finished processing without finding any attempts."
                    />
                  </div>
                ) : (
                  <ul /* Five shots, then it scrolls: a row is 3.3rem, so five is
                     16.5rem. The list runs to sixty-odd on a full session
                     and would otherwise set the column's height, pushing
                     everything beside it far below the fold. In rem, so
                     it stays five rows at every text size. */
                    className="max-h-[var(--timeline-rows)] divide-y divide-border overflow-y-auto"
                    style={{ ["--timeline-rows" as string]: "16.5rem" }}
                  >
                    {shotList.map((shot) => (
                      <li key={shot.shotId}>
                        <button
                          type="button"
                          onClick={() => openShot(shot)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40",
                            // Where the playhead is, and what it has
                            // already passed.
                            shot.shotId === nearestShot?.shotId && "bg-primary/10",
                            !isTakenBy(shot, cursor) && "opacity-45",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="metric-value block font-medium">
                              #{shot.shotNumber} · {fmtClock(shot.videoOffset ?? 0)}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {fmtShotType(shot.shotType)} ·{" "}
                              {fmtDistanceOrUnknown(shot.shotDistance)} ·{" "}
                              {shot.shotDuration.toFixed(2)} s
                            </span>
                          </span>
                          <ResultBadge result={shot.result} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard
                icon={TrendingUp}
                title="How the session went"
                description="Shooting percentage as it accumulated"
                bodyClassName="p-3"
              >
                {telemetry.isPending ? (
                  <LoadingState variant="chart" />
                ) : (
                  <SessionProgressChart
                    shots={shotList}
                    durationSeconds={video.data.durationSeconds}
                    cursorSeconds={cursor}
                    currentTime={currentTime}
                    onSelectShot={openShot}
                    selectedShotId={selectedShot?.shotId}
                  />
                )}
              </SectionCard>
            </div>
          </div>
        )}

        <ShotDetailPanel
          shot={selectedShot}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onOpenVideo={playShot}
        />
      </PageContainer>
    </AppShell>
  );
}
