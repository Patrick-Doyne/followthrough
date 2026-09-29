/**
 * Records the video and its overlay together, to a file the viewer keeps.
 *
 * <p>The counterpart to not burning the overlay in: the recording stays
 * clean on the server, and anyone who wants a copy with the analysis on it
 * composites one here, at the theme and the artwork current at the moment
 * they ask.
 *
 * <p>It records in real time by necessity -- MediaRecorder reads a live
 * canvas -- so a ten-minute clip takes ten minutes. The caller is expected
 * to say so rather than leave a silent progress bar.
 */

export interface ExportHandle {
  /** Stops early and resolves with whatever was captured. */
  stop: () => void;
  /** The finished file. */
  done: Promise<Blob>;
}

/** The first container the browser will actually give us. */
export function pickMimeType(candidates: string[] = MIME_CANDIDATES): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function extensionFor(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/**
 * Composites `video` and `overlay` into one stream and records it.
 *
 * <p>Drawn into a canvas of its own rather than recording the overlay
 * canvas directly: that one is transparent, and a recording of it would be
 * the analysis on a black field with no footage behind it.
 */
export function exportWithOverlay({
  video,
  overlay,
  // The overlay canvas already carries the source's aspect ratio, so
  // taking the size from it is what keeps a portrait clip portrait. The
  // authored 16:9 default this used to have squashed one on download even
  // when it played back correctly.
  width = overlay.width,
  height = overlay.height,
  fps = 30,
  mimeType,
}: {
  video: HTMLVideoElement;
  overlay: HTMLCanvasElement;
  width?: number;
  height?: number;
  fps?: number;
  mimeType: string;
}): ExportHandle {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot composite the overlay for download.");

  const stream = canvas.captureStream(fps);
  // Keep the audio, which is half of what makes a clip worth keeping.
  const audio = (video as HTMLVideoElement & { captureStream?: () => MediaStream })
    .captureStream?.()
    .getAudioTracks();
  for (const track of audio ?? []) stream.addTrack(track);

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  let raf = 0;
  const draw = () => {
    raf = requestAnimationFrame(draw);
    // The video first, then the analysis over it.
    context.drawImage(video, 0, 0, width, height);
    context.drawImage(overlay, 0, 0, width, height);
  };
  draw();

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      cancelAnimationFrame(raf);
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  recorder.start();
  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
    },
    done,
  };
}

/** Hands a finished blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on the next tick: revoking immediately races the download in
  // some browsers and produces an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
