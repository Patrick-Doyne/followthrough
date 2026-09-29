package com.followthrough.api.dto.video;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.time.Instant;

/**
 * What the frontend POSTs to /sessions/{sessionId}/videos/process once it
 * has PUT a pre-recorded file to the URL from POST /videos/upload-url.
 * Unlike VideoIngestRequest, no shot stats are supplied here -- offline
 * processing is what computes those -- but durationSeconds and sizeMb
 * aren't something processing needs to discover either: the browser reads
 * them straight off the file the moment it's picked, so there's no reason
 * to fake them until a StubVideoProcessor run finishes (or worse, ask the
 * user to guess a duration for a file they've already recorded).
 *
 * <p>durationSeconds/sizeMb are boxed (not primitive) so a request that
 * omits them fails Bean Validation with a normal 400 -- Jackson's record
 * deserialization rejects a missing primitive field outright (a 500)
 * before validation ever gets a chance to run.
 */
public record VideoProcessingRequest(
        @NotBlank String title,
        @NotNull Instant date,
        @NotBlank String storageKey,
        @NotNull @PositiveOrZero Integer durationSeconds,
        @NotNull @PositiveOrZero Double sizeMb) {
}
