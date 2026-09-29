import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  Columns3,
  Crosshair,
  Flame,
  Gauge,
  ScatterChart,
  Spline,
  Table,
  Target,
  Timer,
  Video,
} from "lucide-react";
import { useState } from "react";

import { InsightList } from "@/components/analytics/InsightList";
import {
  ArcConsistencyChart,
  ReleaseDeviationChart,
  ReleaseFitChart,
} from "@/components/analytics/ReleaseCharts";
import { SessionRhythmChart, SessionShapeChart } from "@/components/analytics/SessionRhythmCharts";
import { ShotDetailPanel } from "@/components/analytics/ShotDetailPanel";
import { ShotLocationChart } from "@/components/analytics/ShotLocationChart";
import {
  DistanceProfileChart,
  ShotDesignationChart,
} from "@/components/analytics/ShotProfileCharts";
import { SectionCard } from "@/components/common/SectionCard";
import { ResultBadge, StatusBadge } from "@/components/common/ResultBadge";
import { ErrorState, LoadingState } from "@/components/common/states";
import { ArcArt } from "@/components/analytics/ArcArt";
import { HeroDivider, HeroStrong, PageHero } from "@/components/common/PageHero";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fmtDate,
  fmtDistance,
  fmtDuration,
  fmtPercent,
  fmtSeconds,
  fmtShotType,
  titleCase,
} from "@/lib/format";
import { useSessionShots } from "@/hooks/use-session-shots";
import { sessionQuery, sessionVideosQuery } from "@/services/queries";
import type { Shot } from "@/types/telemetry";

export const Route = createFileRoute("/sessions/$sessionId")({
  head: () => ({
    meta: [
      { title: "Session Analytics — FollowThrough" },
      {
        name: "description",
        content:
          "Break down a single basketball training session: shot mechanics and court locations.",
      },
      { property: "og:title", content: "Session Analytics — FollowThrough" },
      {
        property: "og:description",
        content: "Per-shot telemetry breakdown for one training session.",
      },
    ],
  }),
  component: SessionDetailRoute,
});

