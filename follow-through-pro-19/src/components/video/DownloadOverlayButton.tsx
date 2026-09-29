import { Download, Loader2, Square } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/format";
import {
  exportWithOverlay,
  extensionFor,
  pickMimeType,
  saveBlob,
  type ExportHandle,
} from "@/lib/overlay-export";
import { useNotify } from "@/state/notifications";

/**
 * Saves a copy of the clip with the analysis drawn on it.
 *
 * <p>The recording on the server stays clean -- the overlay is never
 * written into it -- so anyone who wants a copy with the overlay makes one
 * here, in the theme and the artwork current at the moment they ask.
 *
 * <p>Recording is real time -- MediaRecorder reads a live canvas, so a ten
 * minute clip takes ten minutes. That is stated up front and the button
 * turns into a stop, rather than leaving someone watching a spinner with
 * no idea what it is waiting for.
 */
export function DownloadOverlayButton({
  video,
  overlay,
  title,
  durationSeconds,
  className,
}: {
  video: HTMLVideoElement | null;
  overlay: HTMLCanvasElement | null;
  title: string;
  durationSeconds: number;
  className?: string;
}) {
  const notify = useNotify();
  const [recording, setRecording] = useState(false);
  const handle = useRef<ExportHandle | null>(null);

  const mimeType = pickMimeType();
  // Hidden rather than shown broken: without MediaRecorder there is no
  // way to produce the file at all.
  if (!mimeType || !video || !overlay) return null;

  const start = () => {
    try {
      video.currentTime = 0;
      void video.play();
      const started = exportWithOverlay({ video, overlay, mimeType });
      handle.current = started;
      setRecording(true);

      const finish = () => {
        started.stop();
        video.removeEventListener("ended", finish);
      };
      video.addEventListener("ended", finish);

      void started.done.then((blob) => {
        setRecording(false);
        handle.current = null;
        video.removeEventListener("ended", finish);
        const safe = title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "clip";
        saveBlob(blob, `${safe}-with-overlay.${extensionFor(mimeType)}`);
        notify("Download ready", { body: `${safe} saved with the overlay drawn on.` });
      });
    } catch (error) {
      setRecording(false);
      notify("Could not record the overlay", {
        body: error instanceof Error ? error.message : "This browser refused the capture.",
      });
    }
  };

  return (
    <Button
      variant="outline"
      className={cn("gap-1.5", className)}
      onClick={() => (recording ? handle.current?.stop() : start())}
      title={
        recording
          ? "Stop and save what has been recorded so far"
          : `Plays the clip through once while recording — about ${fmtClock(durationSeconds)}`
      }
    >
      {recording ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <Square className="size-3 fill-current" aria-hidden />
          Stop and save
        </>
      ) : (
        <>
          <Download className="size-3.5" aria-hidden />
          Download with overlay
        </>
      )}
    </Button>
  );
}
