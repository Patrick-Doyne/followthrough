import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useId } from "react";

import {
  ChartCaption,
  ChartReadout,
  MissingField,
  NoShots,
} from "@/components/analytics/chart-parts";
import { ChartLegend, type LegendItem } from "@/components/charts/ChartLegend";
import { useLegendToggle } from "@/lib/use-legend-toggle";
import { HatchPattern } from "@/components/charts/HatchPattern";
import { hatchFill } from "@/lib/chart-patterns";
import { rateText } from "@/lib/chart-labels";
import { TooltipRow, TooltipShell } from "@/components/charts/ChartTooltip";
import { EmptyState } from "@/components/common/states";
import { evenAxis } from "@/lib/chart-axis";
import { fmtShortDate } from "@/lib/format";
import { useAxisProps, useChartTheme } from "@/lib/chart-theme";
import {
  apexRatio,
  apexRatioBuckets,
  bestRun,
  deviationBuckets,
  MIN_FIT_SAMPLE,
  rateOf,
  releaseDeviation,
  releaseFit,
  sessionTrend,
  splitAtWindow,
  trimEmptyEnds,
  type Bucket,
} from "@/lib/shot-insights";
import type { Shot } from "@/types/telemetry";

/**
 * The mechanics charts.
 *
 * <p>These replace the old duration-versus-apex scatter and the duration and
 * apex histograms. Those plotted the raw timings, which are dominated by
 * distance: a chart of flight time is very nearly a chart of how far away
 * the player stood, so the two clouds of makes and misses sat on top of each
 * other and the chart could not be read. Each chart here measures a timing
 * against what this player normally does, which is the part that separates.
 */

/** Shared rendering for the two "attempts split by result, with a rate line" charts. */
function BucketChart({
  buckets,
  height,
  xLabel,
  highlight,
  highlightLabel,
  tooltipTitle,
}: {
  buckets: Bucket[];
  height: number;
  xLabel: string;
  highlight?: { from: string; to: string } | undefined;
  /** What the shaded band means, for the key. */
  highlightLabel?: string | undefined;
  tooltipTitle: (bucket: Bucket) => string;
}) {
  const CHART = useChartTheme();
  const axisProps = useAxisProps();
  const legend = useLegendToggle();
  const hatchId = `${useId()}-miss`.replace(/[^\w-]/g, "");
  const data = buckets.map((bucket) => ({ ...bucket, misses: bucket.attempts - bucket.makes }));
  const countAxis = evenAxis([0, ...data.map((d) => d.attempts)], {
    intervals: 4,
    minStep: 1,
    minSpan: 4,
    floorAtZero: true,
  });

  return (
    <div>
      <HatchPattern id={hatchId} color={CHART.miss} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 16, left: -14 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            interval={0}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -10,
              fill: CHART.axis,
              fontSize: 11,
            }}
            {...axisProps}
          />
          {/* Four intervals on both axes, so the count labels land on the
            same gridlines as the percentage ones. The percentage axis is
            fixed at 0-100 with five ticks; left to itself the count axis
            chose its own number and the two drifted apart. */}
          <YAxis
            yAxisId="count"
            domain={countAxis.domain}
            ticks={countAxis.ticks}
            width={44}
            allowDecimals={false}
            {...axisProps}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            unit="%"
            width={46}
            {...axisProps}
          />
          {highlight ? (
            <ReferenceArea
              yAxisId="pct"
              x1={highlight.from}
              x2={highlight.to}
              fill={CHART.primary}
              fillOpacity={0.08}
              stroke={CHART.primary}
              strokeOpacity={0.35}
              strokeDasharray="3 3"
            />
          ) : null}
          <Tooltip
            cursor={{ fill: CHART.grid, fillOpacity: 0.35 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const bucket = payload[0]!.payload as (typeof data)[number];
              return (
                <TooltipShell title={tooltipTitle(bucket)}>
                  <TooltipRow label="Result" value={rateText(bucket)} color={CHART.primary} />
                  <TooltipRow label="Makes" value={bucket.makes} color={CHART.make} />
                  <TooltipRow label="Misses" value={bucket.misses} color={CHART.miss} />
                </TooltipShell>
              );
            }}
          />
          <Bar
            yAxisId="count"
            dataKey="makes"
            stackId="attempts"
            name="Makes"
            fill={CHART.make}
            fillOpacity={0.85}
            hide={legend.isHidden("makes")}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="count"
            dataKey="misses"
            stackId="attempts"
            name="Misses"
            fill={hatchFill(hatchId)}
            radius={[2, 2, 0, 0]}
            hide={legend.isHidden("misses")}
            isAnimationActive={false}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="percentage"
            name="FG%"
            stroke={CHART.primary}
            strokeWidth={2}
            dot={{ r: 3, fill: CHART.primary, strokeWidth: 0 }}
            activeDot={{ r: 4.5 }}
            connectNulls={false}
            hide={legend.isHidden("percentage")}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { id: "makes", label: "Makes", color: CHART.make, mark: "bar", axis: "left" },
          {
            id: "misses",
            label: "Misses",
            color: CHART.miss,
            mark: "barHatched",
            axis: "left",
          },
          {
            id: "percentage",
            label: "Percentage made",
            color: CHART.primary,
            mark: "line",
            axis: "right",
          },
          ...(highlight
            ? [
                {
                  id: "window",
                  label: highlightLabel ?? "Highlighted",
                  color: CHART.primary,
                  mark: "band" as const,
                },
              ]
            : []),
        ]}
        hidden={legend.hidden}
        onToggle={legend.toggle}
      />
    </div>
  );
}

