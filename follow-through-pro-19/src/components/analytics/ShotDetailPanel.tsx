import { Link } from "@tanstack/react-router";
import { Film } from "lucide-react";

import { ResultBadge } from "@/components/common/ResultBadge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fmtDateTime,
  fmtDistanceOrUnknown,
  fmtSecondsOrUnknown,
  fmtShotType,
  titleCase,
} from "@/lib/format";
import type { Shot } from "@/types/telemetry";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="metric-value text-sm">{value}</dd>
    </div>
  );
}

/** Shot detail panel opened from any chart selection. */
export function ShotDetailPanel({
  shot,
  open,
  onOpenChange,
  onOpenVideo,
}: {
  shot: Shot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Takes the player to this shot, for a page that already has one.
   *
   * <p>Given this, the button drives the player in place instead of
   * navigating. It is also the *only* thing that moves the video:
   * selecting a shot on a chart opens this panel and nothing else,
   * because a click meant to inspect a shot should not also reposition
   * what you were watching.
   */
  onOpenVideo?: ((shot: Shot) => void) | undefined;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {shot ? (
          <>
            <SheetHeader className="gap-2">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-base">Shot #{shot.shotNumber}</SheetTitle>
                <ResultBadge result={shot.result} />
              </div>
              <SheetDescription>
                {fmtDateTime(shot.timestamp)} · {fmtShotType(shot.shotType)}
                {shot.zone ? ` · ${titleCase(shot.zone)}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <dl>
                <Row label="Shot type" value={fmtShotType(shot.shotType)} />
                <Row label="Shot distance" value={fmtDistanceOrUnknown(shot.shotDistance)} />
                <Row label="Result" value={shot.result} />
                <Row label="Shot duration" value={fmtSecondsOrUnknown(shot.shotDuration)} />
                <Row label="Time to apex" value={fmtSecondsOrUnknown(shot.timeToApex)} />
                {/* No raw court coordinates: the chart shows where
                    the shot was taken from far better than a pair of
                    numbers does, and nobody reviewing a session needs
                    the metres. */}
                <Row label="Shot ID" value={<span className="text-xs">{shot.shotId}</span>} />
                {Object.entries(shot.extra ?? {}).map(([key, value]) => (
                  <Row key={key} label={titleCase(key)} value={String(value)} />
                ))}
              </dl>

              {onOpenVideo ? (
                <Button variant="outline" className="w-full" onClick={() => onOpenVideo(shot)}>
                  <Film className="size-4" aria-hidden />
                  Open video at this shot
                </Button>
              ) : shot.videoId ? (
                <Button asChild variant="outline" className="w-full">
                  <Link
                    to="/videos/$videoId"
                    params={{ videoId: shot.videoId }}
                    search={{ t: shot.videoOffset ?? 0 }}
                  >
                    <Film className="size-4" aria-hidden />
                    Open video at this shot
                  </Link>
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
