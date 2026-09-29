import { Link } from "@tanstack/react-router";
import { Film, LayoutGrid, List, Loader2, Play, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/common/ResultBadge";
import { EmptyState } from "@/components/common/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtClock, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProcessingStatus, VideoAsset } from "@/types/telemetry";

type SortKey = "DATE_DESC" | "DATE_ASC" | "PERCENT_DESC" | "SHOTS_DESC" | "DURATION_DESC";

export type GalleryView = "grid" | "list";

/**
 * Grid / list.
 *
 * <p>Separate from the gallery so the page can put it on the band with
 * the other page-level controls, and wearing the same rail the
 * settings tabs and the calendar's view switcher wear -- two outlined
 * icon buttons read as two buttons, not as one control with one
 * answer.
 */
export function GalleryViewSwitch({
  view,
  onViewChange,
}: {
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={view}
      onValueChange={(v) => v && onViewChange(v as GalleryView)}
      className="hero-rail h-9 w-auto justify-start gap-0 overflow-hidden rounded-md"
    >
      {(
        [
          ["grid", LayoutGrid, "Grid view"],
          ["list", List, "List view"],
        ] as const
      ).map(([value, Icon, label]) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          className={cn(
            "h-9 shrink-0 rounded-none px-3 transition-colors",
            "text-[var(--hero-muted)] hover:text-[var(--hero-fg)]",
            "data-[state=on]:bg-[var(--sec)] data-[state=on]:text-[var(--sec-on)]",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Thumbnail({ video, className }: { video: VideoAsset; className?: string }) {
  const isReady = video.status === "COMPLETE";
  const hasThumbnail = isReady && video.thumbnailUrl;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-sm border border-border bg-[oklch(0.14_0.008_250)] ${className ?? ""}`}
    >
      {hasThumbnail ? (
        <img src={video.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "repeating-linear-gradient(115deg, oklch(0.24 0.01 250) 0 2px, transparent 2px 22px)",
          }}
          aria-hidden
        />
      )}
      {isReady ? (
        <Play
          className="relative size-7 text-muted-foreground drop-shadow-[0_1px_3px_oklch(0_0_0_/_0.6)]"
          aria-hidden
        />
      ) : (
        <Loader2 className="relative size-7 animate-spin text-muted-foreground" aria-hidden />
      )}
      <span className="metric-value absolute right-1.5 bottom-1.5 rounded-sm bg-background/85 px-1.5 py-0.5 text-[0.6875rem]">
        {fmtClock(video.durationSeconds)}
      </span>
    </div>
  );
}

/** Not watchable until the offline-processing pipeline (see
 * CppVideoProcessor) has actually replaced the stored file with the
 * composited, overlay-meshed version -- before that it's either the raw
 * upload (black screen, since the overlay hasn't been drawn yet) or
 * doesn't exist as a playable file at all. */
function isWatchable(video: VideoAsset) {
  return video.status === "COMPLETE";
}

function CardStats({ video }: { video: VideoAsset }) {
  if (!isWatchable(video)) {
    return (
      <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
        {video.status === "FAILED" ? "Processing failed." : "Processing — check back soon."}
      </p>
    );
  }
  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-2 text-xs">
      <div>
        <dt className="text-muted-foreground">Analyzed shots</dt>
        <dd className="metric-value">{video.analyzedShots}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">FG%</dt>
        <dd className="metric-value">{video.shootingPercentage.toFixed(1)}%</dd>
      </div>
    </dl>
  );
}

export function VideoGallery({
  videos,
  view,
  onDelete,
}: {
  videos: VideoAsset[];
  view: GalleryView;
  /** Omitted, no recording offers a delete. */
  onDelete?: ((video: VideoAsset) => void) | undefined;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | ProcessingStatus>("ALL");
  const [sort, setSort] = useState<SortKey>("DATE_DESC");

  const filtered = useMemo(() => {
    const items = videos.filter((v) => {
      if (status !== "ALL" && v.status !== status) return false;
      if (query && !v.title.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    const sorters: Record<SortKey, (a: VideoAsset, b: VideoAsset) => number> = {
      DATE_DESC: (a, b) => +new Date(b.date) - +new Date(a.date),
      DATE_ASC: (a, b) => +new Date(a.date) - +new Date(b.date),
      PERCENT_DESC: (a, b) => b.shootingPercentage - a.shootingPercentage,
      SHOTS_DESC: (a, b) => b.analyzedShots - a.analyzedShots,
      DURATION_DESC: (a, b) => b.durationSeconds - a.durationSeconds,
    };
    return [...items].sort(sorters[sort]);
  }, [videos, query, status, sort]);

  return (
    <div>
      {/* The collection's own toolbar, ruled off from the results the
          way a table's is -- these filter what is below them, so they
          belong to the card rather than to the page band. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/40 px-3 py-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions"
            aria-label="Search videos"
            className="pl-8"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-[160px]" aria-label="Filter by processing status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="COMPLETE">Complete</SelectItem>
            <SelectItem value="PROCESSING">Processing</SelectItem>
            <SelectItem value="QUEUED">Queued</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-[180px]" aria-label="Sort videos">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DATE_DESC">Newest first</SelectItem>
            <SelectItem value="DATE_ASC">Oldest first</SelectItem>
            <SelectItem value="PERCENT_DESC">Highest FG%</SelectItem>
            <SelectItem value="SHOTS_DESC">Most shots</SelectItem>
            <SelectItem value="DURATION_DESC">Longest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="p-3">
          <EmptyState
            title="Nothing matches"
            message="Try a different search, or clear the status filter."
            icon={<Film className="size-5" />}
          />
        </div>
      ) : view === "grid" ? (
        <ul className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((video) => {
            const cardBody = (
              <>
                <Thumbnail video={video} className="aspect-video w-full" />
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {/* Two lines rather than one: a tile is about
                        300px wide and these titles run to five words,
                        so truncating at one line rendered most of
                        them as "Morning Shootaro...". */}
                    <p className="line-clamp-2 text-sm font-medium">{video.title}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(video.date)}</p>
                  </div>
                  <StatusBadge status={video.status} />
                </div>
                <CardStats video={video} />
              </>
            );
            return (
              <li
                key={video.videoId}
                className="group glow relative overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary/40"
              >
                {onDelete ? <DeleteButton video={video} onDelete={onDelete} /> : null}
                {isWatchable(video) ? (
                  <Link
                    to="/videos/$videoId"
                    params={{ videoId: video.videoId }}
                    search={{ t: 0 }}
                    className="block p-3 transition-colors hover:bg-accent/30"
                  >
                    {cardBody}
                  </Link>
                ) : (
                  <div className="block cursor-not-allowed p-3 opacity-75" aria-disabled="true">
                    {cardBody}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((video) => {
            const rowBody = (
              <>
                <Thumbnail video={video} className="h-14 w-24 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{video.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(video.date)} · {fmtClock(video.durationSeconds)}
                    {isWatchable(video)
                      ? ` · ${video.analyzedShots} shots · ${video.shootingPercentage.toFixed(1)}% FG`
                      : ` · ${video.status === "FAILED" ? "Processing failed" : "Processing — check back soon"}`}
                  </p>
                </div>
                <StatusBadge status={video.status} />
              </>
            );
            return (
              <li key={video.videoId} className="group relative">
                {isWatchable(video) ? (
                  <Link
                    to="/videos/$videoId"
                    params={{ videoId: video.videoId }}
                    search={{ t: 0 }}
                    className="flex items-center gap-3 p-3 pr-14 transition-colors hover:bg-accent/30"
                  >
                    {rowBody}
                    <Button variant="ghost" size="sm" tabIndex={-1}>
                      Open
                    </Button>
                  </Link>
                ) : (
                  <div
                    className="flex cursor-not-allowed items-center gap-3 p-3 pr-14 opacity-75"
                    aria-disabled="true"
                  >
                    {rowBody}
                  </div>
                )}
                {onDelete ? <DeleteButton video={video} onDelete={onDelete} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The delete on a gallery item, and the confirmation in front of it.
 *
 * <p>A sibling of the card's link rather than a child of it: a button
 * inside an anchor is invalid, and a click on it would delete the
 * recording *and* navigate to the page of the recording it had just
 * deleted.
 *
 * <p>Hidden until the item is hovered or something inside it has focus,
 * so a wall of tiles is not a wall of delete buttons -- but never hidden
 * from the keyboard, which is why it is `opacity-0` rather than absent
 * and gets its own focus-visible reveal.
 */
function DeleteButton({
  video,
  onDelete,
}: {
  video: VideoAsset;
  onDelete: (video: VideoAsset) => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Delete ${video.title}`}
          className={cn(
            "absolute top-2 right-2 z-10 grid size-9 place-items-center rounded-sm",
            "bg-surface/90 text-muted-foreground",
            "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
            "hover:text-miss focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            // A touch device has no hover to reveal it with.
            "[@media(hover:none)]:opacity-100",
          )}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{video.title}”?</AlertDialogTitle>
          {/* Names what goes, rather than saying "this cannot be undone"
              and leaving the reader to guess how much "this" covers. The
              shots are the part people do not expect: they are what every
              chart is drawn from. */}
          <AlertDialogDescription>
            This permanently deletes the recording, its thumbnail and all {video.analyzedShots}{" "}
            shots measured from it. Your analytics will no longer include them. It cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onDelete(video)}
            className="bg-miss text-miss-foreground hover:bg-miss/90"
          >
            Delete permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