/**
 * Arc consistency: how much of each shot's flight was spent rising.
 *
 * <p>The one mechanical measure that does not scale with distance, so it is
 * comparable across a whole session. The shaded window is not a coaching
 * ideal -- it is the run of buckets this player has actually shot best from,
 * found in their own data. The app has no opinion about what a good arc is.
 */
export function ArcConsistencyChart({ shots, height = 280 }: { shots: Shot[]; height?: number }) {
  const all = apexRatioBuckets(shots);
  // Trimmed for the plot only. bestRun still looks at every bucket, but an
  // empty column on either end is wasted axis rather than information.
  const buckets = trimEmptyEnds(all);
  const measured = shots.filter((shot) => apexRatio(shot) !== null);

  if (shots.length === 0) return <NoShots />;
  if (measured.length === 0) return <MissingField shots={shots} needs={["duration", "apex"]} />;

  const window = bestRun(all);
  const split = window ? splitAtWindow(shots, apexRatio, window) : null;
  const highlightBuckets = window
    ? buckets.filter((b) => b.from >= window.from - 1e-9 && b.to <= window.to + 1e-9)
    : [];
  const highlight =
    highlightBuckets.length > 0
      ? {
          from: highlightBuckets[0]!.label,
          to: highlightBuckets[highlightBuckets.length - 1]!.label,
        }
      : undefined;

  return (
    <div>
      <ChartReadout
        items={[
          { label: "Shots with a timed arc", value: `${measured.length} of ${shots.length}` },
          ...(window
            ? [
                {
                  label: "Best window",
                  value: `${(window.from * 100).toFixed(0)}–${(window.to * 100).toFixed(0)}%`,
                  tone: "make" as const,
                },
              ]
            : []),
          ...(split?.inside.percentage != null && split.outside.percentage != null
            ? [
                {
                  // With the attempts, because on a short session this gap is
                  // often inside sampling noise -- which is exactly why the
                  // findings panel stays quiet about it.
                  label: "In window vs out",
                  value: `${split.inside.percentage.toFixed(0)}% (${split.inside.attempts}) vs ${split.outside.percentage.toFixed(0)}% (${split.outside.attempts})`,
                },
              ]
            : []),
        ]}
      />
      <BucketChart
        buckets={buckets}
        height={height}
        xLabel="Share of the flight spent rising"
        highlight={highlight}
        highlightLabel="Best window"
        tooltipTitle={(bucket) =>
          `${(bucket.from * 100).toFixed(0)}–${(bucket.to * 100).toFixed(0)}% rising`
        }
      />
      <ChartCaption>
        Every shot spends part of its flight going up and the rest coming down; this plots the first
        part as a share of the whole, which is what makes a layup and a three comparable when their
        raw times are not. Further right is a higher, slower arc. The shaded band is found in your
        own shots, not set as a target, so it moves as they do.
      </ChartCaption>
    </div>
  );
}

