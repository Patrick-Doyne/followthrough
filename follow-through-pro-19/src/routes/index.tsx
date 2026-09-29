import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Bell,
  BellRing,
  CalendarClock,
  Crosshair,
  Gauge,
  History,
  Ruler,
  Target,
  Timer,
  TrendingUp,
  TriangleRight,
} from "lucide-react";

import { useMemo } from "react";

import { ShootingChart } from "@/components/analytics/ShootingChart";
import { useAllShots } from "@/hooks/use-all-shots";
import { evenAxis } from "@/lib/chart-axis";
import { ReleaseTrendChart } from "@/components/analytics/ReleaseCharts";
import { DistanceProfileChart } from "@/components/analytics/ShotProfileCharts";
import { ScoreboardArt } from "@/components/dashboard/ScoreboardArt";
import { HeroDivider, PageHero } from "@/components/common/PageHero";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { RecentSessions } from "@/components/dashboard/RecentSessions";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { fmtDuration, fmtShortDate, fmtNumber, titleCase } from "@/lib/format";
import { dateFormatter } from "@/lib/intl";
import {
  calendarQuery,
  sessionsQuery,
  shootingSeriesQuery,
  summaryQuery,
} from "@/services/queries";
import { useChartTheme } from "@/lib/chart-theme";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TooltipRow, TooltipShell } from "@/components/charts/ChartTooltip";
import { mean } from "@/services/analytics.utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — FollowThrough Training Analytics" },
      {
        name: "description",
        content:
          "Training overview: shooting percentage, shot volume, shot distance and shot timing across recent basketball sessions.",
      },
      { property: "og:title", content: "Dashboard — FollowThrough Training Analytics" },
      {
        property: "og:description",
        content: "Your basketball training KPIs, recent sessions and performance trends.",
      },
    ],
  }),
  component: DashboardRoute,
});

