import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { HeroDivider, PageHero } from "@/components/common/PageHero";
import { ErrorState, LoadingState } from "@/components/common/states";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import type { VideoAsset } from "@/types/telemetry";
import { FilmArt } from "@/components/video/FilmArt";
import {
  UploadVideoDialog,
  type UploadVideoFormValues,
} from "@/components/video/UploadVideoDialog";
import { GalleryViewSwitch, VideoGallery, type GalleryView } from "@/components/video/VideoGallery";
import { ApiError } from "@/services/http";
import { sessionsService, videosService } from "@/services/followthrough";
import { videosQuery } from "@/services/queries";

const PAGE_SIZE = 12;

export const Route = createFileRoute("/videos/")({
  head: () => ({
    meta: [
      { title: "Video Gallery — FollowThrough" },
      {
        name: "description",
        content:
          "Browse recorded basketball training videos with processing status, analyzed shots and shooting percentage.",
      },
      { property: "og:title", content: "Video Gallery — FollowThrough" },
      {
        property: "og:description",
        content: "Search, sort and review your recorded basketball training sessions.",
      },
    ],
  }),
  component: VideosRoute,
});

function describeUploadError(error: unknown): string {
  if (error instanceof ApiError && error.fieldErrors) {
    return Object.entries(error.fieldErrors)
      .map(([field, message]) => `${field}: ${message}`)
      .join(", ");
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

function VideosRoute() {
  const [page, setPage] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [view, setView] = useState<GalleryView>("grid");
  const qc = useQueryClient();

  const videos = useQuery({
    ...videosQuery(page, PAGE_SIZE),
    // Keeps polling while any video on this page is still being processed,
    // so a QUEUED/PROCESSING status flips to COMPLETE without a manual
    // refresh -- stops as soon as nothing on the page is in flight.
    refetchInterval: (query) => {
      const pending = query.state.data?.content.some(
        (v) => v.status === "QUEUED" || v.status === "PROCESSING",
      );
      return pending ? 1500 : false;
    },
  });

  /*
   * No optimistic update and no undo. Everything the recording produced
   * is gone server-side by the time this resolves -- the file, its
   * playback copy, its thumbnail and its telemetry -- so there would be
   * nothing to roll back to. The confirmation is the only safeguard, and
   * it is the right place for one.
   */
  const deleteVideo = useMutation({
    mutationFn: (video: VideoAsset) => videosService.remove(video.videoId),
    onSuccess: async (_result, video) => {
      toast.success(`Deleted “${video.title}”`);
      // The server recounts the session the recording belonged to, and the
      // charts derive their shots from the remaining videos' telemetry, so
      // everything that counted it has to refetch -- the gallery alone
      // going quiet would leave the rest counting a recording that no
      // longer exists.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["videos"] }),
        qc.invalidateQueries({ queryKey: ["sessions"] }),
        qc.invalidateQueries({ queryKey: ["session-videos"] }),
        qc.invalidateQueries({ queryKey: ["analytics-summary"] }),
      ]);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not delete that video.");
    },
  });

  const uploadVideo = useMutation({
    mutationFn: async (values: UploadVideoFormValues) => {
      // The file's own last-modified timestamp is a real fact about it
      // (when the recording was saved) -- a better default than asking the
      // uploader to recall or re-enter a date they may not remember.
      const date = new Date(values.file.lastModified).toISOString();
      const session = await sessionsService.create({
        name: values.title,
        date,
        durationMinutes: Math.max(1, Math.ceil(values.durationSeconds / 60)),
        location: values.location,
        trainingType: values.trainingType,
      });
      const upload = await videosService.getUploadUrl(
        session.sessionId,
        values.file.type || "video/mp4",
      );
      await videosService.uploadRecording(upload.uploadUrl, values.file);
      return sessionsService.processVideo(session.sessionId, {
        title: values.title,
        date,
        storageKey: upload.storageKey,
        durationSeconds: Math.round(values.durationSeconds),
        sizeMb: values.file.size / (1024 * 1024),
      });
    },
    onSuccess: () => {
      setUploadOpen(false);
      toast.success("Video uploaded — processing in the background.");
      void qc.invalidateQueries({ queryKey: ["videos"] });
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) =>
      toast.error("Couldn't upload the video", { description: describeUploadError(error) }),
  });

  return (
    <AppShell>
      {/* hideHeader: the band below is this page's header. */}
      <PageContainer title="Video Gallery" hideHeader>
        <PageHero
          art={<FilmArt />}
          eyebrow="Video gallery"
          title={
            videos.data
              ? `${videos.data.totalElements} ${videos.data.totalElements === 1 ? "video" : "videos"}`
              : "Videos"
          }
          meta={
            videos.data && videos.data.totalPages > 1 ? (
              <>
                <span>
                  Page {videos.data.page + 1} of {videos.data.totalPages}
                </span>
                <HeroDivider />
                <span>Recorded training sessions</span>
              </>
            ) : (
              <span>Recorded training sessions</span>
            )
          }
          toolbar={
            <>
              <GalleryViewSwitch view={view} onViewChange={setView} />
              <Button
                className="h-9 gap-1.5 px-3 text-xs shadow-none"
                onClick={() => setUploadOpen(true)}
              >
                <Upload className="size-3.5" aria-hidden />
                Upload video
              </Button>
            </>
          }
        />

        {videos.isPending ? (
          <LoadingState rows={4} label="Loading videos…" />
        ) : videos.isError ? (
          <ErrorState
            title="Your videos didn't load"
            message="Check your connection, then try again."
            onRetry={() => void videos.refetch()}
          />
        ) : (
          /* No header. The band above already says this is the video
             gallery and how many there are; a second title and count
             two lines later was saying it again. The accent top edge
             stays, so this is still a card in the same system -- one
             that happens to be all body. */
          <div className="sheet">
            <VideoGallery
              videos={videos.data.content}
              view={view}
              onDelete={(video) => deleteVideo.mutate(video)}
            />

            {videos.data.totalPages > 1 ? (
              <div className="flex items-center justify-between gap-2 border-t border-border bg-surface/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {videos.data.totalElements} videos in total
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={videos.data.first}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={videos.data.last}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </PageContainer>

      <UploadVideoDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSubmit={(values) => uploadVideo.mutate(values)}
        pending={uploadVideo.isPending}
      />
    </AppShell>
  );
}