/**
 * Flight time against distance, with the player's own fitted line.
 *
 * <p>Raw flight time is mostly a restatement of distance, so plotting it
 * alone teaches nothing. The line is what this player's release normally
 * does; the dashed pair is one standard deviation either side of it. A shot
 * outside that pair is genuinely unusual for them, at that distance, and is
 * worth opening -- which is why the points are clickable.
 */
export function ReleaseFitChart({
  shots,
  height = 300,
  onSelectShot,
}: {
  shots: Shot[];
  height?: number;
  onSelectShot?: ((shot: Shot) => void) | undefined;
}) {
  const CHART = useChartTheme();
  const axisProps = useAxisProps();
  const legend = useLegendToggle();
  const fit = releaseFit(shots);
  const usable = shots.filter((s) => s.shotDuration > 0 && s.shotDistance > 0);

  // The shots plot from the first one. The line does not: two points define
  // a line exactly, so drawing one through them would claim a perfectly
  // repeatable release off two shots. It appears once there is a third.
  if (shots.length === 0) return <NoShots />;
  if (usable.length === 0) return <MissingField shots={shots} needs={["duration"]} />;

  const distances = usable.map((s) => s.shotDistance);
  const durations = usable.map((s) => s.shotDuration);
  // Both axes are snapped to a round step and their ticks written out.
  // Left to derive its own, Recharts turned a 0.51-1.58s domain into ticks
  // of 0.51, 0.81, 1.11, and giving it a tick *count* instead only moved the
  // problem -- the last interval came out a different width from the rest.
  //
  // The step is chosen from the data rather than fixed. A fixed 5ft step was
  // right for a full history spanning the floor and absurd for seven shots
  // spanning three feet, which it squeezed into the middle of a 20-25ft plot.
  const x = evenAxis(distances, { intervals: 6, minStep: 1, minSpan: 4, floorAtZero: true });
  const y = evenAxis(durations, { intervals: 6, minStep: 0.05, minSpan: 0.2 });

  // Drawn across the distances actually shot, not across the axis, whose
  // ends are padded out to a round tick. Running the line to those ends
  // extrapolated the fit past the data, and over a narrow range of
  // distances that is where a noisy slope does the most lying.
  const lineData = (fit ? [Math.min(...distances), Math.max(...distances)] : []).map(
    (shotDistance) => {
      const fitted = fit!.intercept + fit!.slope * shotDistance;
      return {
        shotDistance,
        fitted,
        lo: fitted - fit!.residualSd,
        hi: fitted + fit!.residualSd,
      };
    },
  );

  const makes = usable.filter((s) => s.result === "MAKE");
  const misses = usable.filter((s) => s.result === "MISS");
  const outliers = fit
    ? usable.filter((s) => {
        const d = releaseDeviation(s, fit);
        return d !== null && Math.abs(d) > 2 * fit.residualSd;
      })
    : [];

  return (
    <div>
      <ChartReadout
        items={
          fit
            ? [
                { label: "Shots", value: usable.length },
                { label: "Scatter around the line", value: `±${fit.residualSd.toFixed(2)} s` },
                { label: "Per foot", value: `+${(fit.slope * 1000).toFixed(0)} ms` },
                { label: "Explained by distance", value: `${(fit.r2 * 100).toFixed(0)}%` },
                {
                  label: "Well outside",
                  value: `${outliers.length} shot${outliers.length === 1 ? "" : "s"}`,
                  // Zero outliers is good news, so it does not get the red.
                  ...(outliers.length > 0 ? { tone: "miss" as const } : {}),
                },
              ]
            : [
                { label: "Shots", value: usable.length },
                { label: "Release line", value: `needs ${MIN_FIT_SAMPLE}` },
              ]
        }
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={lineData} margin={{ top: 8, right: 12, bottom: 16, left: -8 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="shotDistance"
            domain={x.domain}
            ticks={x.ticks}
            allowDecimals={false}
            unit=" ft"
            label={{
              value: "Feet from the rim",
              position: "insideBottom",
              offset: -10,
              fill: CHART.axis,
              fontSize: 11,
            }}
            {...axisProps}
          />
          <YAxis
            type="number"
            dataKey="shotDuration"
            domain={y.domain}
            ticks={y.ticks}
            width={56}
            unit=" s"
            {...axisProps}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: CHART.grid }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as Shot | (typeof lineData)[number];
              if (!("shotId" in point)) return null;
              const deviation = fit ? releaseDeviation(point, fit) : null;
              return (
                <TooltipShell
                  title={`Shot #${point.shotNumber} · ${point.result}`}
                  subtitle={
                    deviation === null
                      ? undefined
                      : `${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)}s against your line`
                  }
                >
                  <TooltipRow label="Distance" value={`${point.shotDistance.toFixed(1)} ft`} />
                  <TooltipRow label="Flight time" value={`${point.shotDuration.toFixed(2)} s`} />
                </TooltipShell>
              );
            }}
          />
          <Line
            dataKey="lo"
            stroke={CHART.axis}
            strokeWidth={1}
            strokeDasharray="4 4"
            dot={false}
            legendType="none"
            hide={legend.isHidden("band")}
            isAnimationActive={false}
          />
          <Line
            dataKey="hi"
            stroke={CHART.axis}
            strokeWidth={1}
            strokeDasharray="4 4"
            dot={false}
            legendType="none"
            hide={legend.isHidden("band")}
            isAnimationActive={false}
          />
          <Line
            dataKey="fitted"
            name="Your usual release"
            stroke={CHART.primary}
            strokeWidth={2}
            dot={false}
            hide={legend.isHidden("fit")}
            isAnimationActive={false}
          />
          <Scatter
            name="Make"
            data={makes}
            fill={CHART.make}
            fillOpacity={0.8}
            shape="circle"
            hide={legend.isHidden("make")}
            isAnimationActive={false}
            onClick={(point) => onSelectShot?.(point as unknown as Shot)}
          />
          <Scatter
            name="Miss"
            data={misses}
            fill={CHART.miss}
            fillOpacity={0.8}
            shape="cross"
            hide={legend.isHidden("miss")}
            isAnimationActive={false}
            onClick={(point) => onSelectShot?.(point as unknown as Shot)}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { id: "make", label: "Make", color: CHART.make, mark: "circle" },
          { id: "miss", label: "Miss", color: CHART.miss, mark: "cross" },
          ...(fit
            ? ([
                { id: "fit", label: "Your usual release", color: CHART.primary, mark: "line" },
                {
                  id: "band",
                  label: "\u00b11 standard deviation",
                  color: CHART.axis,
                  mark: "dashed",
                },
              ] as LegendItem[])
            : []),
        ]}
        hidden={legend.hidden}
        onToggle={legend.toggle}
      />
      <ChartCaption>
        {fit
          ? "Flight time on its own is mostly a restatement of distance, so what matters is the spread around the line rather than the line itself: a shot far from it was unusual for you at that range."
          : `The release line appears from ${MIN_FIT_SAMPLE} timed shots — drawn through two it would pass exactly through both and claim no spread at all.`}
      </ChartCaption>
    </div>
  );
}

