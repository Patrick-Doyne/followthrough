import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  BarRow,
  ChartAnswer,
  ChartCaption,
  ChartReadout,
  NoShots,
  RateToneKey,
} from "@/components/analytics/chart-parts";
import { ChartLegend, type LegendItem } from "@/components/charts/ChartLegend";
import { useLegendToggle } from "@/lib/use-legend-toggle";
import { TooltipRow, TooltipShell } from "@/components/charts/ChartTooltip";
import { EmptyState } from "@/components/common/states";
import { useAxisProps, useChartTheme } from "@/lib/chart-theme";
import { longestRun, rateOf, rollingRate, sessionCount, sessionThirds } from "@/lib/shot-insights";
import { cn } from "@/lib/utils";
import type { Shot } from "@/types/telemetry";

/**
 * How the session unfolded.
 *
 * <p>The charts that replace the old per-shot distance and duration lines.
 * Those also plotted shot order, but plotted a value the player does not
 * control at that moment; these plot the one thing shot order is actually
 * good for -- whether they warmed up, held, or faded.
 */

const ROLLING_WINDOW = 10;

/**
 * The trailing rate against the cumulative rate.
 *
 * <p>The cumulative line answers "how did the session go" and flattens as it
 * grows: by shot sixty a cold run of ten barely moves it. The trailing line
 * is what shows the warm-up, the hot stretch and the late fade. The gap
 * between the two is the story, which is why they share one plot rather than
 * being two cards.
 */
