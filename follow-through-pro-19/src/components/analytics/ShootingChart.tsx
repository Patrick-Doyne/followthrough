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

import { ChartReadout } from "@/components/analytics/chart-parts";
import { ChartLegend, type LegendItem } from "@/components/charts/ChartLegend";
import { TooltipRow, TooltipShell } from "@/components/charts/ChartTooltip";
import { EmptyState } from "@/components/common/states";
import { useAxisProps, useChartTheme } from "@/lib/chart-theme";
import { useLegendToggle } from "@/lib/use-legend-toggle";
import { fmtShortDate } from "@/lib/format";
import type { SeriesPoint } from "@/types/telemetry";

export interface ShootingChartProps {
  data: SeriesPoint[];
  comparison?: SeriesPoint[] | undefined;
  comparisonLabel?: string | undefined;
  average?: number | undefined;
  height?: number;
  onPointSelect?: ((sessionId: string) => void) | undefined;
}

/** A. Shooting percentage over time. */
export function ShootingChart({
  data,
  comparison,
  comparisonLabel,
  average,
  height = 260,
  onPointSelect,
}: ShootingChartProps) {
  const CHART = useChartTheme();
  const axisProps = useAxisProps();
  const legend = useLegendToggle();
  if (data.length === 0) {
    return <EmptyState title="No shooting data" message="No sessions match these filters." />;
  }

  const merged = data.map((point, index) => ({
    ...point,
    comparison: comparison?.[index]?.shootingPercentage ?? null,
    comparisonLabel: comparison?.[index]?.label ?? null,
  }));

  const best = data.reduce((a, b) => (b.shootingPercentage > a.shootingPercentage ? b : a));
  const latest = data[data.length - 1] as SeriesPoint;

  return (
    <div>
      <ChartReadout
        items={[
          { label: "Sessions", value: data.length },
          {
            label: "Latest",
            value: `${latest.shootingPercentage.toFixed(0)}%`,
            ...(average !== undefined
              ? {
                  tone:
                    latest.shootingPercentage >= average ? ("make" as const) : ("miss" as const),
                }
              : {}),
          },
          {
            label: "Best",
            value: `${best.shootingPercentage.toFixed(0)}% · ${fmtShortDate(best.date)}`,
            tone: "make",
          },
          ...(average !== undefined ? [{ label: "Average", value: `${average.toFixed(0)}%` }] : []),
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={merged}
          margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
          onClick={(state) => {
            const payload = state?.activePayload?.[0]?.payload as SeriesPoint | undefined;
            if (payload && onPointSelect) onPointSelect(payload.sessionId);
          }}
        >
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v: string) => fmtShortDate(v)} {...axisProps} />
          <YAxis domain={[0, 100]} unit="%" width={52} {...axisProps} />
          {average !== undefined ? (
            <ReferenceLine
              y={average}
              stroke={CHART.axis}
              strokeDasharray="4 4"
              label={{
                value: "average",
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
              const point = payload[0]!.payload as (typeof merged)[number];
              return (
                <TooltipShell title={point.label} subtitle={fmtShortDate(point.date)}>
                  <TooltipRow
                    label="FG%"
                    value={`${point.shootingPercentage.toFixed(1)}%`}
                    color={CHART.primary}
                  />
                  <TooltipRow label="Makes / attempts" value={`${point.makes} / ${point.shots}`} />
                  {point.comparison !== null ? (
                    <TooltipRow
                      label={comparisonLabel ?? "Comparison"}
                      value={`${Number(point.comparison).toFixed(1)}%`}
                      color={CHART.secondary}
                    />
                  ) : null}
                </TooltipShell>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="shootingPercentage"
            name="Shooting %"
            stroke={CHART.primary}
            strokeWidth={2}
            dot={{ r: 2.5, fill: CHART.primary, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            hide={legend.isHidden("actual")}
            isAnimationActive={false}
          />
          {comparison?.length ? (
            <Line
              type="monotone"
              dataKey="comparison"
              name={comparisonLabel ?? "Comparison"}
              stroke={CHART.secondary}
              strokeWidth={1.75}
              strokeDasharray="4 3"
              dot={false}
              hide={legend.isHidden("comparison")}
              isAnimationActive={false}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { id: "actual", label: "Percentage made", color: CHART.primary, mark: "line" },
          ...(comparison?.length
            ? ([
                {
                  id: "comparison",
                  label: comparisonLabel ?? "Comparison",
                  color: CHART.secondary,
                  mark: "dashed",
                },
              ] as LegendItem[])
            : []),
          ...(average !== undefined
            ? ([
                { id: "average", label: "Your average", color: CHART.axis, mark: "dashed" },
              ] as LegendItem[])
            : []),
        ]}
        hidden={legend.hidden}
        onToggle={legend.toggle}
      />
    </div>
  );
}
