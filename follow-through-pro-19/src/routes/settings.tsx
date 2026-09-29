import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Check,
  CreditCard,
  Gauge,
  LineChart,
  SlidersHorizontal,
  KeyRound,
  Sparkles,
  Table2,
  User,
} from "lucide-react";
import { useState } from "react";

import { ErrorState, LoadingState } from "@/components/common/states";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { NotificationDelivery } from "@/components/settings/NotificationDelivery";
import { PlanCard } from "@/components/settings/PlanCard";
import { SectionCard } from "@/components/common/SectionCard";
import { SettingsHero } from "@/components/settings/SettingsHero";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { UsageMeter } from "@/components/settings/UsageMeter";
import { SettingsSearch } from "@/components/settings/SettingsSearch";
import { UsabilityTab } from "@/components/settings/UsabilityTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { MessageKey } from "@/lib/i18n";
import { titleCase } from "@/lib/format";
import { userService } from "@/services/followthrough";
import { userQuery } from "@/services/queries";
import { useAuth } from "@/state/auth";
import { useBrandMarkUpload } from "@/hooks/use-brand-mark-upload";
import { useSettings, useT } from "@/state/settings-provider";
import type { MetricKey, SubscriptionTier, UserProfile } from "@/types/telemetry";

const TABS = ["profile", "preferences", "usability", "notifications", "subscription"] as const;
type SettingsTab = (typeof TABS)[number];

/** The tabs backed by the account service, as opposed to device settings. */
const SERVER_TABS = TABS.filter((t) => t !== "usability");

const TAB_LABEL_KEY: Record<SettingsTab, MessageKey> = {
  profile: "settings.tab.profile",
  preferences: "settings.tab.preferences",
  usability: "settings.tab.usability",
  notifications: "settings.tab.notifications",
  subscription: "settings.tab.subscription",
};

/** Each section's mark. Used in the nav segment and again on its cards,
 * so the icon is what ties the two together rather than position. */
const TAB_ICON = {
  profile: User,
  preferences: SlidersHorizontal,
  usability: Sparkles,
  notifications: Bell,
  subscription: CreditCard,
} as const;

/**
 * Scrolls to a panel and flags it briefly, after switching tabs.
 *
 * <p>Two frames, not one: the first commits the tab change, and the panel
 * does not exist in the DOM until after that. The ring is removed on a
 * timer rather than left in place so it reads as "here it is" rather than
 * as a selection state.
 */
function jumpToPanel(anchor: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const target = document.getElementById(anchor);
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.add("ring-2", "ring-[var(--sec)]");
      setTimeout(() => target.classList.remove("ring-2", "ring-[var(--sec)]"), 1600);
    }),
  );
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { tab: SettingsTab } => {
    const tab = String(search["tab"] ?? "profile") as SettingsTab;
    return { tab: TABS.includes(tab) ? tab : "profile" };
  },
  head: () => ({
    meta: [
      { title: "Settings — FollowThrough" },
      {
        name: "description",
        content:
          "Manage your FollowThrough profile, training preferences, notifications and subscription plan.",
      },
      { property: "og:title", content: "Settings — FollowThrough" },
      {
        property: "og:description",
        content: "Account, preferences and plan management for FollowThrough.",
      },
    ],
  }),
  component: SettingsRoute,
});

const TIERS: { tier: SubscriptionTier; price: string; features: string[] }[] = [
  {
    tier: "FREE",
    price: "$0 / mo",
    features: ["3 videos per month", "Basic session summaries", "Manual scheduling"],
  },
  {
    tier: "BASIC",
    price: "$19 / mo",
    features: ["25 videos per month", "Full shot mechanics charts", "Video telemetry overlay"],
  },
  {
    tier: "PREMIUM",
    price: "$49 / mo",
    features: ["Unlimited videos", "Real-time live training", "Shot heatmap analysis"],
  },
];

const METRIC_LABELS: Record<MetricKey, string> = {
  shootingPercentage: "Shooting percentage",
  shotDistance: "Shot distance",
  shotDuration: "Shot duration",
  timeToApex: "Time to apex",
  shotVolume: "Shot volume",
  makes: "Makes",
  misses: "Misses",
};

const METRICS: MetricKey[] = [
  "shootingPercentage",
  "shotDistance",
  "shotDuration",
  "timeToApex",
  "shotVolume",
];

