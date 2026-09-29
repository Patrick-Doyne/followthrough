import { useId } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  BarRow,
  ChartCaption,
  ChartReadout,
  NoShots,
  RateToneKey,
} from "@/components/analytics/chart-parts";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { useLegendToggle } from "@/lib/use-legend-toggle";
import { HatchPattern } from "@/components/charts/HatchPattern";
import { hatchFill } from "@/lib/chart-patterns";
import { rateText } from "@/lib/chart-labels";
import { TooltipRow, TooltipShell } from "@/components/charts/ChartTooltip";
import { evenAxis } from "@/lib/chart-axis";
import { useAxisProps, useChartTheme } from "@/lib/chart-theme";
import { designationRates, distanceBands, rateOf, type DistanceBand } from "@/lib/shot-insights";
import type { Shot } from "@/types/telemetry";

/**
 * Where the shots came from, and how they went.
 *
 * <p>The pair that replaces the old distance line, duration line and
 * shot-type bars. Those three plotted a value per shot in the order it was
 * taken, which reads as noise: shot 31 being from 22ft tells a player
 * nothing, because the order shots were taken in is not a variable they
 * control. These plot accuracy against the thing they do control -- where
 * they chose to shoot from.
 */

/**
 * Accuracy and volume together, by distance.
 *
 * <p>The single most useful shooting chart there is, and the reason is the
 * pairing: the bars say where the reps went, the line says where they paid
 * off, and the interesting cases are where the two disagree. Either half on
 * its own hides that -- volume alone rewards whoever shoots most, accuracy
 * alone makes six lucky attempts look like a strength.
 */
export function DistanceProfileChart({ shots, height = 280 }: { shots: Shot[]; height?: number }) {
  const CHART = useChartTheme();
  const axisProps = useAxisProps();
  const legend = useLegendToggle();
  const hatchId = `${useId()}-miss`.replace(/[^\w-]/g, "");
  if (shots.length === 0) return <NoShots />;

  const overall = rateOf(shots);
  const bands = distanceBands(shots);
  const data = bands.map((band) => ({ ...band, misses: band.attempts - band.makes }));
  const countAxis = evenAxis([0, ...data.map((d) => d.attempts)], {
    intervals: 4,
    minStep: 1,
    minSpan: 4,
    floorAtZero: true,
  });
  const scored = bands.filter((b) => b.percentage !== null);
  const best = scored.length
    ? scored.reduce((a, b) => ((b.percentage as number) > (a.percentage as number) ? b : a))
    : null;
  const busiest = bands.reduce((a, b) => (b.attempts > a.attempts ? b : a));

  return (
    <div>
      <ChartReadout
        items={[
          { label: "Most attempts", value: `${busiest.label} ft (${busiest.attempts})` },
          ...(best
            ? [
                {
                  label: "Best band",
                  value: `${best.label} ft · ${(best.percentage as number).toFixed(0)}%`,
                  tone: "make" as const,
                },
              ]
            : []),
          {
            label: "Overall",
            value: overall.percentage === null ? "—" : `${overall.percentage.toFixed(0)}%`,
          },
        ]}
      />
      <HatchPattern id={hatchId} color={CHART.miss} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 16, left: -14 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            interval={0}
            label={{
              value: "Feet from the rim",
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
          {overall.percentage !== null ? (
            <ReferenceLine
              yAxisId="pct"
              y={overall.percentage}
              stroke={CHART.axis}
              strokeDasharray="4 4"
              label={{
                value: "your average",
                fill: CHART.axis,
                fontSize: 10,
                position: "insideTopRight",
              }}
            />
          ) : null}
          <Tooltip
            cursor={{ fill: CHART.grid, fillOpacity: 0.35 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const band = payload[0]!.payload as (typeof data)[number];
              return (
                <TooltipShell title={`${band.label} ft`} subtitle={band.kind}>
                  <TooltipRow label="Result" value={rateText(band)} color={CHART.primary} />
                  <TooltipRow label="Makes" value={band.makes} color={CHART.make} />
                  <TooltipRow label="Misses" value={band.misses} color={CHART.miss} />
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
          { id: "avg", label: "Your average", color: CHART.axis, mark: "dashed" },
        ]}
        hidden={legend.hidden}
        onToggle={legend.toggle}
      />
      <ChartCaption>
        A band holding one shot plots at 0% or 100%. The bar beside it is one shot tall and the
        tooltip gives the count, so a thin band reads as thin rather than as a strength.
      </ChartCaption>
    </div>
  );
}

/**
 * Accuracy by the pipeline's own shot classification.
 *
 * <p>Replaces a breakdown by part of the floor. That one grouped shots by
 * where the pipeline thought they were taken from, and the court position
 * is the least dependable thing it reports: it needs the homography to have
 * calibrated and the shooter to have been detected at release, and it is
 * flatly absent on many shots. A chart that drops what it could not place
 * and mis-files what it placed badly is worse than no chart at all.
 *
 * <p>The classification is derived from distance, so this covers the same
 * ground as the distance profile above it. What it adds is the vocabulary:
 * these are the exact labels the shot log, the filters and the shot detail
 * panel use, so a player reading "your midrange is the problem" here can go
 * straight to the midrange filter and find the same shots.
 */
export function ShotDesignationChart({ shots }: { shots: Shot[] }) {
  const rates = designationRates(shots);
  const overall = rateOf(shots).percentage;

  if (shots.length === 0) return <NoShots />;

  const attempted = rates.filter((rate) => rate.attempts > 0);

  return (
    <div>
      <ChartReadout
        items={[
          { label: "Classes attempted", value: `${attempted.length} of ${rates.length}` },
          { label: "Overall", value: overall === null ? "—" : `${overall.toFixed(0)}%` },
        ]}
      />
      <div className="space-y-0.5">
        {rates.map((rate) => (
          <BarRow
            key={rate.shotType}
            label={rate.label}
            sublabel={rate.range}
            rate={rate}
            overall={overall}
          />
        ))}
      </div>
      <RateToneKey />
      <ChartCaption>
        Classes come from the pipeline, so these are the labels the shot log and the filters use
        too.
      </ChartCaption>
    </div>
  );
}
