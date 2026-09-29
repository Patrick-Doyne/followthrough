/**
 * Post-detection preparation for an uploaded video. Invoked by the Spring
 * Boot backend (see CppVideoProcessor.java) as:
 *
 *   npx tsx scripts/prepare-playback.ts <input video> <telemetry jsonl> \
 *       <thumbnail output path> <playback output path>
 *
 * <p>It produces two things beside the recording and **never modifies the
 * recording itself**:
 *
 * <p>1. **The gallery thumbnail** -- one frame seeked out of the source at
 * the first shot's apex. Just the footage: the analysis is not drawn on
 * it. A tile is a still, so an overlay baked into it could never follow
 * the theme the way the player's does, and an orange HUD on a violet
 * theme is worse than no HUD at all.
 *
 * <p>2. **A playback rendition, only when the browser could not play the
 * upload.** Phones shoot HEVC, and no Chromium-based browser will decode
 * it: `canPlayType('video/mp4; codecs="hvc1"')` returns empty and the
 * element reports `videoWidth === 0`, which draws as a black rectangle
 * with the overlay still painting correctly over it. Until this existed
 * the pipeline hid that by accident -- it re-encoded every upload to burn
 * the overlay in, and H.264 fell out of that. Removing the burn removed
 * the accidental transcode with it.
 *
 * <p>So the transcode is now explicit, deliberate and conditional: it runs
 * only for a source the browser cannot play, and it writes a **separate**
 * file. The upload stays exactly as it arrived, which is the rule.
 */
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

import {
  needsPlaybackRendition,
  playbackSize,
  type SourceFormat,
} from "../src/lib/playback-format.ts";
import type { OverlayTelemetryMessage } from "../src/types/overlay-telemetry.ts";

interface TelemetryMetadata {
  fps: number;
  frameWidth: number;
  frameHeight: number;
}

const TELEMETRY_POLL_MS = 20;
/** How long to wait on a silent telemetry file before giving up. Detection
 * emits roughly 90 lines a second, so a gap this long means it has died
 * rather than paused; the marker below is the normal way the stream ends. */
const TELEMETRY_STALL_MS = 30_000;
const EOS_TYPE = "eos";

/**
 * Reads the telemetry JSONL while detection is still appending to it.
 *
 * <p>The thumbnail frame is chosen from the telemetry (the first shot's
 * apex), so this script needs the stream -- but only up to that point.
 * Tailing the file as detection writes it lets the thumbnail come out, and
 * the playback transcode start, as soon as the first apex appears, instead
 * of after detection has finished the entire video; the backend starts the
 * two processes together (see CppVideoProcessor.java).
 *
 * <p>Completion is signalled by an explicit `{"type":"eos"}` line rather
 * than by end-of-file, because while the producer is alive EOF just means
 * "nothing written yet". A file that goes silent without that marker is
 * treated as a failure, not as a finished stream, so a detector that dies
 * mid-video can never be mistaken for one that finished early -- that would
 * silently produce a video with the overlay missing from that point on.
 */
class TelemetryTail {
  private handle: fsp.FileHandle | null = null;
  private offset = 0;
  private partial = "";
  private readonly queued: OverlayTelemetryMessage[] = [];
  private metadata: TelemetryMetadata | null = null;
  private ended = false;
  private lastProgressAt = Date.now();

  constructor(private readonly path: string) {}

  private async pump(): Promise<boolean> {
    if (!this.handle) this.handle = await fsp.open(this.path, "r");
    const { size } = await this.handle.stat();
    if (size <= this.offset) return false;

    const length = size - this.offset;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await this.handle.read(buffer, 0, length, this.offset);
    this.offset += bytesRead;

    this.partial += buffer.subarray(0, bytesRead).toString("utf-8");
    const lines = this.partial.split("\n");
    // A flush can land mid-line; hold the remainder until the rest arrives.
    this.partial = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed["type"] === EOS_TYPE) {
        this.ended = true;
        continue;
      }
      if (parsed["type"] === "metadata") {
        this.metadata = {
          fps: Number(parsed["fps"]) || 30,
          frameWidth: Number(parsed["frame_width"]) || 0,
          frameHeight: Number(parsed["frame_height"]) || 0,
        };
        continue;
      }
      this.queued.push(parsed as unknown as OverlayTelemetryMessage);
    }

    this.lastProgressAt = Date.now();
    return true;
  }

  private async waitForMore(): Promise<void> {
    if (Date.now() - this.lastProgressAt > TELEMETRY_STALL_MS) {
      throw new Error(
        `Telemetry stalled for ${TELEMETRY_STALL_MS}ms with no end-of-stream marker -- detection likely failed`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, TELEMETRY_POLL_MS));
  }

  /** Blocks until the metadata header has been written. */
  async waitForMetadata(): Promise<TelemetryMetadata> {
    while (!this.metadata) {
      const advanced = await this.pump();
      if (this.metadata) break;
      if (this.ended) return { fps: 30, frameWidth: 0, frameHeight: 0 };
      if (!advanced) await this.waitForMore();
    }
    return this.metadata;
  }

  /** True once message `index` is available; false if the stream ended
   * first. Blocks while detection is still catching up. */
  async has(index: number): Promise<boolean> {
    while (index >= this.queued.length) {
      if (this.ended) {
        await this.pump();
        return index < this.queued.length;
      }
      const advanced = await this.pump();
      if (!advanced && index >= this.queued.length) await this.waitForMore();
    }
    return true;
  }

  at(index: number): OverlayTelemetryMessage {
    return this.queued[index]!;
  }

  get count(): number {
    return this.queued.length;
  }

  async close(): Promise<void> {
    await this.handle?.close();
    this.handle = null;
  }
}

