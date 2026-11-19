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
import { sessionsService, videosService } from "@/services/followthrough";

import { UpgradePrompt, useEntitlements } from "@/state/subscription";
import type { Shot } from "@/types/telemetry";

import type { TrainingSession } from "@/types/telemetry";

/** Key for the shot corrections and Eagle-Eye markers of a session that has
 * no training-session row (a practice run, or one that failed to create). */
const UNSAVED_LIVE_SESSION = "live";

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
  // The training session this live session records into, created when it
  // starts (unless it is a practice run) so the recording has a row to
  // attach to. The ref is what the upload callback reads, so the callback
  // stays stable and never restarts the camera.
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const liveSessionRef = useRef<TrainingSession | null>(null);
  // A practice run still tracks shots; it just is not kept. Offered
  // because the alternative is people avoiding the product while warming
  // up, to keep their numbers clean. Declared here because start() reads it.
  const [practiceRun, setPracticeRun] = useState(false);

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
    liveSessionRef.current = null;
    setLiveSessionId(null);
    if (practiceRun) return;
    const startedAt = new Date();
    sessionsService
      .create({
        name: `Live session — ${fmtDateTime(startedAt)}`,
        date: startedAt.toISOString(),
        durationMinutes: 0,
        location: "Live camera",
        trainingType: "SHOOTING",
      })
      .then((session) => {
        liveSessionRef.current = session;
        setLiveSessionId(session.sessionId);
      })
      .catch((error: unknown) => {
        toast.error("Couldn't create a training session for this recording", {
          description:
            error instanceof Error
              ? `${error.message} The session still runs, but its recording cannot be saved.`
              : "The session still runs, but its recording cannot be saved.",
        });
      });
  }, [practiceRun]);

  const stop = useCallback(() => {
    setActive(false);
  }, []);

  const handleRecordingUploaded = useCallback(
    (result: RecordingUploaded) => {
      const session = liveSessionRef.current;
      if (!session) {
        toast.error("Couldn't save this session's recording", {
          description: "No training session was created when it started.",
        });
        return;
      }
      // The saved session is scored by the offline pipeline over the
      // recording, not by what the live stream produced. The live
      // detector sees the stream a phone's uplink can carry, which at a
      // court is a megabit and a shrunken picture; the recording is the
      // full 720p at 2.5 Mbit/s, the same thing an upload gets. So the
      // live run is the preview and the recording is the record. The
      // gallery shows the video as processing until the pass completes,
      // then its telemetry, totals and thumbnail are the offline ones.
      sessionsService
        .processVideo(session.sessionId, {
          title: `Live Session — ${fmtDateTime(new Date())}`,
          date: new Date().toISOString(),
          storageKey: result.storageKey,
          durationSeconds: result.durationSeconds,
          sizeMb: result.sizeMb,
        })
        .then(() =>
          // The session row was created with no duration; now it has one.
          sessionsService.update(session.sessionId, {
            name: session.name,
            date: session.date,
            durationMinutes: Math.max(1, Math.round(result.durationSeconds / 60)),
            location: session.location,
            trainingType: session.trainingType,
          }),
        )
        .then(() => {
          toast.success("Recording saved", {
            description:
              "It is being analysed by the offline pipeline; the library shows it when that finishes.",
          });
          void queryClient.invalidateQueries({ queryKey: ["session-videos", session.sessionId] });
          void queryClient.invalidateQueries({ queryKey: ["videos"] });
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        })
        .catch((error: unknown) => {
          toast.error("Couldn't save this session's recording", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        });
    },
    [queryClient],
  );

  // The save's progress, as a toast that counts up. LiveVideo keeps the
  // screen awake for it: a locked phone suspends the upload.
  const handleRecordingProgress = useCallback((fraction: number | null) => {
    if (fraction === null) {
      toast.dismiss("recording-upload");
      return;
    }
    toast.loading(`Saving recording… ${Math.round(fraction * 100)}%`, {
      id: "recording-upload",
      description: "Keep this page open until it finishes.",
    });
  }, []);

  const handleRecordingError = useCallback((error: unknown) => {
    toast.error("Couldn't upload this session's recording", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }, []);

  // Counters and the shot feed read the same DataChannel as the score bug,
  // so they cannot disagree with it.
  const [liveScore, setLiveScore] = useState<LiveScore>(EMPTY_LIVE_SCORE);
  const [countersOpen, setCountersOpen] = useState(true);
  const [shortcutHinted, setShortcutHinted] = useState(false);
  const [selectedLiveShot, setSelectedLiveShot] = useState<Shot | null>(null);
  const notify = useNotify();
  const corrections = useShotCorrections(
    liveSessionId ?? UNSAVED_LIVE_SESSION,
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
        .map((shot) => toPlottableShot(shot, liveSessionId ?? UNSAVED_LIVE_SESSION))
        .filter((shot): shot is Shot => shot !== null),
    [liveScore.history, liveSessionId],
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
          <span className="[@media(hover:none)]:hidden">
            <ShortcutSheet />
          </span>
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
            sessionId={liveSessionId}
            onRecordingUploaded={handleRecordingUploaded}
            onRecordingError={handleRecordingError}
            onRecordingProgress={handleRecordingProgress}
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