export function SessionRhythmChart({
  shots,
  height = 260,
  onSelectShot,
}: {
  shots: Shot[];
  height?: number;
  onSelectShot?: ((shot: Shot) => void) | undefined;
}) {
  const CHART = useChartTheme();
  const axisProps = useAxisProps();
  const legend = useLegendToggle();

  const sessions = sessionCount(shots);
  if (shots.length === 0) return <NoShots />;

  /*
   * One session: a partial window from the very first shot, so a short
   * session still gets a line instead of two points at the far right.
   *
   * Several: the full window, because the window restarts at every session
   * boundary and a one-shot window reads 0% or 100%. Across eight sessions
   * that drew seven vertical plunges to the floor that look like collapses
   * and are single shots. There are plenty of shots here to wait nine for.
   */
  const minWindow = sessions > 1 ? ROLLING_WINDOW : 1;
  const points = rollingRate(shots, ROLLING_WINDOW, minWindow);
  /* Below a full window the trailing rate *is* the cumulative rate -- the
     window has not started sliding yet -- so the two lines sit exactly on
     top of each other. Draw one and say so, rather than captioning two
     lines where only one is visible. */
  const sliding = shots.length > ROLLING_WINDOW;
  const overall = rateOf(shots);
  /* Hottest and coldest are read only off points whose window is actually
     full -- otherwise "best 10" would report shot three's 100%. */
  const full = points.slice(ROLLING_WINDOW - 1).filter((p) => p.percentage !== null);
  const hottest = full.length
    ? full.reduce((a, p) => ((p.percentage as number) > (a.percentage as number) ? p : a))
    : null;
  const coldest = full.length
    ? full.reduce((a, p) => ((p.percentage as number) < (a.percentage as number) ? p : a))
    : null;

  return (
    <div>
      <ChartReadout
        items={[
          {
            label: "Shots",
            value: sessions > 1 ? `${shots.length} over ${sessions} sessions` : shots.length,
          },
          ...(hottest && coldest
            ? [
                {
                  label: `Hottest ${ROLLING_WINDOW}`,
                  value: `${(hottest.percentage as number).toFixed(0)}% at #${sessions > 1 ? hottest.index : hottest.shotNumber}`,
                  tone: "make" as const,
                },
                {
                  label: `Coldest ${ROLLING_WINDOW}`,
                  value: `${(coldest.percentage as number).toFixed(0)}% at #${sessions > 1 ? coldest.index : coldest.shotNumber}`,
                  tone: "miss" as const,
                },
              ]
            : []),
          { label: "Longest run of makes", value: longestRun(shots, "MAKE") },
          { label: "Longest run of misses", value: longestRun(shots, "MISS") },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 16, left: -6 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="index"
            label={{
              value: sessions > 1 ? "Shot, across the selected sessions" : "Shot number",
              position: "insideBottom",
              offset: -10,
              fill: CHART.axis,
              fontSize: 11,
            }}
            {...axisProps}
          />
          <YAxis domain={[0, 100]} unit="%" width={56} {...axisProps} />
          {/* Where one session ends and the next begins. The trailing line
              is computed within a session, so these are the points it
              restarts at rather than decorative gridlines. */}
          {points
            .filter((point) => point.startsSession)
            .map((point) => (
              <ReferenceLine
                key={point.index}
                x={point.index}
                stroke={CHART.axis}
                strokeOpacity={0.45}
                strokeDasharray="2 3"
              />
            ))}
          {overall.percentage !== null ? (
            <ReferenceLine
              y={overall.percentage}
              stroke={CHART.axis}
              strokeDasharray="4 4"
              label={{
                value: "session average",
                fill: CHART.axis,
                fontSize: 10,
                position: "insideTopRight",
              }}
            />
          ) : null}
          <Tooltip
            cursor={{ stroke: CHART.grid }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as (typeof points)[number];
              return (
                <TooltipShell
                  title={sessions > 1 ? `Shot ${point.index}` : `Shot #${point.shotNumber}`}
                  subtitle={point.result}
                >
                  {sliding ? (
                    <TooltipRow
                      label={`Last ${ROLLING_WINDOW}`}
                      value={point.percentage === null ? "—" : `${point.percentage.toFixed(0)}%`}
                      color={CHART.primary}
                    />
                  ) : null}
                  <TooltipRow
                    label="Session so far"
                    value={`${point.cumulative.toFixed(0)}%`}
                    color={sliding ? CHART.secondary : CHART.primary}
                  />
                </TooltipShell>
              );
            }}
          />
          {sliding ? (
            <Line
              type="monotone"
              dataKey="cumulative"
              name="Session so far"
              stroke={CHART.secondary}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              hide={legend.isHidden("cumulative")}
              isAnimationActive={false}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey={sliding ? "percentage" : "cumulative"}
            name={sliding ? `Last ${ROLLING_WINDOW} shots` : "Session so far"}
            stroke={CHART.primary}
            strokeWidth={2}
            dot={shots.length <= 20 ? { r: 3, fill: CHART.primary, strokeWidth: 0 } : false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            hide={legend.isHidden("trailing")}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          {
            id: "trailing",
            label: sliding ? `Last ${ROLLING_WINDOW} shots` : "Everything so far",
            color: CHART.primary,
            mark: "line",
          },
          ...(sliding
            ? ([
                {
                  id: "cumulative",
                  label: "Everything so far",
                  color: CHART.secondary,
                  mark: "dashed",
                },
              ] as LegendItem[])
            : []),
          { id: "average", label: "Your average", color: CHART.axis, mark: "dashed" },
          ...(sessions > 1
            ? ([
                {
                  id: "boundary",
                  label: "Session boundary",
                  color: CHART.axis,
                  mark: "dashed",
                },
              ] as LegendItem[])
            : []),
        ]}
        hidden={legend.hidden}
        onToggle={legend.toggle}
      />
      {/* Omitted past a couple of hundred marks: across a whole library it
          becomes a wall of squares that says less than the line above it. */}
      {shots.length <= 150 ? <ShotSequence shots={shots} onSelectShot={onSelectShot} /> : null}
      <ChartCaption>
        {sessions > 1
          ? `The window restarts at every session boundary, so no point averages the end of one day with the start of the next — which is why the trailing line begins ${ROLLING_WINDOW - 1} shots into each session.`
          : sliding
            ? `Over the opening few shots the trailing line looks back on fewer than ${ROLLING_WINDOW}, because there are not yet ${ROLLING_WINDOW} to look back on.`
            : `Under ${ROLLING_WINDOW} shots a trailing window would cover all of them and draw the same line twice, so the second line appears once there are more.`}
      </ChartCaption>
    </div>
  );
}

/**
 * Every shot in order, as marks.
 *
 * <p>Filled against hollow rather than green against red alone, so the
 * sequence survives being read without colour. It sits under the rhythm
 * chart because a run of misses is easier to count here than to read off a
 * smoothed line, and each mark opens its shot.
 */
export function ShotSequence({
  shots,
  onSelectShot,
}: {
  shots: Shot[];
  onSelectShot?: ((shot: Shot) => void) | undefined;
}) {
  return (
    <>
      {/* A second key inside one card, so it is labelled with what it
          belongs to -- the label sits inside the key's own panel rather
          than floating above it as a rival to the chart's title. */}
      <ChartLegend
        title="Every shot, in order"
        items={[
          { id: "make", label: "Make", color: "var(--make)", mark: "bar" },
          { id: "miss", label: "Miss", color: "var(--miss)", mark: "hollow" },
        ]}
      />
      <ul className="mt-1.5 flex flex-wrap gap-[3px]" aria-label="Every shot in order">
        {shots.map((shot) => {
          const made = shot.result === "MAKE";
          const label = `Shot ${shot.shotNumber}: ${made ? "make" : "miss"}`;
          const mark = cn(
            "block size-2.5 rounded-[2px] border",
            made ? "border-make bg-make" : "border-miss bg-transparent",
          );
          return (
            <li key={shot.shotId}>
              {onSelectShot ? (
                <button
                  type="button"
                  onClick={() => onSelectShot(shot)}
                  title={label}
                  aria-label={label}
                  className="block rounded-[3px] p-px focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className={mark} />
                </button>
              ) : (
                <span className={mark} title={label} aria-label={label} role="img" />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * The session in three stretches: did you warm up, hold, or fade?
 *
 * <p>The question it answers is whether a session got better or worse as it
 * went on. A session percentage is one number for the whole hour and hides
 * that completely: 55% could be a steady 55% throughout, or a blazing start
 * that fell apart, and those call for opposite responses -- shoot more while
 * warm, or stop before the form goes.
 *
 * <p>Split by shot count rather than by clock, so a long rest cannot hand a
 * stretch to the break instead of the shooting. Thirds rather than halves
 * because a warm-up lives in the first and a fade in the last, and halves
 * average the two into nothing.
 */
export function SessionShapeChart({ shots }: { shots: Shot[] }) {
  const sessions = sessionCount(shots);
  const thirds = sessionThirds(shots);
  const overall = rateOf(shots).percentage;
  const opening = thirds[0];
  const closing = thirds[2];
  const delta =
    opening?.percentage != null && closing?.percentage != null
      ? closing.percentage - opening.percentage
      : null;

  if (shots.length === 0) return <NoShots />;
  if (shots.length < 3) {
    // Structural, not statistical: three stretches need three shots.
    return (
      <EmptyState
        title="Not enough shots to split"
        message="Three stretches need at least three shots — one apiece."
      />
    );
  }

  return (
    <div>
      {/* The verdict first, in words, on the card's answer tier. The three
          bars are the evidence for it; on their own they were three
          percentages with no stated question, which is not obvious to
          read. */}
      <ChartAnswer className="text-foreground">
        {delta === null ? (
          <span className="text-muted-foreground">
            Not enough shots in each stretch to compare them yet.
          </span>
        ) : delta >= 8 ? (
          <>
            You <span className="font-semibold text-make">warmed into it</span> — the last third
            went in {delta.toFixed(0)} points more often than the first.
          </>
        ) : delta <= -8 ? (
          <>
            You <span className="font-semibold text-miss">faded</span> — the last third went in{" "}
            {Math.abs(delta).toFixed(0)} points less often than the first.
          </>
        ) : (
          <>
            You <span className="font-semibold">held steady</span> — the first and last thirds are
            within {Math.abs(delta).toFixed(0)} points of each other.
          </>
        )}
      </ChartAnswer>
      <div className="space-y-0.5">
        {thirds.map((third) => (
          <BarRow
            key={third.label}
            label={third.label}
            sublabel={
              third.attempts === 0
                ? "no shots"
                : sessions > 1
                  ? `${third.attempts} shots across ${sessions} sessions`
                  : `shots ${third.fromShot}–${third.toShot}`
            }
            rate={third}
            overall={overall}
          />
        ))}
      </div>
      <RateToneKey />
      <ChartCaption>
        {sessions > 1
          ? "Each session is cut into its own thirds and the matching stretches pooled, so this asks how a typical day goes — not whether your early sessions beat your late ones, which the shooting-over-time chart answers."
          : "Counted by shots rather than by the clock, so a long break between stretches does not move the boundaries."}
      </ChartCaption>
    </div>
  );
}