/** Green when this figure is the higher of the pair, red when it is lower. */
function toneOf(value: number | null, other: number | null): { tone?: "make" | "miss" } {
  if (value === null || other === null || value === other) return {};
  return { tone: value > other ? "make" : "miss" };
}

/**
 * Accuracy against how far the release ran from normal.
 *
 * <p>The payoff of the fitted line. Measuring in standard deviations rather
 * than seconds makes the middle bucket mean "a normal release for you" by
 * construction, so the chart is readable for a repeatable shooter and a
 * wild one alike.
 */
export function ReleaseDeviationChart({ shots, height = 260 }: { shots: Shot[]; height?: number }) {
  const fit = releaseFit(shots);
  if (shots.length === 0) return <NoShots />;
  if (!fit || !(fit.residualSd > 0)) {
    // Told apart: no timings at all is a processing problem, too few is not.
    const timed = shots.filter((shot) => shot.shotDuration > 0).length;
    if (timed === 0) return <MissingField shots={shots} needs={["duration"]} />;
    return (
      <EmptyState
        title="Not enough timed shots"
        message={`This compares each release with your own average for that distance, so it needs a fitted line — ${MIN_FIT_SAMPLE} timed shots, with some spread between them. ${timed} of these ${shots.length} carry a flight time.`}
      />
    );
  }

  const buckets = deviationBuckets(shots, fit);
  const normal = buckets.find((b) => b.label === "Normal");
  const rest = rateOf(
    shots.filter((shot) => {
      const d = releaseDeviation(shot, fit);
      return d !== null && Math.abs(d) >= 0.5 * fit.residualSd;
    }),
  );

  return (
    <div>
      <ChartReadout
        items={[
          {
            label: "Normal release",
            value: normal?.percentage == null ? "—" : `${normal.percentage.toFixed(0)}%`,
            // Toned by which is actually higher. Painting "normal" green on
            // principle would have claimed a result the session contradicts:
            // a player can shoot better on the shots that ran long.
            ...toneOf(normal?.percentage ?? null, rest.percentage),
          },
          {
            label: "Away from it",
            value: rest.percentage === null ? "—" : `${rest.percentage.toFixed(0)}%`,
            ...toneOf(rest.percentage, normal?.percentage ?? null),
          },
          { label: "Your spread", value: `±${fit.residualSd.toFixed(2)} s` },
        ]}
      />
      <BucketChart
        buckets={buckets}
        height={height}
        xLabel="Flight time against your own average for that distance"
        tooltipTitle={(bucket) => `${bucket.label} than usual`}
      />
      <ChartCaption>
        Buckets are widths of your own spread rather than fixed fractions of a second, so
        &ldquo;normal&rdquo; means within half that spread, {(0.5 * fit.residualSd).toFixed(2)}s, of
        your usual flight time at that distance.
      </ChartCaption>
    </div>
  );
}

