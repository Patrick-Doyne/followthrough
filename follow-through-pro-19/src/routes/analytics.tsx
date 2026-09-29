import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  ChartFilters,
  DEFAULT_FILTERS,
  type AnalyticsFilters,
} from "@/components/analytics/ChartFilters";
import { InsightList } from "@/components/analytics/InsightList";
import { SpreadArt } from "@/components/analytics/SpreadArt";
import {
  ArcConsistencyChart,
  ReleaseDeviationChart,
  ReleaseFitChart,
  ReleaseTrendChart,
} from "@/components/analytics/ReleaseCharts";
import { SessionRhythmChart, SessionShapeChart } from "@/components/analytics/SessionRhythmCharts";
import { ShootingChart } from "@/components/analytics/ShootingChart";
import { ShotQualityChart } from "@/components/analytics/ShotQualityChart";
import { ShotDetailPanel } from "@/components/analytics/ShotDetailPanel";
import { ShotLocationChart } from "@/components/analytics/ShotLocationChart";
import {
  DistanceProfileChart,
  ShotDesignationChart,
} from "@/components/analytics/ShotProfileCharts";
import { SectionCard } from "@/components/common/SectionCard";
import {
  Activity,
  Crosshair,
  Flame,
  Hourglass,
  MapPin,
  Ruler,
  Scale,
  SlidersHorizontal,
  Spline,
  Target,
  Timer,
  TrendingUp,
} from "lucide-react";
import { fmtShortDate, fmtShotType, titleCase } from "@/lib/format";
import { HeroDivider, PageHero } from "@/components/common/PageHero";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAllShots } from "@/hooks/use-all-shots";
import { filterShots } from "@/lib/shot-filter";
import { mean } from "@/services/analytics.utils";
import { sessionsQuery, shootingSeriesQuery } from "@/services/queries";
import { FeatureGate } from "@/state/subscription";
import type { Shot } from "@/types/telemetry";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — FollowThrough Shot Telemetry" },
      {
        name: "description",
        content:
          "Explore basketball shot telemetry: shot type, distance, result, shot duration, time to apex and shot locations.",
      },
      { property: "og:title", content: "Analytics — FollowThrough Shot Telemetry" },
      {
        property: "og:description",
        content: "Interactive shot telemetry exploration across your training sessions.",
      },
    ],
  }),
  component: AnalyticsRoute,
});

function AnalyticsRoute() {
  return (
    <AppShell>
      <AnalyticsPage />
    </AppShell>
  );
}

function AnalyticsPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [courtMode, setCourtMode] = useState<"SHOTS" | "DENSITY">("SHOTS");

  const sessions = useQuery(sessionsQuery());
  const series = useQuery(shootingSeriesQuery());
  /*
   * Shots come from the processed videos' own telemetry, not from a shots
   * endpoint. `GET /analytics/shots` is not implemented by the backend --
   * it answers 404 "No such endpoint" -- so every chart here was empty and
   * the page fired three failing requests on every load. This is the same
   * source the session and video pages read, which is also what stops the
   * three pages disagreeing about a session.
   */
  const shots = useAllShots();

  const comparisonSeries = useMemo(() => {
    if (filters.comparisonSessionId === "NONE") return undefined;
    const point = series.data?.find((p) => p.sessionId === filters.comparisonSessionId);
    if (!point || !series.data) return undefined;
    return series.data.map((p) => ({ ...p, shootingPercentage: point.shootingPercentage }));
  }, [filters.comparisonSessionId, series.data]);

  const comparisonLabel = sessions.data?.find(
    (s) => s.sessionId === filters.comparisonSessionId,
  )?.name;

  /* Filtering moved client-side with the data source. `useAllShots`
     already returns a stable array, and the memo keeps the filtered one
     stable too -- otherwise every finding and every chart binning would be
     re-derived on each render. */
  const shotList = useMemo(
    () =>
      filterShots(shots.shots, {
        sessionId: filters.sessionId,
        from: filters.from,
        to: filters.to,
        result: filters.result,
        shotType: filters.shotType,
        zone: filters.zone,
      }),
    [shots.shots, filters],
  );

  /**
   * What the filters have left in view, in words.
   *
   * <p>The band's whole job. Only the filters that are actually narrowing
   * anything are named: listing "All types · All locations · Makes &
   * misses" on an unfiltered page is three lines of nothing, and it
   * buries the one that is set when one is.
   */
  const scope = useMemo(() => {
    const total = sessions.data?.length ?? 0;
    const named = sessions.data?.find((s) => s.sessionId === filters.sessionId);
    const narrowing: string[] = [];
    if (filters.result !== "ALL")
      narrowing.push(filters.result === "MAKE" ? "makes only" : "misses only");
    if (filters.shotType !== "ALL") narrowing.push(fmtShotType(filters.shotType));
    if (filters.zone !== "ALL") narrowing.push(titleCase(filters.zone.replace(/_/g, " ")));
    if (filters.from || filters.to) narrowing.push("a date range");

    const dates = shotList
      .map((s) => new Date(s.timestamp).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    const first = dates[0];
    const last = dates[dates.length - 1];

    return {
      title: named ? named.name : total > 0 ? `All ${total} sessions` : "Analytics",
      detail:
        narrowing.length > 0
          ? `Narrowed to ${narrowing.join(", ")}`
          : named
            ? "Every shot in this session"
            : "Every shot in your library",
      range:
        first !== undefined && last !== undefined
          ? fmtShortDate(new Date(first).toISOString()) ===
            fmtShortDate(new Date(last).toISOString())
            ? fmtShortDate(new Date(last).toISOString())
            : `${fmtShortDate(new Date(first).toISOString())} – ${fmtShortDate(new Date(last).toISOString())}`
          : null,
    };
  }, [sessions.data, filters, shotList]);

  const openShot = (shot: Shot) => {
    setSelectedShot(shot);
    setDetailOpen(true);
  };

  const summaryLine = useMemo(() => {
    if (shotList.length === 0) return null;
    const makes = shotList.filter((s) => s.result === "MAKE").length;
    return {
      shots: shotList.length,
      makes,
      percentage: (makes / shotList.length) * 100,
      distance: mean(shotList.map((s) => s.shotDistance)),
      duration: mean(shotList.map((s) => s.shotDuration)),
      apex: mean(shotList.map((s) => s.timeToApex)),
    };
  }, [shotList]);

  return (
    /* hideHeader: the band below is this page's header. */
    <PageContainer title="Analytics" hideHeader>
      <div className="space-y-5">
        <PageHero
          art={<SpreadArt />}
          eyebrow="Analytics"
          /*
           * The band says what is in view; the strip below says what it
           * measures. They used to say the same four numbers -- shots,
           * makes, FG% and average distance were in both, one above the
           * other -- and the band is the wrong surface to spend on a
           * repeat.
           *
           * Scope is also the thing you actually want while filtering,
           * and the one thing nothing else on the page shows.
           */
          title={scope.title}
          meta={
            <>
              <span>{scope.detail}</span>
              {scope.range ? (
                <>
                  <HeroDivider />
                  <span>{scope.range}</span>
                </>
              ) : null}
            </>
          }
        />

        <SectionCard icon={SlidersHorizontal} title="Filters" bodyClassName="p-3">
          {sessions.isPending ? (
            <LoadingState rows={2} />
          ) : (
            <ChartFilters
              filters={filters}
              sessions={sessions.data ?? []}
              onChange={setFilters}
              onReset={() => setFilters(DEFAULT_FILTERS)}
            />
          )}
        </SectionCard>

        {summaryLine ? (
          <div className="panel glow flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 text-sm">
            {[
              ["Shots", summaryLine.shots.toString()],
              ["Makes", summaryLine.makes.toString()],
              ["FG%", `${summaryLine.percentage.toFixed(1)}%`],
              ["Avg distance", `${summaryLine.distance.toFixed(1)} ft`],
              ["Avg shot duration", `${summaryLine.duration.toFixed(2)} s`],
              ["Avg time to apex", `${summaryLine.apex.toFixed(2)} s`],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="label-caps">{label}</p>
                <p className="metric-value text-base font-semibold">{value}</p>
              </div>
            ))}
            {shots.isFetching ? (
              <LoadingState variant="inline" label="Updating…" className="ml-auto" />
            ) : null}
          </div>
        ) : null}

        {shots.isError ? (
          <ErrorState
            title="Your analytics didn't load"
            message="Check your connection, then try again."
            onRetry={() => void shots.refetch()}
          />
        ) : null}

        {/* Told apart deliberately. Charts with no shots used to say things
            like "these shots carry no release or apex time", which blames
            the data for what is actually an empty library and sends the
            reader looking for a bug in the chart. */}
        {!shots.isPending && !shots.isError && shots.shots.length === 0 ? (
          <EmptyState
            title={
              shots.processed === 0
                ? "No processed videos yet"
                : "No shot telemetry in your processed videos"
            }
            message={
              shots.processed === 0
                ? "These charts are built from the shots the pipeline writes while it processes a video. Upload and process one and they will fill in."
                : `${shots.processed} video${shots.processed === 1 ? " has" : "s have"} finished processing, but ${shots.processed === 1 ? "it carries" : "they carry"} no shot records. Clips processed before shot telemetry was added have none — re-process them to populate these charts.`
            }
          />
        ) : null}

        <Tabs defaultValue="trends">
          <TabsList className="flex-wrap">
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="where">Where you shoot</TabsTrigger>
            <TabsTrigger value="mechanics">Release</TabsTrigger>
            <TabsTrigger value="rhythm">Rhythm</TabsTrigger>
            <TabsTrigger value="court">Court</TabsTrigger>
          </TabsList>

          <TabsContent value="trends" className="mt-4 space-y-4">
            {/* The findings first: they name which of the charts below is
                worth opening for this particular filter, and they vanish
                when nothing in the data clears a threshold. */}
            {shots.isPending ? null : <InsightList shots={shotList} />}
            <SectionCard
              icon={TrendingUp}
              title="Shooting percentage over time"
              description="Is your shooting improving? One point per session · click a point to filter to it"
              bodyClassName="p-3"
            >
              {series.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <ShootingChart
                  data={series.data ?? []}
                  comparison={comparisonSeries}
                  comparisonLabel={comparisonLabel}
                  average={mean((series.data ?? []).map((p) => p.shootingPercentage))}
                  height={300}
                  onPointSelect={(sessionId) => setFilters({ ...filters, sessionId })}
                />
              )}
            </SectionCard>

            <SectionCard
              icon={Scale}
              title="Shot selection versus shooting"
              description="Did a good percentage come from good shooting, or from easy shots? · click a session to filter to it"
              bodyClassName="p-3"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <ShotQualityChart
                  shots={shotList}
                  height={300}
                  onSelectSession={(sessionId) => setFilters({ ...filters, sessionId })}
                />
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="where" className="mt-4 space-y-4">
            <SectionCard
              icon={Ruler}
              title="Accuracy and volume by distance"
              description="Where do your attempts go, and where do they pay off?"
              bodyClassName="p-3"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <DistanceProfileChart shots={shotList} height={320} />
              )}
            </SectionCard>

            <SectionCard
              icon={Target}
              title="Accuracy by shot class"
              description="Which kinds of shot do you make?"
              bodyClassName="p-4"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <ShotDesignationChart shots={shotList} />
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="mechanics" className="mt-4 space-y-4">
            <SectionCard
              icon={Spline}
              title="Arc consistency"
              description="Is your arc repeatable, and which arc goes in?"
              bodyClassName="p-3"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <ArcConsistencyChart shots={shotList} height={300} />
              )}
            </SectionCard>

            <SectionCard
              icon={Timer}
              title="Flight time against distance"
              description="Does your release hold steady as you move out? · click a shot to open it"
              bodyClassName="p-3"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <ReleaseFitChart shots={shotList} height={340} onSelectShot={openShot} />
              )}
            </SectionCard>

            <SectionCard
              icon={Crosshair}
              title="Accuracy against your normal release"
              description="Do you shoot better when your release is normal?"
              bodyClassName="p-3"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <ReleaseDeviationChart shots={shotList} height={280} />
              )}
            </SectionCard>

            <SectionCard
              icon={Activity}
              title="Arc and release consistency"
              description="Is your shot settling down? · click a point to filter to that session"
              bodyClassName="p-3"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <ReleaseTrendChart
                  shots={shotList}
                  height={280}
                  onSelectSession={(sessionId) => setFilters({ ...filters, sessionId })}
                />
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="rhythm" className="mt-4 space-y-4">
            <SectionCard
              icon={Flame}
              title="Hot and cold stretches"
              description="Did you run hot or cold, and when?"
              bodyClassName="p-3"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <SessionRhythmChart shots={shotList} height={300} onSelectShot={openShot} />
              )}
            </SectionCard>

            <SectionCard
              icon={Hourglass}
              title="Opening, middle and closing"
              description="Did you warm up, hold steady or fade?"
              bodyClassName="p-4"
            >
              <FeatureGate feature="distributionAnalytics">
                {shots.isPending ? (
                  <LoadingState variant="chart" />
                ) : (
                  <SessionShapeChart shots={shotList} />
                )}
              </FeatureGate>
            </SectionCard>
          </TabsContent>

          <TabsContent value="court" className="mt-4">
            <SectionCard
              icon={MapPin}
              title="Shot locations"
              description="Where on the floor did the shots come from? · focus a marker for its details"
              actions={
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={courtMode}
                  onValueChange={(v) => v && setCourtMode(v as "SHOTS" | "DENSITY")}
                >
                  <ToggleGroupItem value="SHOTS" aria-label="Individual shots">
                    Shots
                  </ToggleGroupItem>
                  <ToggleGroupItem value="DENSITY" aria-label="Aggregate density">
                    Density
                  </ToggleGroupItem>
                </ToggleGroup>
              }
              bodyClassName="p-3"
            >
              {shots.isPending ? (
                <LoadingState variant="chart" />
              ) : (
                <div className="mx-auto max-w-3xl">
                  <ShotLocationChart
                    shots={shotList}
                    mode={courtMode}
                    onSelectShot={openShot}
                    selectedShotId={selectedShot?.shotId}
                    showZoneFilters
                  />
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>

      <ShotDetailPanel shot={selectedShot} open={detailOpen} onOpenChange={setDetailOpen} />
    </PageContainer>
  );
}