function DashboardRoute() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const CHART = useChartTheme();
  const summary = useQuery(summaryQuery());
  const sessions = useQuery(sessionsQuery());
  const series = useQuery(shootingSeriesQuery());
  const calendar = useQuery(calendarQuery());

  /**
   * What the page's numbers cover: the period, and the shape of the work
   * inside it.
   *
   * <p>Every one of these is a fact no card below repeats, which is the
   * point -- the cards hold the measurements, and the band holds the
   * context you need to read them.
   */
  const span = useMemo(() => {
    const dated = (sessions.data ?? [])
      .map((s) => new Date(s.date).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    const first = dated[0];
    const last = dated[dated.length - 1];
    if (first === undefined || last === undefined) return null;
    const days = Math.max(1, Math.round((last - first) / 86_400_000));
    const kinds = new Set((sessions.data ?? []).map((s) => s.trainingType));
    return {
      label:
        fmtShortDate(new Date(first).toISOString()) === fmtShortDate(new Date(last).toISOString())
          ? fmtShortDate(new Date(last).toISOString())
          : `${fmtShortDate(new Date(first).toISOString())} – ${fmtShortDate(new Date(last).toISOString())}`,
      weeks: Math.max(1, Math.ceil(days / 7)),
      locations: new Set((sessions.data ?? []).map((s) => s.location).filter(Boolean)).size,
      types: [...kinds].map((t) => titleCase(t)).join(", "),
    };
  }, [sessions.data]);
  /* Telemetry, not `GET /analytics/shots` -- that endpoint is not
     implemented by the backend and answered 404 on every dashboard load.
     Same source as the analytics, session and video pages. */
  const allShots = useAllShots();
  const distanceAxis = useMemo(
    () =>
      evenAxis(
        (series.data ?? []).map((point) => point.avgShotDistance),
        { intervals: 4, minStep: 1, minSpan: 4, floorAtZero: true },
      ),
    [series.data],
  );

  const reminders = useMemo(() => {
    const events = calendar.data ?? [];
    return [
      ...events.filter((e) => e.status === "UPCOMING").slice(0, 2),
      ...events.filter((e) => e.status === "MISSED").slice(0, 1),
    ];
  }, [calendar.data]);

  const avgFg = useMemo(
    () => mean((series.data ?? []).map((p) => p.shootingPercentage)),
    [series.data],
  );

  return (
    /* hideHeader: the band below is this page's header. */
    <PageContainer title="Dashboard" hideHeader>
      <div className="space-y-5">
        <PageHero
          art={<ScoreboardArt />}
          eyebrow="Dashboard"
          /*
           * The band says what period these numbers cover and where the
           * work was done. It deliberately carries none of the eight
           * figures in the cards directly below it -- shots, makes, FG%
           * and session count were all in both, which is the page saying
           * the same thing twice and spending its most prominent surface
           * to do it.
           */
          title={span ? span.label : "Dashboard"}
          meta={
            span ? (
              <>
                <span>
                  {span.weeks} {span.weeks === 1 ? "week" : "weeks"} of training
                </span>
                <HeroDivider />
                <span>
                  {span.locations} {span.locations === 1 ? "location" : "locations"}
                </span>
                <HeroDivider />
                <span>{span.types}</span>
              </>
            ) : (
              <span>Training activity across all recorded sessions</span>
            )
          }
          /* Both actions carry their own opaque fill, which is the
             condition for sitting on the band's line art at all. */
          toolbar={
            <>
              <Button asChild variant="outline" size="sm" className="hero-rail border-transparent">
                <Link to="/analytics">
                  <BarChart3 className="size-4" aria-hidden />
                  Explore analytics
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/live">
                  <Activity className="size-4" aria-hidden />
                  Start live training
                </Link>
              </Button>
            </>
          }
        />

        {summary.isError ? (
          <ErrorState
            title="Your numbers didn't load"
            message="Check your connection, then try again."
            onRetry={() => void summary.refetch()}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Training sessions"
              value={summary.data ? fmtNumber(summary.data.totalSessions) : "—"}
              loading={summary.isPending}
              hint="all time"
              icon={<CalendarClock className="size-4" aria-hidden />}
            />
            <MetricCard
              label="Shots attempted"
              value={summary.data ? fmtNumber(summary.data.totalShots) : "—"}
              delta={summary.data?.deltas.totalShots}
              deltaSuffix=" /session"
              loading={summary.isPending}
              icon={<Crosshair className="size-4" aria-hidden />}
            />
            <MetricCard
              label="Makes"
              value={summary.data ? fmtNumber(summary.data.totalMakes) : "—"}
              loading={summary.isPending}
              hint={
                summary.data
                  ? `${fmtNumber(summary.data.totalShots - summary.data.totalMakes)} misses`
                  : undefined
              }
              icon={<Crosshair className="size-4" aria-hidden />}
            />
            <MetricCard
              label="Shooting percentage"
              value={summary.data ? summary.data.shootingPercentage.toFixed(1) : "—"}
              unit="%"
              delta={summary.data?.deltas.shootingPercentage}
              deltaSuffix=" pts"
              loading={summary.isPending}
              icon={<BarChart3 className="size-4" aria-hidden />}
            />
            <MetricCard
              label="Avg shot distance"
              value={summary.data ? summary.data.avgShotDistance.toFixed(1) : "—"}
              unit="ft"
              delta={summary.data?.deltas.avgShotDistance}
              loading={summary.isPending}
              icon={<Crosshair className="size-4" aria-hidden />}
            />
            <MetricCard
              label="Avg shot duration"
              value={summary.data ? summary.data.avgShotDuration.toFixed(2) : "—"}
              unit="s"
              delta={summary.data?.deltas.avgShotDuration}
              loading={summary.isPending}
              icon={<Gauge className="size-4" aria-hidden />}
            />
            <MetricCard
              label="Avg time to apex"
              value={summary.data ? summary.data.avgTimeToApex.toFixed(2) : "—"}
              unit="s"
              loading={summary.isPending}
              icon={<TriangleRight className="size-4" aria-hidden />}
            />
            <MetricCard
              label="Training time"
              value={summary.data ? fmtDuration(summary.data.totalTrainingMinutes) : "—"}
              loading={summary.isPending}
              icon={<Timer className="size-4" aria-hidden />}
            />
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-3">
          <SectionCard
            className="xl:col-span-2"
            icon={TrendingUp}
            title="Shooting percentage over time"
            description="Is your shooting improving?"
            bodyClassName="p-3"
          >
            {series.isPending ? (
              <LoadingState variant="chart" />
            ) : series.isError ? (
              <ErrorState onRetry={() => void series.refetch()} />
            ) : (
              <ShootingChart data={series.data ?? []} average={avgFg} />
            )}
          </SectionCard>

          <SectionCard
            icon={BellRing}
            title="Reminders"
            description="Training schedule alerts"
            bodyClassName="p-3"
          >
            {calendar.isPending ? (
              <LoadingState rows={2} />
            ) : reminders.length === 0 ? (
              <EmptyState
                title="Nothing scheduled"
                message="Add a session to the calendar and reminders show up here."
                icon={<Bell className="size-5" />}
              />
            ) : (
              <ul className="space-y-2">
                {reminders.map((event) => (
                  <li
                    key={event.eventId}
                    className="rounded-sm border border-border bg-surface px-3 py-2"
                  >
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span
                        className={`size-1.5 rounded-full ${event.status === "MISSED" ? "bg-miss" : "bg-primary"}`}
                        aria-hidden
                      />
                      {event.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {event.status === "MISSED" ? "Missed · " : "Upcoming · "}
                      {dateFormatter({
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(`${event.date}T${event.startTime}`))}
                    </p>
                  </li>
                ))}
                <li>
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <Link to="/calendar">Open training calendar</Link>
                  </Button>
                </li>
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard icon={BarChart3} title="Shot volume by session" bodyClassName="p-3">
            {series.isPending ? (
              <LoadingState variant="chart" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={series.data ?? []}
                  margin={{ top: 8, right: 8, bottom: 4, left: -18 }}
                >
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => fmtShortDate(v)}
                    stroke={CHART.axis}
                    tick={{ fill: CHART.axis, fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    stroke={CHART.axis}
                    tick={{ fill: CHART.axis, fontSize: 11 }}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    cursor={{ fill: CHART.grid, fillOpacity: 0.4 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]!.payload as {
                        label: string;
                        shots: number;
                        makes: number;
                      };
                      return (
                        <TooltipShell title={p.label}>
                          <TooltipRow label="Attempts" value={p.shots} color={CHART.primary} />
                          <TooltipRow label="Makes" value={p.makes} color={CHART.make} />
                        </TooltipShell>
                      );
                    }}
                  />
                  <Bar
                    dataKey="shots"
                    fill={CHART.primary}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="makes"
                    fill={CHART.make}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          <SectionCard icon={Ruler} title="Average shot distance by session" bodyClassName="p-3">
            {series.isPending ? (
              <LoadingState variant="chart" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={series.data ?? []}
                  margin={{ top: 8, right: 8, bottom: 4, left: -18 }}
                >
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => fmtShortDate(v)}
                    stroke={CHART.axis}
                    tick={{ fill: CHART.axis, fontSize: 11 }}
                    tickLine={false}
                  />
                  {/* Named ticks on a whole-foot grid. An "auto" domain
                      with the labels rounded to whole feet produced
                      "18 ft, 18 ft, 17 ft, 16 ft, 16 ft" -- two pairs of
                      duplicates, because the range was narrower than the
                      rounding. */}
                  <YAxis
                    domain={distanceAxis.domain}
                    ticks={distanceAxis.ticks}
                    stroke={CHART.axis}
                    tick={{ fill: CHART.axis, fontSize: 11 }}
                    tickLine={false}
                    width={52}
                    tickFormatter={(v: number) => `${v} ft`}
                  />
                  <Tooltip
                    cursor={{ stroke: CHART.grid }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]!.payload as {
                        label: string;
                        avgShotDistance: number;
                      };
                      return (
                        <TooltipShell title={p.label}>
                          <TooltipRow
                            label="Avg distance"
                            value={`${p.avgShotDistance.toFixed(1)} ft`}
                            color={CHART.secondary}
                          />
                        </TooltipShell>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgShotDistance"
                    stroke={CHART.secondary}
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: CHART.secondary, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            icon={Activity}
            title="Arc and release consistency"
            description="Is your shot settling down?"
            bodyClassName="p-3"
          >
            {/* This card used to plot average shot duration and time to
                apex per session. Both are very nearly a redraw of the
                average-distance card beside it -- measured across the
                sample sessions, r = 0.98 and r = 0.93 against mean
                distance -- so the pair said one thing twice. */}
            {allShots.isPending ? (
              <LoadingState variant="chart" />
            ) : (
              <ReleaseTrendChart shots={allShots.shots} height={220} />
            )}
          </SectionCard>

          <SectionCard
            icon={Target}
            title="Accuracy and volume by distance"
            description="Where do your attempts go, and where do they pay off?"
            bodyClassName="p-3"
          >
            {allShots.isPending ? (
              <LoadingState variant="chart" />
            ) : (
              <DistanceProfileChart shots={allShots.shots} height={240} />
            )}
          </SectionCard>
        </div>

        <SectionCard
          icon={History}
          title="Recent sessions"
          description="Select a session to open its detailed analytics"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link to="/analytics">View all analytics</Link>
            </Button>
          }
          bodyClassName="px-0 py-0"
        >
          <div className="px-4 py-2">
            <RecentSessions
              sessions={sessions.data}
              isPending={sessions.isPending}
              isError={sessions.isError}
              onRetry={() => void sessions.refetch()}
              limit={6}
            />
          </div>
        </SectionCard>
      </div>
    </PageContainer>
  );
}
