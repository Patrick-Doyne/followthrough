package com.followthrough.api.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.LocalTime;
import org.junit.jupiter.api.Test;

/** Scoped to only the "user" field -- CalendarEventService's update() sets
 * every other mutable field (title, date, startTime, endTime, location,
 * notes, trainingType, goals, status, session), so CalendarEventServiceTest
 * already exercises those with real assertions via the response DTO.
 * setUser() is never called by anything in the app (an event's owner is
 * fixed at creation), so it has no other source of coverage. */
class CalendarEventTest {

    @Test
    void setUserOverwritesTheValueTheConstructorSet() {
        User owner = new User(
                "user-001", "Test User", "test@followthrough.app", "hash", null, null, null,
                SubscriptionTier.FREE, null, null);
        User otherOwner = new User(
                "user-002", "Other User", "other@followthrough.app", "hash", null, null, null,
                SubscriptionTier.FREE, null, null);
        CalendarEvent event =
                new CalendarEvent(
                        "event-1",
                        owner,
                        "Title",
                        LocalDate.of(2026, 9, 1),
                        LocalTime.of(8, 0),
                        LocalTime.of(9, 0),
                        "Gym",
                        null,
                        TrainingType.SHOOTING,
                        null,
                        CalendarEventStatus.UPCOMING,
                        null);

        event.setUser(otherOwner);

        assertThat(event.getUser()).isSameAs(otherOwner);
    }
}
