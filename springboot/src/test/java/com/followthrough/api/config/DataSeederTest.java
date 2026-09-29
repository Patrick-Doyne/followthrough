package com.followthrough.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.followthrough.api.domain.CalendarEvent;
import com.followthrough.api.domain.CalendarEventStatus;
import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.domain.TrainingType;
import com.followthrough.api.domain.User;
import com.followthrough.api.domain.VideoAsset;
import com.followthrough.api.repository.CalendarEventRepository;
import com.followthrough.api.repository.TrainingSessionRepository;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.repository.VideoAssetRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * DataSeeder only ever runs against a real (empty, in-memory H2) database in
 * the rest of the suite, which proves it doesn't crash but never pins down
 * the actual computed values (accuracy/makes/shootingPercentage/status
 * formulas) or that each of the three seed steps is independently gated on
 * its own table being empty. These tests mock all four repositories to
 * verify both precisely.
 */
@ExtendWith(MockitoExtension.class)
class DataSeederTest {

    private static final String DEMO_EMAIL = "patrick.doyne@followthrough.app";

    @Mock private UserRepository userRepository;
    @Mock private TrainingSessionRepository sessionRepository;
    @Mock private VideoAssetRepository videoRepository;
    @Mock private CalendarEventRepository calendarEventRepository;
    @Mock private PasswordEncoder passwordEncoder;

    private DataSeeder seeder;

    @BeforeEach
    void setUp() {
        seeder =
                new DataSeeder(
                        userRepository, sessionRepository, videoRepository, calendarEventRepository, passwordEncoder);
    }

    @Test
    void runSeedsNothingWhenEveryTableAlreadyHasData() {
        when(userRepository.count()).thenReturn(1L);
        when(userRepository.findByEmail(DEMO_EMAIL)).thenReturn(Optional.of(existingOwner()));
        when(sessionRepository.count()).thenReturn(1L);
        when(calendarEventRepository.count()).thenReturn(1L);

        seeder.run();

        verify(userRepository, never()).save(any());
        verify(sessionRepository, never()).save(any());
        verify(videoRepository, never()).save(any());
        verify(calendarEventRepository, never()).save(any());
    }