function SettingsRoute() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: "/settings" });
  const qc = useQueryClient();
  const { identity, logout } = useAuth();
  const t = useT();
  // The mark lives with the theme in the settings document, not on the
  // account record, so it comes from the settings store rather than the
  // profile query.
  const { settings, update } = useSettings();
  // The plate in the hero opens the same picker the Appearance card
  // does; each owns its own input (see useBrandMarkUpload).
  const markUpload = useBrandMarkUpload((brandMark) => update({ brandMark }));
  const user = useQuery(userQuery());

  const save = useMutation({
    mutationFn: (patch: Partial<UserProfile>) => userService.update(patch),
    onSuccess: (next) => {
      qc.setQueryData(["user"], next);
      void qc.invalidateQueries({ queryKey: ["user"] });
    },
  });

  const profile = user.data;
  const [name, setName] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);

  const prefs = profile?.preferences;
  const setPrefs = (patch: Partial<NonNullable<typeof prefs>>) => {
    if (!prefs) return;
    save.mutate({ preferences: { ...prefs, ...patch } });
  };

  return (
    <AppShell>
      {/* hideHeader: the hero below is this page's header. */}
      <PageContainer title={t("settings.title")} hideHeader>
        {/* Everything the settings visual language touches is inside this
            attribute, and nothing outside the route sets it. */}
        <div data-settings>
          <input
            ref={markUpload.inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void markUpload.onChange(e)}
          />
          <SettingsHero
            eyebrow={t("settings.title")}
            mark={settings.brandMark}
            onEditMark={markUpload.open}
            name={profile?.name ?? identity?.name ?? "Your account"}
            position={profile?.position ?? "—"}
            team={profile?.team ?? identity?.email ?? "—"}
            tier={profile?.tier}
          />

          <Tabs
            value={tab}
            onValueChange={(value) =>
              void navigate({ to: ".", search: { tab: value as SettingsTab } })
            }
          >
            {/* The search rides the tab rail rather than the hero.

                It belongs next to the tabs on the argument alone --
                its results are links that switch tabs, so it does the
                same job the rail does -- but the reason it moved is
                that the hero's ground is painted court lines, and a
                field sitting on top of them had the arcs running
                straight through it. Nothing legible goes over that
                artwork.

                Below `sm` the field drops under the rail instead of
                squeezing it: five segments already overflow a phone
                and the rail scrolls, so taking width from it there
                would just push the active tab off screen. */}
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <SettingsNav
                className="sm:flex-1"
                active={tab}
                tabs={TABS.map((tabId) => ({
                  id: tabId,
                  label: t(TAB_LABEL_KEY[tabId]),
                  icon: TAB_ICON[tabId],
                }))}
              />
              <SettingsSearch
                onJump={(nextTab, anchor) => {
                  void navigate({ to: ".", search: { tab: nextTab } });
                  jumpToPanel(anchor);
                }}
              />
            </div>

            {/* Display settings live on the device, so this tab deliberately
              sits outside the account-loading gate below: it still works
              when the account service is unreachable. */}
            <TabsContent value="usability">
              <UsabilityTab />
            </TabsContent>

            {!profile || !prefs ? (
              SERVER_TABS.map((tabId) => (
                <TabsContent key={tabId} value={tabId}>
                  {/* Carried in a card like everything else, so the tab
                      does not change shape between loading and loaded. */}
                  <SectionCard icon={TAB_ICON[tabId]} title={t(TAB_LABEL_KEY[tabId])}>
                    {user.isPending ? (
                      <LoadingState rows={5} label={t("common.loading")} />
                    ) : (
                      <ErrorState
                        title={t("settings.loadError")}
                        message={t("settings.loadErrorBody")}
                        onRetry={() => void user.refetch()}
                      />
                    )}
                  </SectionCard>
                </TabsContent>
              ))
            ) : (
              <>
                <TabsContent value="profile">
                  {/* Two cards rather than one.
                      Editable identity and the fixed account facts are
                      different things, and as a single card they were a
                      max-w-2xl form stranded in a 1168px box with the
                      right half empty. Split, each one fills its column. */}
                  <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
                    <SectionCard
                      id="profile"
                      icon={User}
                      title="Player profile"
                      description="How you appear across FollowThrough."
                      bodyClassName="flex flex-col p-4"
                    >
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="s-name">Name</Label>
                          <Input
                            id="s-name"
                            value={name ?? profile.name}
                            onChange={(e) => setName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="s-position">Position</Label>
                          <Input
                            id="s-position"
                            value={position ?? profile.position}
                            onChange={(e) => setPosition(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="s-team">Team</Label>
                          <Input
                            id="s-team"
                            value={team ?? profile.team}
                            onChange={(e) => setTeam(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="mt-auto flex items-center gap-2 pt-4">
                        <Button
                          size="sm"
                          disabled={save.isPending}
                          onClick={() =>
                            save.mutate({
                              name: name ?? profile.name,
                              position: position ?? profile.position,
                              team: team ?? profile.team,
                            })
                          }
                        >
                          Save changes
                        </Button>
                        {save.isSuccess ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Check className="size-3.5" aria-hidden /> Saved
                          </span>
                        ) : null}
                      </div>
                    </SectionCard>

                    <SectionCard
                      id="account"
                      icon={KeyRound}
                      title="Account"
                      description="Your sign-in, and how to leave it."
                      bodyClassName="flex flex-col p-4"
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="s-email">Email</Label>
                        <Input id="s-email" value={identity?.email ?? profile.email} readOnly />
                        <p className="text-xs text-muted-foreground">
                          Your email is the account itself, so it cannot be changed here.
                        </p>
                      </div>
                      <div className="mt-auto pt-4">
                        <Button size="sm" variant="outline" onClick={logout}>
                          Sign out
                        </Button>
                      </div>
                    </SectionCard>
                  </div>
                </TabsContent>

                <TabsContent value="preferences" className="space-y-5">
                  {/* Two fields each, so the pair matches in height and the
                      row closes flush. The two chart/table switches used to
                      live in Analytics defaults, which made it twice the
                      height of its partner; they are display options rather
                      than defaults, so they are their own card below. */}
                  <div className="grid items-start gap-5 lg:grid-cols-2">
                    <SectionCard
                      id="training-defaults"
                      icon={Gauge}
                      title="Training defaults"
                      description="Applied to every new session."
                      bodyClassName="space-y-4 p-4"
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="s-duration">Default session duration (minutes)</Label>
                        <Input
                          id="s-duration"
                          type="number"
                          min={15}
                          step={15}
                          value={prefs.defaultSessionDuration}
                          onChange={(e) =>
                            setPrefs({ defaultSessionDuration: Number(e.target.value) || 60 })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Units</Label>
                        <Select
                          value={prefs.units}
                          onValueChange={(value) =>
                            setPrefs({ units: value as "METRIC" | "IMPERIAL" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="METRIC">Metric (m)</SelectItem>
                            <SelectItem value="IMPERIAL">Imperial (ft)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </SectionCard>

                    <SectionCard
                      id="analytics-defaults"
                      icon={LineChart}
                      title="Analytics defaults"
                      description="What the charts open on."
                      bodyClassName="space-y-4 p-4"
                    >
                      <div className="space-y-1.5">
                        <Label>Default metric</Label>
                        <Select
                          value={prefs.defaultMetric}
                          onValueChange={(value) => setPrefs({ defaultMetric: value as MetricKey })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {METRICS.map((metric) => (
                              <SelectItem key={metric} value={metric}>
                                {METRIC_LABELS[metric]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Default chart type</Label>
                        <Select
                          value={prefs.defaultChartType}
                          onValueChange={(value) =>
                            setPrefs({ defaultChartType: value as "LINE" | "BAR" | "SCATTER" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["LINE", "BAR", "SCATTER"].map((type) => (
                              <SelectItem key={type} value={type}>
                                {titleCase(type)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </SectionCard>
                  </div>

                  <SectionCard
                    id="chart-display"
                    icon={Table2}
                    title="Charts and tables"
                    description="How results are drawn once a chart is open."
                    bodyClassName="grid gap-3 p-4 sm:grid-cols-2"
                  >
                    <ToggleRow
                      id="s-trendlines"
                      label="Show trendlines"
                      checked={prefs.showTrendlines}
                      onChange={(checked) => setPrefs({ showTrendlines: checked })}
                    />
                    <ToggleRow
                      id="s-dense"
                      label="Dense tables"
                      checked={prefs.denseTables}
                      onChange={(checked) => setPrefs({ denseTables: checked })}
                    />
                  </SectionCard>
                </TabsContent>

                <TabsContent value="notifications" className="space-y-5">
                  <SectionCard
                    id="notification-types"
                    icon={Bell}
                    title="What reaches you"
                    description="Each of these can be delivered by any of the channels below."
                    bodyClassName="space-y-2 p-4"
                  >
                    {(
                      [
                        ["trainingReminders", "Training reminders"],
                        ["sessionCompletion", "Session processing complete"],
                        ["weeklyDigest", "Weekly performance digest"],
                        ["missedSession", "Missed session alerts"],
                      ] as const
                    ).map(([key, label]) => (
                      <ToggleRow
                        key={key}
                        id={`n-${key}`}
                        label={label}
                        checked={prefs.notifications[key]}
                        onChange={(checked) =>
                          setPrefs({ notifications: { ...prefs.notifications, [key]: checked } })
                        }
                      />
                    ))}
                  </SectionCard>
                  <NotificationDelivery />
                </TabsContent>

                <TabsContent value="subscription" className="space-y-5">
                  <SectionCard
                    id="usage"
                    icon={Gauge}
                    title="Usage this month"
                    description="Resets on the first of the month."
                    bodyClassName="space-y-4 p-4"
                  >
                    <UsageMeter
                      label="Videos processed"
                      value={profile.usage.videosProcessed}
                      limit={profile.usage.videoLimit}
                      unit=""
                    />
                    <UsageMeter
                      label="Storage"
                      value={profile.usage.storageUsedGb}
                      limit={profile.usage.storageLimitGb}
                      unit=" GB"
                    />
                    <UsageMeter
                      label="Live training minutes"
                      value={profile.usage.liveMinutesUsed}
                      limit={profile.usage.liveMinutesLimit}
                      unit=" min"
                    />
                  </SectionCard>

                  <div className="grid gap-4 lg:grid-cols-3">
                    {TIERS.map((plan) => (
                      <PlanCard
                        key={plan.tier}
                        tier={plan.tier}
                        price={plan.price}
                        features={plan.features}
                        current={plan.tier === profile.tier}
                        disabled={save.isPending}
                        onSelect={() => save.mutate({ tier: plan.tier })}
                      />
                    ))}
                  </div>
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </PageContainer>
    </AppShell>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      className="toggle-row flex items-center justify-between gap-4 px-3 py-2.5"
      data-on={checked}
    >
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
