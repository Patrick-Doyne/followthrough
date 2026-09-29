import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { ShotDetailPanel } from "@/components/analytics/ShotDetailPanel";
import { ShotLocationChart } from "@/components/analytics/ShotLocationChart";
import { TooltipRow, TooltipShell } from "@/components/charts/ChartTooltip";
import { Panel } from "@/components/common/Panel";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/common/states";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { LiveVideo, type RecordingUploaded } from "@/components/video/LiveVideo";
import { ShotFeed } from "@/components/video/ShotFeed";
import { useShotCorrections } from "@/hooks/use-shot-corrections";
import { toPlottableShot, toRunningSeries } from "@/lib/live-shot";
import { shotCorrectionsService } from "@/services/shot-corrections";
import { useNotify } from "@/state/notifications";
import { Button } from "@/components/ui/button";
import { EMPTY_LIVE_SCORE, type LiveScore } from "@/hooks/use-live-score";
import { ShortcutSheet } from "@/components/common/ShortcutSheet";
import { isTypingTarget } from "@/lib/shortcuts";
import { useAxisProps, useChartTheme } from "@/lib/chart-theme";
import { fmtDateTime } from "@/lib/format";
import { sessionsService } from "@/services/followthrough";

import { UpgradePrompt, useEntitlements } from "@/state/subscription";
import type { Shot } from "@/types/telemetry";

/**
 * Stand-in until live sessions create their own real TrainingSession row
 * (an open item in BACKLOG.md). Using a session ID that actually exists in
 * the backend -- the seeder creates this one -- lets the end-of-session
 * recording upload/ingest (see LiveVideo) succeed today instead of 404ing
 * against a session that was never persisted.
 */
const LIVE_SESSION_ID = "session-001";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Training — FollowThrough" },
      {
        name: "description",
        content:
          "Run a live basketball training session with real-time shot telemetry streamed over WebSocket.",
      },
      { property: "og:title", content: "Live Training — FollowThrough" },
      {
        property: "og:description",
        content: "Real-time shot telemetry overlay for active basketball training sessions.",
      },
    ],
  }),
  component: LiveRoute,
});

function LiveRoute() {
  return (
    <AppShell>
      <LiveTraining />
    </AppShell>
  );
}

