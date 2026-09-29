package com.followthrough.api.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.followthrough.api.domain.CalendarEvent;
import com.followthrough.api.domain.CalendarEventStatus;
import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.domain.TrainingType;
import com.followthrough.api.domain.User;
import com.followthrough.api.domain.VideoAsset;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;

/**
 * @DataJpaTest boots only the JPA slice (real H2, real Hibernate, no web
 * layer, no DataSeeder -- that's a CommandLineRunner and doesn't run under
 * a test slice) so each test builds its own minimal fixture. This exists
 * specifically to verify the derived-query methods actually do what their
 * names claim against a real database, not a mock.
 */
@DataJpaTest
class RepositoryIntegrationTest {

    private static final AtomicInteger USER_SEQUENCE = new AtomicInteger();

    @Autowired private UserRepository userRepository;
    @Autowired private TrainingSessionRepository sessionRepository;
    @Autowired private VideoAssetRepository videoRepository;
    @Autowired private CalendarEventRepository eventRepository;

    @Test
    void sessionFindAllOrdersNewestFirstAndOnlyForTheGivenUser() {
        User owner = persistOwner();
        User someoneElse = persistOwner();
        sessionRepository.saveAll(
                List.of(
                        session("s-old", owner, 10),
                        session("s-mid", owner, 5),
                        session("s-new", owner, 1),
                        session("s-other-user", someoneElse, 1)));

        assertThat(sessionRepository.findAllByUser_UserIdOrderByDateDesc(owner.getUserId()))
                .extracting(TrainingSession::getSessionId)
                .containsExactly("s-new", "s-mid", "s-old");
    }

    @Test
    void videoFindAllPaginatesAndOrdersNewestFirst() {
        User owner = persistOwner();
        TrainingSession session = session("s-1", owner, 1);
        sessionRepository.save(session);
        videoRepository.saveAll(
                List.of(
                        video("v-old", session, 10),
                        video("v-mid", session, 5),
                        video("v-new", session, 1)));

        Page<VideoAsset> firstPage =
                videoRepository.findAllBySession_User_UserIdOrderByDateDesc(owner.getUserId(), PageRequest.of(0, 2));

        assertThat(firstPage.getTotalElements()).isEqualTo(3);
        assertThat(firstPage.getTotalPages()).isEqualTo(2);
        assertThat(firstPage.getContent()).extracting(VideoAsset::getVideoId)
                .containsExactly("v-new", "v-mid");

        Page<VideoAsset> secondPage =
                videoRepository.findAllBySession_User_UserIdOrderByDateDesc(owner.getUserId(), PageRequest.of(1, 2));
        assertThat(secondPage.getContent()).extracting(VideoAsset::getVideoId)
                .containsExactly("v-old");
        assertThat(secondPage.isLast()).isTrue();
    }

    @Test
    void findBySessionSessionIdOnlyReturnsVideosForThatSession() {
        User owner = persistOwner();
        TrainingSession sessionA = session("session-a", owner, 3);
        TrainingSession sessionB = session("session-b", owner, 2);
        sessionRepository.saveAll(List.of(sessionA, sessionB));

        videoRepository.save(video("video-a1", sessionA, 3));
        videoRepository.save(video("video-a2", sessionA, 3));
        videoRepository.save(video("video-b1", sessionB, 2));

        List<VideoAsset> forSessionA =
                videoRepository.findBySession_SessionIdAndSession_User_UserId("session-a", owner.getUserId());

        assertThat(forSessionA).extracting(VideoAsset::getVideoId)
                .containsExactlyInAnyOrder("video-a1", "video-a2");
    }

    @Test
    void findBySessionSessionIdReturnsEmptyForASessionWithNoVideos() {
        User owner = persistOwner();
        sessionRepository.save(session("session-lonely", owner, 1));

        assertThat(videoRepository.findBySession_SessionIdAndSession_User_UserId("session-lonely", owner.getUserId()))
                .isEmpty();
    }

    @Test
    void findByDateBetweenIsInclusiveOnBothBoundariesAndExcludesOutsideDates() {
        User owner = persistOwner();
        eventRepository.saveAll(
                List.of(
                        calendarEvent("e-before", owner, LocalDate.of(2026, 7, 31)),
                        calendarEvent("e-start", owner, LocalDate.of(2026, 8, 1)),
                        calendarEvent("e-middle", owner, LocalDate.of(2026, 8, 15)),
                        calendarEvent("e-end", owner, LocalDate.of(2026, 8, 31)),
                        calendarEvent("e-after", owner, LocalDate.of(2026, 9, 1))));

        List<CalendarEvent> inAugust =
                eventRepository.findByUser_UserIdAndDateBetweenOrderByDateAsc(
                        owner.getUserId(), LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31));

        assertThat(inAugust).extracting(CalendarEvent::getEventId)
                .containsExactly("e-start", "e-middle", "e-end");
    }

    private User persistOwner() {
        int n = USER_SEQUENCE.incrementAndGet();
        return userRepository.save(
                new User(
                        "owner-" + n,
                        "Owner " + n,
                        "owner" + n + "@followthrough.app",
                        "hash",
                        null,
                        null,
                        null,
                        SubscriptionTier.FREE,
                        null,
                        null));
    }

    private static TrainingSession session(String id, User owner, int daysAgo) {
        return new TrainingSession(
                id,
                owner,
                id,
                Instant.now().minus(daysAgo, ChronoUnit.DAYS),
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

    private static VideoAsset video(String id, TrainingSession session, int daysAgo) {
        return new VideoAsset(
                id,
                session,
                id,
                Instant.now().minus(daysAgo, ChronoUnit.DAYS),
                600,
                ProcessingStatus.COMPLETE,
                50,
                50.0,
                "",
                "",
                10.0);
    }

    private static CalendarEvent calendarEvent(String id, User owner, LocalDate date) {
        return new CalendarEvent(
                id,
                owner,
                id,
                date,
                LocalTime.of(9, 0),
                LocalTime.of(10, 0),
                "Test Gym",
                null,
                TrainingType.SHOOTING,
                null,
                CalendarEventStatus.UPCOMING,
                null);
    }
}
