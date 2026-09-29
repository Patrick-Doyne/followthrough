package com.followthrough.api.service;

import java.io.File;
import java.util.List;
import tools.jackson.databind.JsonNode;

/**
 * Runs offline shot-detection analysis against an uploaded video file and
 * returns the telemetry it produced, plus a thumbnail and (when needed) a
 * browser-playable copy. The uploaded file itself is never modified.
 * StubVideoProcessor is the local-dev/test stand-in (no GPU/C++ toolchain
 * needed); CppVideoProcessor is the real implementation, shelling out to
 * the follow_through_batch_gpu binary (cpp/follow-through-batch.cpp) for
 * detection and to follow-through-pro-19/scripts/prepare-playback.ts for
 * the thumbnail and playback copy.
 */
public interface VideoProcessor {

    ProcessingOutcome process(File videoFile);

    /** telemetry is the full ordered frame/shot_event stream (see
     * cpp/follow-through-webrtc.cpp's schema) for persistence -- see
     * TelemetryStore. fps is needed to make sense of a message's
     * frame_id later (e.g. converting it to a time offset). thumbnailFile
     * is the first-shot-apex frame (or the video's own first frame as a
     * fallback -- see prepare-playback.ts), null if a real implementation
     * doesn't produce one (StubVideoProcessor never does).
     *
     * <p>Note what is absent: the processed video. Processing does not
     * modify the uploaded recording at all. The overlay is drawn over it
     * at playback from {@code telemetry}. */
    record ProcessingOutcome(
            ProcessingResult result,
            double fps,
            List<JsonNode> telemetry,
            File thumbnailFile,
            /**
             * A browser-playable copy of the recording, or null when the
             * upload is already playable. Written beside the upload, never
             * over it.
             */
            File playbackFile) {
    }

    /** durationSeconds is deliberately not part of this -- the browser
     * already knows a file's real duration the moment it's picked (see
     * VideoProcessingRequest), so processing's job is finding shots in a
     * video of already-known length, not guessing the length itself. */
    record ProcessingResult(
            int analyzedShots,
            double shootingPercentage,
            double avgShotDistance,
            double avgShotDuration,
            double avgTimeToApex) {
    }
}