function probeSource(videoPath: string): Promise<SourceFormat> {
  return new Promise((resolve, reject) => {
    const probe = spawn((ffprobeStatic as { path: string }).path, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height",
      "-of",
      "json",
      videoPath,
    ]);
    let out = "";
    let err = "";
    probe.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    probe.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    probe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}:\n${err}`));
        return;
      }
      let parsed: { streams?: Record<string, unknown>[] };
      try {
        parsed = JSON.parse(out) as { streams?: Record<string, unknown>[] };
      } catch {
        reject(new Error(`Could not parse ffprobe output: "${out}"`));
        return;
      }
      const streams = parsed.streams ?? [];
      const video = streams.find((s) => s["codec_type"] === "video");
      const audio = streams.find((s) => s["codec_type"] === "audio");
      if (!video) {
        reject(new Error("The upload carries no video stream."));
        return;
      }
      resolve({
        width: Number(video["width"]) || 0,
        height: Number(video["height"]) || 0,
        videoCodec: String(video["codec_name"] ?? ""),
        audioCodec: audio ? String(audio["codec_name"] ?? "") : null,
      });
    });
    probe.on("error", reject);
  });
}

function run(step: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath as unknown as string, args);
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${step} failed (${code}):\n${err}`)),
    );
    child.on("error", reject);
  });
}

/** The gallery tile: one frame seeked out of the source. One seek and one
 * decoded frame, so it costs the same whether the clip is thirty seconds
 * or an hour. */
function extractThumbnail(videoPath: string, outputPath: string, atSeconds: number): Promise<void> {
  return run("thumbnail extraction", [
    "-y",
    "-ss",
    atSeconds.toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outputPath,
  ]);
}

/** A copy the browser can decode, written beside the original. */
function transcodeForPlayback(
  videoPath: string,
  outputPath: string,
  source: SourceFormat,
): Promise<void> {
  const size = playbackSize(source.width, source.height);
  return run("playback transcode", [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `scale=${size.width}:${size.height}`,
    "-c:v",
    "libx264",
    // High profile + yuv420p is the combination every browser decodes,
    // including in hardware. veryfast/crf23 is the speed/quality trade
    // settled on after measuring against SSIM.
    "-profile:v",
    "high",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    // Moves the index to the front so the player can start before the
    // whole file has arrived, which matters for a large upload.
    "-movflags",
    "+faststart",
    ...(source.audioCodec ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    outputPath,
  ]);
}

async function main() {
  const [, , inputVideoPath, telemetryPath, thumbnailOutputPath, playbackOutputPath] = process.argv;
  if (!inputVideoPath || !telemetryPath || !thumbnailOutputPath || !playbackOutputPath) {
    console.error(
      "Usage: prepare-playback.ts <input video> <telemetry jsonl> <thumbnail output path> <playback output path>",
    );
    process.exit(1);
  }

  // Starts consuming while detection is still writing -- see TelemetryTail.
  const telemetry = new TelemetryTail(telemetryPath);
  const metadata = await telemetry.waitForMetadata();

  /*
   * The tile shows the first frame at which a shot reaches its apex: the
   * top of the arc is the one moment in a recording that reliably has the
   * ball in open air and the player still in frame. Falling back to the
   * first frame rather than to nothing, so a clip the detector found no
   * shots in still gets a tile.
   */
  let thumbnailFrameId: number | null = null;
  for (let i = 0; await telemetry.has(i); i += 1) {
    const message = telemetry.at(i) as OverlayTelemetryMessage & {
      frame_id: number;
      apex_point?: unknown;
    };
    if (message.type !== "frame") continue;
    if (thumbnailFrameId === null) thumbnailFrameId = message.frame_id;
    if (message.apex_point != null) {
      thumbnailFrameId = message.frame_id;
      break;
    }
  }
  await telemetry.close();
  if (thumbnailFrameId === null) {
    console.error("Telemetry described zero frames -- detection produced nothing.");
    process.exit(1);
  }

  const source = await probeSource(inputVideoPath);
  await extractThumbnail(inputVideoPath, thumbnailOutputPath, thumbnailFrameId / metadata.fps);

  if (!needsPlaybackRendition(source)) {
    // Nothing is written to playbackOutputPath, and the backend reads that
    // absence as "serve the upload itself".
    console.log(
      `Thumbnail at frame ${thumbnailFrameId}. Source is ${source.videoCodec}` +
        `${source.audioCodec ? `/${source.audioCodec}` : ""}, which plays as uploaded ` +
        `-- no playback copy made. Recording left untouched.`,
    );
    process.exit(0);
  }

  const size = playbackSize(source.width, source.height);
  await transcodeForPlayback(inputVideoPath, playbackOutputPath, source);
  const { size: bytes } = await fsp.stat(playbackOutputPath);
  console.log(
    `Thumbnail at frame ${thumbnailFrameId}. Source is ${source.videoCodec}` +
      `${source.audioCodec ? `/${source.audioCodec}` : ""} at ${source.width}x${source.height}, ` +
      `which no browser will decode -- wrote a ${size.width}x${size.height} H.264 playback copy ` +
      `(${(bytes / 1_000_000).toFixed(1)} MB). Recording left untouched.`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("prepare-playback failed:", error);
  process.exit(1);
});
