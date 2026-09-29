package com.followthrough.api.dto.video;

import com.followthrough.api.domain.ProcessingStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.time.Instant;

/**
 * What the frontend POSTs to /sessions/{sessionId}/videos once it has
 * uploaded a finished live-session recording directly from the browser
 * (the recording is captured client-side from the live canvas, so the
 * frontend -- not the C++ backend, which only ever sees the camera frames
 * -- is the only place it can come from). The shot stats are the ones the
 * live pipeline already reported, so nothing is re-processed. status
 * defaults to COMPLETE when omitted, since a video being ingested at all
 * implies its processing already finished.
 */
public record VideoIngestRequest(
        @NotBlank String title,
        @NotNull Instant date,
        @PositiveOrZero int durationSeconds,
        @NotBlank String storageKey,
        @PositiveOrZero int analyzedShots,
        double shootingPercentage,
        String thumbnailUrl,
        @PositiveOrZero double sizeMb,
        ProcessingStatus status) {
}
