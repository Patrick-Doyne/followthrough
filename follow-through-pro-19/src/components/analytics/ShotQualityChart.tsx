import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCaption, ChartReadout, NoShots } from "@/components/analytics/chart-parts";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { useLegendToggle } from "@/lib/use-legend-toggle";
import { TooltipRow, TooltipShell } from "@/components/charts/ChartTooltip";
import { EmptyState } from "@/components/common/states";
import { useAxisProps, useChartTheme } from "@/lib/chart-theme";
import { fmtShortDate } from "@/lib/format";
import { qualityTrend } from "@/lib/shot-insights";
import type { Shot } from "@/types/telemetry";

/**
 * Shot quality against shot making.
 *
 * <p>The split a bare percentage cannot make. A 52% session is a good one if
 * the shots taken were hard and a poor one if they were layups, and the two
 * call for opposite responses — keep taking those, or stop settling. The
 * dashed line is what the session's shot selection alone would normally
 * return; the bars are how far the shooting landed above or below it.
 *
 * <p>Deliberately the only chart here that plots a signed difference as bars
 * around a zero line: the sign is the whole point, and two lines with the
 * gap left to the eye buried it.
 */
export function ShotQualityChart({
  shots,
  height = 280,
  onSelectSession,
}: {
  shots: Shot[];
  height?: number;
  onSelectSession?: ((sessionId: string) => void) | undefined;
}) {
  const CHART = useChartTheme();
  const axisProps = useAxisProps();
  const legend = useLegendToggle();
  const trend = qualityTrend(shots).filter((point) => point.gap !== null);

  if (shots.length === 0) return <NoShots />;
  if (trend.length === 0) {
    return (
      <EmptyState
        title="Nothing to compare yet"
        message="This needs at least one session whose shots fall in distance bands you have shot from before."
      />
    );
  }

  const gaps = trend.map((point) => point.gap as number);
  const best = trend.reduce((a, b) => ((b.gap as number) > (a.gap as number) ? b : a));
  const worst = trend.reduce((a, b) => ((b.gap as number) < (a.gap as number) ? b : a));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const above = gaps.filter((gap) => gap > 0).length;

  return (
    <div>
      <ChartReadout
        items={[
          {
            label: "Above your own baseline",
            value: `${above} of ${trend.length} sessions`,
          },
          {
            label: "Average gap",
            value: `${mean >= 0 ? "+" : ""}${mean.toFixed(1)} pts`,
            tone: mean >= 0 ? "make" : "miss",
          },
          // Best and worst only once there are two to rank.
          ...(trend.length > 1
            ? [
                {
                  label: "Best",
                  value: `${fmtShortDate(best.date)} · +${(best.gap as number).toFixed(0)}`,
                  tone: "make" as const,
                },
                {
                  label: "Worst",
                  value: `${fmtShortDate(worst.date)} · ${(worst.gap as number).toFixed(0)}`,
                  tone: "miss" as const,
                },
              ]
            : []),
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={trend}
          margin={{ top: 8, right: 8, bottom: 4, left: -14 }}
          onClick={(state) => {
            const point = state?.activePayload?.[0]?.payload as (typeof trend)[number] | undefined;
            if (point && onSelectSession) onSelectSession(point.sessionId);
          }}
        >
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v: string) => fmtShortDate(v)} {...axisProps} />
          <YAxis
            yAxisId="pct"
            domain={[0, 100]}
            width={46}
            tickFormatter={(v: number) => `${v}%`}
            {...axisProps}
          />
          <YAxis
            yAxisId="gap"
            orientation="right"
            width={48}
            tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`}
            {...axisProps}
          />
          <ReferenceLine yAxisId="gap" y={0} stroke={CHART.axis} strokeOpacity={0.6} />
          <Tooltip
            cursor={{ fill: CHART.grid, fillOpacity: 0.3 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as (typeof trend)[number];
              const gap = point.gap as number;
              return (
                <TooltipShell title={fmtShortDate(point.date)} subtitle={`${point.attempts} shots`}>
                  <TooltipRow
                    label="Shot selection implies"
                    value={`${(point.expected as number).toFixed(0)}%`}
                    color={CHART.secondary}
                  />
                  <TooltipRow
                    label="You shot"
                    value={`${(point.actual as number).toFixed(0)}%`}
                    color={CHART.primary}
                  />
                  <TooltipRow
                    label="Difference"
                    value={`${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pts`}
                    color={gap >= 0 ? CHART.make : CHART.miss}
                  />
                </TooltipShell>
              );
            }}
          />
          <Bar
            yAxisId="gap"
            dataKey="gap"
            name="Above or below"
            hide={legend.isHidden("gap")}
            isAnimationActive={false}
          >
            {trend.map((point) => (
              <Cell
                key={point.sessionId}
                fill={(point.gap as number) >= 0 ? CHART.make : CHART.miss}
                fillOpacity={0.55}
              />
            ))}
          </Bar>
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="expected"
            name="Shot selection implies"
            stroke={CHART.secondary}
            strokeWidth={1.75}
            strokeDasharray="4 3"
            dot={{ r: 2.5, fill: CHART.secondary, strokeWidth: 0 }}
            connectNulls={false}
            hide={legend.isHidden("expected")}
            isAnimationActive={false}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="actual"
            name="You shot"
            stroke={CHART.primary}
            strokeWidth={2}
            dot={{ r: 3, fill: CHART.primary, strokeWidth: 0 }}
            activeDot={{ r: 4.5 }}
            connectNulls={false}
            hide={legend.isHidden("actual")}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          {
            id: "actual",
            label: "You shot",
            color: CHART.primary,
            mark: "line",
            axis: "left",
          },
          {
            id: "expected",
            label: "Selection implies",
            color: CHART.secondary,
            mark: "dashed",
            axis: "left",
          },
          { id: "gap", label: "Beat it", color: CHART.make, mark: "bar", axis: "right" },
          {
            id: "gap-down",
            label: "Fell short",
            color: CHART.miss,
            mark: "bar",
            axis: "right",
          },
        ]}
        hidden={legend.hidden}
        onToggle={(id) => legend.toggle(id === "gap-down" ? "gap" : id)}
      />
      <ChartCaption>
        The baseline is your own long-run percentage from each distance, so this measures you
        against yourself rather than against a league average.
      </ChartCaption>
    </div>
  );
}