function SessionDetailRoute() {
  const { sessionId } = Route.useParams();
  const session = useQuery(sessionQuery(sessionId));
  /*
   * Shots come from the videos' telemetry, not a shots store -- the
   * same source the video review page reads, so the two pages cannot
   * disagree about a session.
   */
  const shots = useSessionShots(sessionId);
  const videos = useQuery(sessionVideosQuery(sessionId));

  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [locationMode, setLocationMode] = useState<"SHOTS" | "DENSITY">("SHOTS");

  const shotList = shots.shots;
  // Already scoped to this session by the endpoint itself.
  const video = videos.data?.[0];
  const focusShot = selectedShot ?? shotList[0];

  const openShot = (shot: Shot) => {
    setSelectedShot(shot);
    setDetailOpen(true);
  };

  return (
    <AppShell>
      {/* hideHeader: the band below is this page's header. */}
      <PageContainer title={session.data?.name ?? "Session"} hideHeader>
        <PageHero
          art={<ArcArt />}
          eyebrow="Session analytics"
          title={session.data?.name ?? "Session"}
          meta={
            session.data ? (
              <>
                <span>{fmtDate(session.data.date)}</span>
                <HeroDivider />
                <span>{session.data.location}</span>
                <HeroDivider />
                <span>{fmtDuration(session.data.durationMinutes)}</span>
                <HeroDivider />
                <span>
                  <HeroStrong>{session.data.shots}</HeroStrong> shots
                </span>
              </>
            ) : null
          }
          toolbar={
            <>
              <Button asChild variant="outline" className="hero-rail h-9 gap-1.5 px-3 text-xs">
                <Link to="/analytics">
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Analytics
                </Link>
              </Button>
              {video ? (
                <Button asChild className="h-9 gap-1.5 px-3 text-xs shadow-none">
                  <Link to="/videos/$videoId" params={{ videoId: video.videoId }} search={{ t: 0 }}>
                    <Video className="size-3.5" aria-hidden />
                    Watch video
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />

        {session.isPending || shots.isPending ? (
          <LoadingState rows={6} label="Loading session…" />
        ) : session.isError || !session.data ? (
          <ErrorState
            title="This session didn't load"
            message="Check your connection, then try again."
            onRetry={() => void session.refetch()}
          />
        ) : (
          <div className="space-y-4">
            <SectionCard
              icon={Gauge}
              title="Session summary"
              actions={<StatusBadge status={session.data.status} />}
              bodyClassName="p-3"
            >
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Shots", String(session.data.shots)],
                  ["Makes", String(session.data.makes)],
                  ["FG%", fmtPercent(session.data.shootingPercentage)],
                  ["Avg shot duration", fmtSeconds(session.data.avgShotDuration)],
                  ["Avg time to apex", fmtSeconds(session.data.avgTimeToApex)],
                  ["Avg distance", fmtDistance(session.data.avgShotDistance)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="label-caps">{label}</dt>
                    <dd className="metric-value text-lg font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </SectionCard>

            {/* The findings sit above the tabs, not inside one, because they
                are what tells the reader which tab to open. */}
            <InsightList shots={shotList} />

            <Tabs defaultValue="where">
              <TabsList className="flex-wrap">
                <TabsTrigger value="where">Where you shot</TabsTrigger>
                <TabsTrigger value="mechanics">Release</TabsTrigger>
                <TabsTrigger value="rhythm">Rhythm</TabsTrigger>
                <TabsTrigger value="court">Court</TabsTrigger>
                <TabsTrigger value="shots">Shot log</TabsTrigger>
              </TabsList>

              <TabsContent value="where" className="mt-4 space-y-4">
                <SectionCard
                  icon={BarChart3}
                  title="Accuracy and volume by distance"
                  description="Where did your attempts go, and where did they pay off?"
                  bodyClassName="p-3"
                >
                  <DistanceProfileChart shots={shotList} height={300} />
                </SectionCard>
                <SectionCard
                  icon={Crosshair}
                  title="Accuracy by shot class"
                  description="Which kinds of shot did you make?"
                  bodyClassName="p-4"
                >
                  <ShotDesignationChart shots={shotList} />
                </SectionCard>
              </TabsContent>

              <TabsContent value="mechanics" className="mt-4 space-y-4">
                <SectionCard
                  icon={Spline}
                  title="Arc consistency"
                  description="Was your arc repeatable, and which arc went in?"
                  bodyClassName="p-3"
                >
                  <ArcConsistencyChart shots={shotList} height={280} />
                </SectionCard>
                <SectionCard
                  icon={ScatterChart}
                  title="Flight time against distance"
                  description="Did your release hold steady as you moved out? · click a shot to open it"
                  bodyClassName="p-3"
                >
                  <ReleaseFitChart shots={shotList} height={320} onSelectShot={openShot} />
                </SectionCard>
                <SectionCard
                  icon={Timer}
                  title="Accuracy against your normal release"
                  description="Did you shoot better when your release was normal?"
                  bodyClassName="p-3"
                >
                  <ReleaseDeviationChart shots={shotList} height={260} />
                </SectionCard>
              </TabsContent>

              <TabsContent value="rhythm" className="mt-4 space-y-4">
                <SectionCard
                  icon={Flame}
                  title="Hot and cold stretches"
                  description="Did you run hot or cold, and when? · click any mark to open that shot"
                  bodyClassName="p-3"
                >
                  <SessionRhythmChart shots={shotList} height={280} onSelectShot={openShot} />
                </SectionCard>
                <SectionCard
                  icon={Columns3}
                  title="Opening, middle and closing"
                  description="Did you warm up, hold steady or fade?"
                  bodyClassName="p-4"
                >
                  <SessionShapeChart shots={shotList} />
                </SectionCard>
              </TabsContent>

              <TabsContent value="court" className="mt-4">
                <SectionCard
                  icon={Target}
                  title="Shot locations"
                  actions={
                    <div className="flex gap-1">
                      {(["SHOTS", "DENSITY"] as const).map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={locationMode === mode ? "secondary" : "ghost"}
                          onClick={() => setLocationMode(mode)}
                        >
                          {titleCase(mode)}
                        </Button>
                      ))}
                    </div>
                  }
                  bodyClassName="p-3"
                >
                  <div className="mx-auto max-w-3xl">
                    <ShotLocationChart
                      shots={shotList}
                      mode={locationMode}
                      onSelectShot={openShot}
                      selectedShotId={selectedShot?.shotId}
                      showZoneFilters
                    />
                  </div>
                </SectionCard>
              </TabsContent>

              <TabsContent value="shots" className="mt-4">
                <SectionCard icon={Table} title="Shot log" bodyClassName="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left">
                          {[
                            "#",
                            "Type",
                            "Zone",
                            "Distance",
                            "Duration",
                            "Time to apex",
                            "Result",
                          ].map((h) => (
                            <th key={h} className="label-caps px-3 py-2 font-medium">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shotList.map((shot) => (
                          <tr
                            key={shot.shotId}
                            className="cursor-pointer border-b border-border/60 hover:bg-accent/40"
                            onClick={() => openShot(shot)}
                          >
                            <td className="metric-value px-3 py-2">{shot.shotNumber}</td>
                            <td className="px-3 py-2">{fmtShotType(shot.shotType)}</td>
                            <td className="px-3 py-2">{shot.zone ? titleCase(shot.zone) : "—"}</td>
                            <td className="metric-value px-3 py-2">
                              {fmtDistance(shot.shotDistance)}
                            </td>
                            <td className="metric-value px-3 py-2">
                              {fmtSeconds(shot.shotDuration)}
                            </td>
                            <td className="metric-value px-3 py-2">
                              {fmtSeconds(shot.timeToApex)}
                            </td>
                            <td className="px-3 py-2">
                              <ResultBadge result={shot.result} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              </TabsContent>
            </Tabs>
          </div>
        )}

        <ShotDetailPanel shot={selectedShot} open={detailOpen} onOpenChange={setDetailOpen} />
      </PageContainer>
    </AppShell>
  );
}
