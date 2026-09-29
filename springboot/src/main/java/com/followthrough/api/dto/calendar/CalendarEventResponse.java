package com.followthrough.api.dto.calendar;

import com.followthrough.api.domain.CalendarEventStatus;
import com.followthrough.api.domain.TrainingType;
import java.time.LocalDate;
import java.time.LocalTime;

public record CalendarEventResponse(
        String eventId,
        String title,
        LocalDate date,
        LocalTime startTime,
        LocalTime endTime,
        String location,
        String notes,
        TrainingType trainingType,
        String goals,
        CalendarEventStatus status,
        String sessionId) {
}
