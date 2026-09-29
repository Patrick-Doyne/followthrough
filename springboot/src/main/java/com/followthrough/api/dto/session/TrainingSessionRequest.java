package com.followthrough.api.dto.session;

import com.followthrough.api.domain.TrainingType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.time.Instant;

/** Covers only the fields a person would actually edit by hand -- shot
 * counts, makes, and the averages are pipeline-computed (either from live
 * telemetry or offline video processing), never hand-entered, so they
 * aren't part of this request. A newly created session starts at zero on
 * all of them with status QUEUED until something populates real numbers. */
public record TrainingSessionRequest(
        @NotBlank String name,
        @NotNull Instant date,
        @PositiveOrZero int durationMinutes,
        @NotBlank String location,
        @NotNull TrainingType trainingType) {
}
