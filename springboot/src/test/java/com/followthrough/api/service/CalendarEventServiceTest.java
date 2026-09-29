package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.followthrough.api.domain.CalendarEvent;
import com.followthrough.api.domain.CalendarEventStatus;
import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.domain.TrainingType;
import com.followthrough.api.domain.User;
import com.followthrough.api.dto.calendar.CalendarEventRequest;
import com.followthrough.api.dto.calendar.CalendarEventResponse;
import com.followthrough.api.repository.CalendarEventRepository;
import com.followthrough.api.repository.TrainingSessionRepository;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.security.CurrentUser;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CalendarEventServiceTest {

    private static final String USER_ID = "user-001";

    @Mock private CalendarEventRepository eventRepository;
    @Mock private TrainingSessionRepository sessionRepository;
    @Mock private UserRepository userRepository;
    @Mock private CurrentUser currentUser;

    private CalendarEventService service;

    @BeforeEach
    void setUp() {
        when(currentUser.userId()).thenReturn(USER_ID);
        service = new CalendarEventService(eventRepository, sessionRepository, userRepository, currentUser);
    }

    @Test
    void createWithoutASessionIdLeavesTheEventUnlinked() {
        when(userRepository.getReferenceById(anyString())).thenReturn(owner());
        when(eventRepository.save(any(CalendarEvent.class))).thenAnswer(invocation -> invocation.getArgument(0));

        CalendarEventResponse response = service.create(eventRequest(null));

        assertThat(response.sessionId()).isNull();
        assertThat(response.status()).isEqualTo(CalendarEventStatus.UPCOMING);
    }

    @Test
    void createWithAKnownSessionIdLinksTheEventToIt() {
        when(userRepository.getReferenceById(anyString())).thenReturn(owner());
        when(sessionRepository.findBySessionIdAndUser_UserId("session-001", USER_ID))
                .thenReturn(Optional.of(exampleSession()));
        when(eventRepository.save(any(CalendarEvent.class))).thenAnswer(invocation -> invocation.getArgument(0));

        CalendarEventResponse response = service.create(eventRequest("session-001"));

        assertThat(response.sessionId()).isEqualTo("session-001");
    }

    @Test
    void createWithAnExplicitStatusUsesItInsteadOfDefaultingToUpcoming() {
        when(userRepository.getReferenceById(anyString())).thenReturn(owner());
        when(eventRepository.save(any(CalendarEvent.class))).thenAnswer(invocation -> invocation.getArgument(0));

        CalendarEventResponse response =
                service.create(
                        new CalendarEventRequest(
                                "Test Event",
                                LocalDate.of(2026, 10, 1),
                                LocalTime.of(17, 0),
                                LocalTime.of(18, 0),
                                "Test Gym",
                                null,
                                TrainingType.SHOOTING,
                                null,
                                CalendarEventStatus.COMPLETED,
                                null));

        assertThat(response.status()).isEqualTo(CalendarEventStatus.COMPLETED);
    }

    @Test
    void listWithOnlyFromProvidedFetchesEveryEventRatherThanFiltering() {
        when(eventRepository.findAllByUser_UserIdOrderByDateAsc(USER_ID)).thenReturn(List.of(existingEvent()));

        List<CalendarEventResponse> result = service.list(LocalDate.of(2026, 9, 1), null);

        assertThat(result).hasSize(1);
        verify(eventRepository, never()).findByUser_UserIdAndDateBetweenOrderByDateAsc(any(), any(), any());
    }

    @Test
    void updateAppliesEveryFieldFromTheRequest() {
        CalendarEvent existing = existingEvent();
        when(eventRepository.findByEventIdAndUser_UserId("event-1", USER_ID)).thenReturn(Optional.of(existing));
        when(sessionRepository.findBySessionIdAndUser_UserId("session-002", USER_ID))
                .thenReturn(Optional.of(otherSession()));

        CalendarEventResponse response =
                service.update(
                        "event-1",
                        new CalendarEventRequest(
                                "Renamed",
                                LocalDate.of(2026, 11, 1),
                                LocalTime.of(9, 0),
                                LocalTime.of(10, 0),
                                "New Gym",
                                "new notes",
                                TrainingType.CONDITIONING,
                                "new goals",
                                CalendarEventStatus.COMPLETED,
                                "session-002"));

        assertThat(response.title()).isEqualTo("Renamed");
        assertThat(response.date()).isEqualTo(LocalDate.of(2026, 11, 1));
        assertThat(response.startTime()).isEqualTo(LocalTime.of(9, 0));
        assertThat(response.endTime()).isEqualTo(LocalTime.of(10, 0));
        assertThat(response.location()).isEqualTo("New Gym");
        assertThat(response.notes()).isEqualTo("new notes");
        assertThat(response.goals()).isEqualTo("new goals");
        assertThat(response.status()).isEqualTo(CalendarEventStatus.COMPLETED);
        assertThat(response.trainingType()).isEqualTo(TrainingType.CONDITIONING);
        assertThat(response.sessionId()).isEqualTo("session-002");
    }

    private static CalendarEventRequest eventRequest(String sessionId) {
        return new CalendarEventRequest(
                "Test Event",
                LocalDate.of(2026, 10, 1),
                LocalTime.of(17, 0),
                LocalTime.of(18, 0),
                "Test Gym",
                null,
                TrainingType.SHOOTING,
                null,
                null,
                sessionId);
    }

    private static CalendarEvent existingEvent() {
        return new CalendarEvent(
                "event-1",
                owner(),
                "Original title",
                LocalDate.of(2026, 9, 1),
                LocalTime.of(8, 0),
                LocalTime.of(9, 0),
                "Original Gym",
                "original notes",
                TrainingType.SHOOTING,
                "original goals",
                CalendarEventStatus.UPCOMING,
                exampleSession());
    }

    private static User owner() {
        return new User(
                USER_ID, "Test User", "test@followthrough.app", "hash", null, null, null,
                SubscriptionTier.FREE, null, null);
    }

    private static TrainingSession exampleSession() {
        return new TrainingSession(
                "session-001",
                owner(),
                "Example",
                Instant.now(),
                60,
                50,
                25,
                50.0,
                14.0,
                1.0,
                0.6,
                ProcessingStatus.COMPLETE,
                "Test Gym",
                TrainingType.SHOOTING);
    }

    private static TrainingSession otherSession() {
        return new TrainingSession(
                "session-002",
                owner(),
                "Other Example",
                Instant.now(),
                45,
                40,
                20,
                50.0,
                12.0,
                0.9,
                0.5,
                ProcessingStatus.COMPLETE,
                "Other Gym",
                TrainingType.SKILLS);
    }
}