    /** Should never actually happen outside of real data corruption -- the
     * user table reports a row exists, but no row has the demo email. Fails
     * loudly rather than silently seeding a second demo account. */
    @Test
    void runFailsLoudlyIfTheUserTableIsNonEmptyButTheDemoAccountIsMissing() {
        when(userRepository.count()).thenReturn(1L);
        when(userRepository.findByEmail(DEMO_EMAIL)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> seeder.run()).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void runOnlySeedsTheUserWhenOnlyTheUserTableIsEmpty() {
        when(userRepository.count()).thenReturn(0L);
        when(passwordEncoder.encode(any())).thenReturn("hashed-password");
        when(userRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(sessionRepository.count()).thenReturn(1L);
        when(calendarEventRepository.count()).thenReturn(1L);

        seeder.run();

        verify(userRepository, times(1)).save(any());
        verify(sessionRepository, never()).save(any());
        verify(videoRepository, never()).save(any());
        verify(calendarEventRepository, never()).save(any());
    }

    /** The test above never consumes resolveDemoUser()'s/seedUser()'s
     * return value (sessions/calendar are already seeded there, so neither
     * seed method runs) -- this one seeds everything from scratch in one
     * pass specifically so the newly-created user actually gets attached
     * as a session's owner, proving that return value flows through. */
    @Test
    void runSeedsEverythingFromScratchAttachesTheNewlyCreatedUserAsSessionOwner() {
        when(userRepository.count()).thenReturn(0L);
        when(passwordEncoder.encode(any())).thenReturn("hashed-password");
        when(userRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(sessionRepository.count()).thenReturn(0L);
        when(sessionRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(calendarEventRepository.count()).thenReturn(1L);

        seeder.run();

        ArgumentCaptor<TrainingSession> sessionCaptor = ArgumentCaptor.forClass(TrainingSession.class);
        verify(sessionRepository, times(9)).save(sessionCaptor.capture());
        TrainingSession firstSession = sessionCaptor.getAllValues().get(0);
        assertThat(firstSession.getUser()).isNotNull();
        assertThat(firstSession.getUser().getUserId()).isEqualTo("user-001");
        assertThat(firstSession.getUser().getEmail()).isEqualTo(DEMO_EMAIL);
    }

    @Test
    void runOnlySeedsSessionsAndVideosWhenOnlyThatTableIsEmptyWithCorrectlyComputedValues() {
        User owner = existingOwner();
        when(userRepository.count()).thenReturn(1L);
        when(userRepository.findByEmail(DEMO_EMAIL)).thenReturn(Optional.of(owner));
        when(sessionRepository.count()).thenReturn(0L);
        when(calendarEventRepository.count()).thenReturn(1L);
        when(sessionRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        seeder.run();

        verify(userRepository, never()).save(any());
        verify(calendarEventRepository, never()).save(any());

        ArgumentCaptor<TrainingSession> sessionCaptor = ArgumentCaptor.forClass(TrainingSession.class);
        verify(sessionRepository, times(9)).save(sessionCaptor.capture());
        List<TrainingSession> sessions = sessionCaptor.getAllValues();

        ArgumentCaptor<VideoAsset> videoCaptor = ArgumentCaptor.forClass(VideoAsset.class);
        verify(videoRepository, times(9)).save(videoCaptor.capture());
        List<VideoAsset> videos = videoCaptor.getAllValues();

        // Index 0: "Catch & Shoot Circuit", daysAgo=46 (far in the past -> COMPLETE).
        TrainingSession first = sessions.get(0);
        assertThat(first.getSessionId()).isEqualTo("session-001");
        assertThat(first.getUser()).isSameAs(owner);
        assertThat(first.getName()).isEqualTo("Catch & Shoot Circuit");
        assertThat(first.getShots()).isEqualTo(62);
        assertThat(first.getMakes()).isEqualTo(25);
        assertThat(first.getShootingPercentage()).isEqualTo(40.3);
        assertThat(first.getStatus()).isEqualTo(ProcessingStatus.COMPLETE);
        VideoAsset firstVideo = videos.get(0);
        assertThat(firstVideo.getVideoId()).isEqualTo("video-001");
        assertThat(firstVideo.getAnalyzedShots()).isEqualTo(62);
        assertThat(firstVideo.getDurationSeconds()).isEqualTo(4440);
        assertThat(firstVideo.getSizeMb()).isEqualTo(1361.6);
        assertThat(firstVideo.getStorageKey()).isEqualTo("sessions/session-001/recording.mp4");

        // Index 8: "Morning Shootaround", daysAgo=1 -- the <= 1 boundary itself -> PROCESSING,
        // and PROCESSING videos only report a partial analyzedShots count.
        TrainingSession last = sessions.get(8);
        assertThat(last.getSessionId()).isEqualTo("session-009");
        assertThat(last.getMakes()).isEqualTo(23);
        assertThat(last.getShootingPercentage()).isEqualTo(51.1);
        assertThat(last.getStatus()).isEqualTo(ProcessingStatus.PROCESSING);
        VideoAsset lastVideo = videos.get(8);
        assertThat(lastVideo.getStatus()).isEqualTo(ProcessingStatus.PROCESSING);
        assertThat(lastVideo.getAnalyzedShots()).isEqualTo(18);

        // Index 7: "Pre-Camp Tune Up", daysAgo=3 -- just past the <= 1 boundary -> COMPLETE.
        assertThat(sessions.get(7).getStatus()).isEqualTo(ProcessingStatus.COMPLETE);
    }

    @Test
    void runOnlySeedsCalendarEventsWhenOnlyThatTableIsEmpty() {
        User owner = existingOwner();
        when(userRepository.count()).thenReturn(1L);
        when(userRepository.findByEmail(DEMO_EMAIL)).thenReturn(Optional.of(owner));
        when(sessionRepository.count()).thenReturn(1L);
        when(calendarEventRepository.count()).thenReturn(0L);
        List<TrainingSession> fakeSessions = sixFakeSessions(owner);
        when(sessionRepository.findAllByUser_UserIdOrderByDateDesc(owner.getUserId())).thenReturn(fakeSessions);

        seeder.run();

        verify(userRepository, never()).save(any());
        verify(sessionRepository, never()).save(any());
        verify(videoRepository, never()).save(any());

        ArgumentCaptor<CalendarEvent> eventCaptor = ArgumentCaptor.forClass(CalendarEvent.class);
        verify(calendarEventRepository, times(11)).save(eventCaptor.capture());
        List<CalendarEvent> events = eventCaptor.getAllValues();

        assertThat(events).allSatisfy(event -> assertThat(event.getUser()).isSameAs(owner));
        assertThat(events).filteredOn(e -> e.getStatus() == CalendarEventStatus.COMPLETED).hasSize(6);
        assertThat(events.get(0).getTitle()).isEqualTo("Fake Session 1");
        assertThat(events.get(0).getSession()).isSameAs(fakeSessions.get(0));
        // The per-session event ids count up (event-past-1..6), not down --
        // pins down the loop's index++ direction, not just its iteration count.
        assertThat(events.subList(0, 6).stream().map(CalendarEvent::getEventId))
                .containsExactly(
                        "event-past-1", "event-past-2", "event-past-3",
                        "event-past-4", "event-past-5", "event-past-6");

        assertThat(events)
                .filteredOn(e -> e.getEventId().equals("event-missed-1"))
                .singleElement()
                .satisfies(
                        event -> {
                            assertThat(event.getStatus()).isEqualTo(CalendarEventStatus.MISSED);
                            assertThat(event.getDate()).isEqualTo(LocalDate.of(2026, 8, 9));
                        });

        assertThat(events)
                .filteredOn(e -> e.getEventId().equals("event-up-1"))
                .singleElement()
                .satisfies(event -> assertThat(event.getDate()).isEqualTo(LocalDate.of(2026, 8, 15)));

        assertThat(events)
                .filteredOn(e -> e.getEventId().equals("event-up-4"))
                .singleElement()
                .satisfies(event -> assertThat(event.getDate()).isEqualTo(LocalDate.of(2026, 8, 23)));
    }

    @Test
    void seedCalendarEventsHandlesFewerThanSixExistingSessionsWithoutError() {
        User owner = existingOwner();
        when(userRepository.count()).thenReturn(1L);
        when(userRepository.findByEmail(DEMO_EMAIL)).thenReturn(Optional.of(owner));
        when(sessionRepository.count()).thenReturn(1L);
        when(calendarEventRepository.count()).thenReturn(0L);
        when(sessionRepository.findAllByUser_UserIdOrderByDateDesc(owner.getUserId()))
                .thenReturn(sixFakeSessions(owner).subList(0, 2));

        seeder.run();

        // 2 session-derived events + the 5 fixed ones, never 6 + 5.
        verify(calendarEventRepository, times(7)).save(any());
    }

    private static User existingOwner() {
        return new User(
                "user-001",
                "Patrick Doyne",
                DEMO_EMAIL,
                "already-hashed",
                "Combo Guard",
                "Riverside Elite",
                "PD",
                SubscriptionTier.BASIC,
                null,
                null);
    }

    private static List<TrainingSession> sixFakeSessions(User owner) {
        return List.of(
                fakeSession(1, owner), fakeSession(2, owner), fakeSession(3, owner),
                fakeSession(4, owner), fakeSession(5, owner), fakeSession(6, owner));
    }

    private static TrainingSession fakeSession(int n, User owner) {
        return new TrainingSession(
                "fake-session-" + n,
                owner,
                "Fake Session " + n,
                Instant.parse("2026-08-0" + n + "T12:00:00Z"),
                60,
                50,
                25,
                50.0,
                14.0,
                1.0,
                0.6,
                ProcessingStatus.COMPLETE,
                "Fake Gym " + n,
                TrainingType.SHOOTING);
    }
}