function LiveTraining() {
  const CHART = useChartTheme();
  const axisProps = useAxisProps();
  const { has } = useEntitlements();
  const entitled = has("realtimeAnalytics");
  const queryClient = useQueryClient();
  const [elapsed, setElapsed] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);

  // Every number on this screen -- the bug, the counters, the feed, the
  // charts and the Eagle-Eye -- comes from the detection pipeline's
  // DataChannel, which is the only source that corresponds to what the
  // camera actually saw.
  const start = useCallback(() => {
    setActive(true);
    setElapsed(0);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
  }, []);

  const handleRecordingUploaded = useCallback(
    (result: RecordingUploaded) => {
      // The pipeline's own totals, so the saved session agrees with what
      // the score bug showed during it.
      const finished = scoreRef.current;
      sessionsService
        .ingestVideo(LIVE_SESSION_ID, {
          title: `Live Session — ${fmtDateTime(new Date())}`,
          date: new Date().toISOString(),
          durationSeconds: result.durationSeconds,
          storageKey: result.storageKey,
          analyzedShots: finished.attempts,
          shootingPercentage: finished.percentage ?? 0,
          sizeMb: result.sizeMb,
        })
        .then(() => {
          toast.success("Recording saved", {
            description: "This session's video is now available in your library.",
          });
          void queryClient.invalidateQueries({ queryKey: ["session-videos", LIVE_SESSION_ID] });
          void queryClient.invalidateQueries({ queryKey: ["videos"] });
        })
        .catch((error: unknown) => {
          toast.error("Couldn't save this session's recording", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        });
    },
    [queryClient],
  );

  const handleRecordingError = useCallback((error: unknown) => {
    toast.error("Couldn't upload this session's recording", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }, []);

  // Counters and the shot feed read the same DataChannel as the score bug,
  // so they cannot disagree with it.
  const [liveScore, setLiveScore] = useState<LiveScore>(EMPTY_LIVE_SCORE);
  // Read by the upload callback, which is deliberately stable: closing over
  // the score would rebuild it on every shot and restart the camera effect.
  const scoreRef = useRef<LiveScore>(EMPTY_LIVE_SCORE);
  scoreRef.current = liveScore;
  const [countersOpen, setCountersOpen] = useState(true);
  const [shortcutHinted, setShortcutHinted] = useState(false);
  // A practice run still tracks shots; it just is not kept. Offered
  // because the alternative is people avoiding the product while warming
  // up, to keep their numbers clean.
  const [practiceRun, setPracticeRun] = useState(false);
  const [selectedLiveShot, setSelectedLiveShot] = useState<Shot | null>(null);
  const notify = useNotify();
  const corrections = useShotCorrections(
    LIVE_SESSION_ID,
    shotCorrectionsService.correct,
    // Surfaced once per failure rather than per keystroke, and marked
    // urgent because the person is standing at the result of their own
    // action.
    useCallback((message: string) => notify(message, { kind: "error", urgent: true }), [notify]),
  );

  /**
   * The live charts, from the detection pipeline. `history` is
   * newest-first, so it is reversed into shooting order before the running
   * percentage is accumulated.
   */
  const runningSeries = useMemo(() => toRunningSeries(liveScore.history), [liveScore.history]);

  /**
   * Eagle-Eye markers, built from the detection pipeline's shot events
   * and their `court_x`/`court_y` positions.
   *
   * <p>Only shots the pipeline could place are built; the chart reports
   * the rest as "without a location" rather than inventing one. Defaulting
   * an unplaced shot to the rim is what once made the live court view a
   * pile of dots on the basket.
   */
  const eagleEyeShots = useMemo<Shot[]>(
    () =>
      liveScore.history
        .map((shot) => toPlottableShot(shot, LIVE_SESSION_ID))
        .filter((shot): shot is Shot => shot !== null),
    [liveScore.history],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (isTypingTarget(event.target)) return;
      // Space also activates a focused button; let that win rather than
      // doing both.
      if (document.activeElement instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (active) stop();
      else start();
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [active, start, stop]);

  return (
    <PageContainer
      title="Live Training"
      description="Real-time capture and telemetry for an active session."
      actions={
        <>
          <ShortcutSheet />
          {active ? (
            <Button variant="outline" size="sm" onClick={stop}>
              <Square className="size-3.5" aria-hidden />
              End session
            </Button>
          ) : (
            <Button size="sm" onClick={start}>
              <Play className="size-3.5" aria-hidden />
              Start session
            </Button>
          )}
        </>
      }
    >
      {entitled ? null : <UpgradePrompt feature="realtimeAnalytics" className="mb-4" />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-4">
          <LiveVideo
            elapsedSeconds={elapsed}
            active={active}
            sessionId={LIVE_SESSION_ID}
            onRecordingUploaded={handleRecordingUploaded}
            onRecordingError={handleRecordingError}
            onScoreChange={setLiveScore}
            onEndSession={stop}
            practiceRun={practiceRun}
          />

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={practiceRun}
              onCheckedChange={setPracticeRun}
              disabled={active}
              aria-label="Practice run — do not save this session"
            />
            Practice run — nothing is uploaded
          </label>

          <Panel
            title="Eagle-Eye Court View"
            description="Top-down shot placement for this session"
            bodyClassName="p-3"
          >
            <div className="mx-auto w-full max-w-[370px]">
              <ShotLocationChart
                shots={eagleEyeShots}
                onSelectShot={setSelectedLiveShot}
                selectedShotId={selectedLiveShot?.shotId}
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {/* The phone-width telemetry card used to live here. It duplicated
              the score bug's labels, and did so on the primary device. The
              bug on the stage is legible at every width and reads the real
              DataChannel. */}
          <Panel
            title="Session counters"
            bodyClassName={countersOpen ? "p-3" : "hidden"}
            actions={
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={countersOpen}
                onClick={() => setCountersOpen((open) => !open)}
              >
                {countersOpen ? "Hide" : "Show"}
              </Button>
            }
          >
            <dl className="grid grid-cols-2 gap-3">
              {[
                ["Attempts", String(liveScore.attempts)],
                ["Makes", String(liveScore.makes)],
                ["FG%", liveScore.percentage === null ? "—" : `${liveScore.percentage}%`],
                ["Best streak", liveScore.bestStreak ? String(liveScore.bestStreak) : "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="label-caps">{label}</dt>
                  <dd className="metric-value text-xl font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel
            title="Shot feed"
            description="Newest first, from the detection pipeline"
            bodyClassName="p-0"
          >
            {liveScore.history.length > 0 ? (
              <p className="border-b border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                {shortcutHinted
                  ? "Corrections apply to this session only and are not saved yet."
                  : "Press M for made, X for missed, Delete if it was not a shot."}
              </p>
            ) : null}
            <ShotFeed
              shots={liveScore.history}
              corrections={corrections}
              active={active}
              onHintShortcut={() => setShortcutHinted(true)}
            />
          </Panel>

          <Panel title="Running shooting percentage" bodyClassName="p-3">
            {runningSeries.length === 0 ? (
              <EmptyState
                title="No shots yet"
                message="Your shooting percentage plots here once you start scoring."
              />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={runningSeries} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="index" {...axisProps} />
                  <YAxis domain={[0, 100]} unit="%" width={48} {...axisProps} />
                  <Tooltip
                    content={({ active: isActive, payload }) =>
                      isActive && payload?.length ? (
                        <TooltipShell
                          title={`Shot #${(payload[0]!.payload as { index: number }).index}`}
                        >
                          <TooltipRow
                            label="FG%"
                            value={`${(payload[0]!.payload as { percentage: number }).percentage}%`}
                            color={CHART.primary}
                          />
                        </TooltipShell>
                      ) : null
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="percentage"
                    stroke={CHART.primary}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Shot duration vs time to apex (live)" bodyClassName="p-3">
            {runningSeries.length === 0 ? (
              <EmptyState
                title="No shots yet"
                message="Shot timing appears here after your first attempt."
              />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis
                    type="number"
                    dataKey="shotDuration"
                    unit=" s"
                    domain={["dataMin - 0.05", "dataMax + 0.05"]}
                    {...axisProps}
                  />
                  <YAxis
                    type="number"
                    dataKey="timeToApex"
                    unit=" s"
                    width={52}
                    domain={["dataMin - 0.05", "dataMax + 0.05"]}
                    {...axisProps}
                  />
                  <ZAxis range={[40, 40]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3", stroke: CHART.grid }}
                    content={({ active: isActive, payload }) => {
                      if (!isActive || !payload?.length) return null;
                      const p = payload[0]!.payload as (typeof runningSeries)[number];
                      return (
                        <TooltipShell title={`Shot #${p.index} · ${p.result}`}>
                          <TooltipRow
                            label="Shot duration"
                            value={`${p.shotDuration.toFixed(2)} s`}
                          />
                          <TooltipRow label="Time to apex" value={`${p.timeToApex.toFixed(2)} s`} />
                          <TooltipRow label="Distance" value={`${p.shotDistance.toFixed(1)} ft`} />
                        </TooltipShell>
                      );
                    }}
                  />
                  <Scatter
                    data={runningSeries.filter((s) => s.result === "MAKE")}
                    fill={CHART.make}
                    shape="circle"
                    isAnimationActive={false}
                  />
                  <Scatter
                    data={runningSeries.filter((s) => s.result === "MISS")}
                    fill={CHART.miss}
                    shape="cross"
                    isAnimationActive={false}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </div>
      </div>

      <ShotDetailPanel
        shot={selectedLiveShot}
        open={selectedLiveShot !== null}
        onOpenChange={(open) => !open && setSelectedLiveShot(null)}
      />
    </PageContainer>
  );
}