/**
 * Arc and release repeatability, session by session.
 *
 * <p>The one chart here that answers "am I getting better at this" rather
 * than "how did today go". It replaces a session-level average-flight-time
 * card, which turned out to be a redraw of the average-distance card beside
 * it: across the sample sessions those two correlate at r = 0.98. These two
 * come in at r = -0.19 against distance, so they move for reasons other
 * than where the player chose to stand.
 *
 * <p>Two axes because the units are unrelated -- a share on the left, a
 * spread in seconds on the right -- and the right axis is the one to watch:
 * a falling line there is a release getting more repeatable.
 */
export function ReleaseTrendChart({
  shots,
  height = 260,
  onSelectSession,
}: {
  shots: Shot[];
  height?: number;
  onSelectSession?: ((sessionId: string) => void) | undefined;
}) {
  const CHART = useChartTheme();
  const axisProps = useAxisProps();
  const legend = useLegendToggle();
  const trend = sessionTrend(shots).filter(
    (point) => point.residualSd !== null || point.apexRatio !== null,
  );

  if (shots.length === 0) return <NoShots />;
  if (trend.length === 0) {
    return (
      <EmptyState
        title="No timed sessions yet"
        message="This needs at least one session whose shots carry flight times."
      />
    );
  }

  const data = trend.map((point) => ({
    ...point,
    arc: point.apexRatio === null ? null : point.apexRatio * 100,
    scatterMs: point.residualSd === null ? null : point.residualSd * 1000,
  }));
  /*
   * The same number of intervals on both axes, which is the whole fix for
   * this chart: gridlines are drawn from one axis, so when the left had
   * five ticks and the right four, the right-hand labels sat between the
   * lines rather than on them and the chart read as broken. The ticks are
   * named rather than left to Recharts, which produced 40, 48, 56, 70 --
   * two steps of 8 and one of 14.
   *
   * Milliseconds, not seconds: "0.065 s" wrapped onto two lines in the
   * narrower dashboard column. "65ms" does not.
   */
  const AXIS_INTERVALS = 4;
  const arcAxis = evenAxis(
    data.map((p) => p.arc).filter((v): v is number => v !== null),
    { intervals: AXIS_INTERVALS, minStep: 1, minSpan: 8 },
  );
  const sdAxis = evenAxis(
    trend
      .map((p) => p.residualSd)
      .filter((v): v is number => v !== null)
      .map((v) => v * 1000),
    { intervals: AXIS_INTERVALS, minStep: 5, minSpan: 20, floorAtZero: true },
  );
  const withSd = trend.filter((p) => p.residualSd !== null);
  const first = withSd[0]?.residualSd ?? null;
  const last = withSd.at(-1)?.residualSd ?? null;
  // Only once there is something to have changed from.
  const change = withSd.length > 1 && first !== null && last !== null ? last - first : null;

  return (
    <div>
      <ChartReadout
        items={[
          { label: "Sessions", value: trend.length },
          ...(last !== null
            ? [{ label: "Latest release spread", value: `±${(last * 1000).toFixed(0)} ms` }]
            : []),
          ...(change !== null
            ? [
                {
                  label: "Change since the first",
                  // Down is better here: less scatter is a more repeatable
                  // release, so a fall gets the positive colour.
                  value: `${change >= 0 ? "+" : ""}${(change * 1000).toFixed(0)} ms`,
                  tone: change <= 0 ? ("make" as const) : ("miss" as const),
                },
              ]
            : []),
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 4, bottom: 4, left: -12 }}
          onClick={(state) => {
            const point = state?.activePayload?.[0]?.payload as (typeof data)[number] | undefined;
            if (point && onSelectSession) onSelectSession(point.sessionId);
          }}
        >
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v: string) => fmtShortDate(v)} {...axisProps} />
          <YAxis yAxisId="arc" domain={[50, 70]} unit="%" width={52} {...axisProps} />
          <YAxis
            yAxisId="sd"
            orientation="right"
            domain={sdAxis.domain}
            ticks={sdAxis.ticks}
            width={46}
            tickFormatter={(v: number) => `${v.toFixed(0)}ms`}
            {...axisProps}
          />
          <Tooltip
            cursor={{ stroke: CHART.grid }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as (typeof data)[number];
              return (
                <TooltipShell title={fmtShortDate(point.date)} subtitle={`${point.attempts} shots`}>
                  <TooltipRow
                    label="Arc"
                    value={point.arc === null ? "—" : `${point.arc.toFixed(1)}% rising`}
                    color={CHART.secondary}
                  />
                  <TooltipRow
                    label="Release scatter"
                    value={point.residualSd === null ? "—" : `±${point.residualSd.toFixed(2)} s`}
                    color={CHART.primary}
                  />
                </TooltipShell>
              );
            }}
          />
          <Line
            yAxisId="arc"
            type="monotone"
            dataKey="arc"
            name="Arc"
            stroke={CHART.secondary}
            strokeWidth={1.75}
            strokeDasharray="4 3"
            dot={{ r: 2.5, fill: CHART.secondary, strokeWidth: 0 }}
            connectNulls={false}
            hide={legend.isHidden("arc")}
            isAnimationActive={false}
          />
          <Line
            yAxisId="sd"
            type="monotone"
            dataKey="scatterMs"
            name="Release scatter"
            stroke={CHART.primary}
            strokeWidth={2}
            dot={{ r: 3, fill: CHART.primary, strokeWidth: 0 }}
            activeDot={{ r: 4.5 }}
            connectNulls={false}
            hide={legend.isHidden("spread")}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          {
            id: "spread",
            label: "Release spread",
            color: CHART.primary,
            mark: "line",
            axis: "right",
          },
          {
            id: "arc",
            label: "Average arc",
            color: CHART.secondary,
            mark: "dashed",
            axis: "left",
          },
        ]}
        hidden={legend.hidden}
        onToggle={legend.toggle}
      />
      <ChartCaption>
        Both figures stay put when you move around the floor, which is what makes them worth
        following. Watch the spread: falling means your release is repeating more closely. A drift
        in the arc means the shape of the shot is changing.
      </ChartCaption>
    </div>
  );
}
