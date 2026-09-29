package com.followthrough.api.dto.calendar;

import com.followthrough.api.domain.CalendarEventStatus;
import com.followthrough.api.domain.TrainingType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.time.LocalTime;

public record CalendarEventRequest(
        @NotBlank String title,
        @NotNull LocalDate date,
        @NotNull LocalTime startTime,
        @NotNull LocalTime endTime,
        @NotBlank String location,
        String notes,
        @NotNull TrainingType trainingType,
        String goals,
        CalendarEventStatus status,
        String sessionId) {
}
