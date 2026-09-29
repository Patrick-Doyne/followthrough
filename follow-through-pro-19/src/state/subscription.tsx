/**
 * Subscription / entitlement layer.
 * Tier comes from the backend user profile; the frontend only renders the
 * restriction. Real enforcement happens server-side.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { userQuery } from "@/services/queries";
import { cn } from "@/lib/utils";
import type { SubscriptionTier } from "@/types/telemetry";

export type FeatureKey =
  | "advancedTelemetry"
  | "realtimeAnalytics"
  | "comparisonMode"
  | "distributionAnalytics"
  | "extendedVideo";

export const FEATURE_REQUIREMENTS: Record<
  FeatureKey,
  { tier: SubscriptionTier; label: string; description: string }
> = {
  advancedTelemetry: {
    tier: "PREMIUM",
    label: "Advanced telemetry",
    description: "Per-shot breakdowns and deeper session analysis.",
  },
  realtimeAnalytics: {
    tier: "PREMIUM",
    label: "Real-time analytics",
    description: "Live WebSocket telemetry during an active training session.",
  },
  comparisonMode: {
    tier: "BASIC",
    label: "Session comparison",
    description: "Overlay a second session on any analytics chart.",
  },
  distributionAnalytics: {
    tier: "BASIC",
    label: "Distribution analytics",
    description: "Histograms, spread and shooting percentage by distance.",
  },
  extendedVideo: {
    tier: "BASIC",
    label: "Extended video",
    description: "Upload and process sessions longer than 10 minutes.",
  },
};

const RANK: Record<SubscriptionTier, number> = { FREE: 0, BASIC: 1, PREMIUM: 2 };

export function useEntitlements() {
  const { data: user, isPending } = useQuery(userQuery());
  const tier: SubscriptionTier = user?.tier ?? "FREE";
  return {
    tier,
    isPending,
    has: (feature: FeatureKey) => RANK[tier] >= RANK[FEATURE_REQUIREMENTS[feature].tier],
  };
}

export function UpgradePrompt({
  feature,
  className,
  compact = false,
}: {
  feature: FeatureKey;
  className?: string | undefined;
  compact?: boolean;
}) {
  const requirement = FEATURE_REQUIREMENTS[feature];
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5",
        className,
      )}
    >
      <Lock className="size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">
          {requirement.label} · {requirement.tier} plan
        </p>
        {!compact ? (
          <p className="text-xs text-muted-foreground">{requirement.description}</p>
        ) : null}
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link to="/settings" search={{ tab: "subscription" }}>
          <Sparkles className="size-3.5" aria-hidden />
          Upgrade
        </Link>
      </Button>
    </div>
  );
}

/** Renders children when entitled, otherwise a non-intrusive upgrade prompt. */
export function FeatureGate({
  feature,
  children,
  fallback,
  className,
}: {
  feature: FeatureKey;
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
}) {
  const { has } = useEntitlements();
  if (has(feature)) return <>{children}</>;
  return <>{fallback ?? <UpgradePrompt feature={feature} className={className} />}</>;
}
