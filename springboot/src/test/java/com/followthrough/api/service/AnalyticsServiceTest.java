package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.Mockito.when;

import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.domain.TrainingType;
import com.followthrough.api.domain.User;
import com.followthrough.api.dto.analytics.AnalyticsSummaryResponse;
import com.followthrough.api.repository.TrainingSessionRepository;
import com.followthrough.api.security.CurrentUser;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AnalyticsServiceTest {

    private static final String USER_ID = "user-001";

    @Mock private TrainingSessionRepository sessionRepository;
    @Mock private CurrentUser currentUser;

    private AnalyticsService analyticsService;

    @BeforeEach
    void setUp() {
        when(currentUser.userId()).thenReturn(USER_ID);
        analyticsService = new AnalyticsService(sessionRepository, currentUser);
    }

    @Test
    void summaryWeightsAveragesByShotCountAndTotalsAcrossSessions() {
        // 100 shots at avgShotDistance 10, 50 shots at avgShotDistance 20
        // -> weighted average should be (100*10 + 50*20) / 150 = 13.33, not
        // the unweighted (10+20)/2 = 15.
        TrainingSession big =
                session("session-1", 5, 100, 50, 10.0, 1.0, 0.6, 60);
        TrainingSession small =
                session("session-2", 3, 50, 20, 20.0, 1.2, 0.7, 30);
        when(sessionRepository.findAllByUser_UserIdOrderByDateDesc(USER_ID)).thenReturn(List.of(big, small));

        AnalyticsSummaryResponse summary = analyticsService.summary();

        assertThat(summary.totalSessions()).isEqualTo(2);
        assertThat(summary.totalShots()).isEqualTo(150);
        assertThat(summary.totalMakes()).isEqualTo(70);
        assertThat(summary.shootingPercentage()).isCloseTo(46.67, within(0.01));
        assertThat(summary.avgShotDistance()).isCloseTo(13.33, within(0.01));
        assertThat(summary.totalTrainingMinutes()).isEqualTo(90);
    }

    @Test
    void summaryDeltasSubtractThePriorThreeSessionsAverageFromTheRecentThree() {
        // "Recent" (first 3, most-recent-first) all share one set of stats;
        // "prior" (next 3) share a distinctly different set, so an
        // addition-instead-of-subtraction bug or a lambda that always
        // returns 0 would produce values nothing here matches.
        List<TrainingSession> sessions =
                List.of(
                        session("recent-1", 1, 10, 6, 20.0, 1.0, 0.4, 60),
                        session("recent-2", 2, 10, 6, 20.0, 1.0, 0.4, 60),
                        session("recent-3", 3, 10, 6, 20.0, 1.0, 0.4, 60),
                        session("prior-1", 4, 6, 2, 14.0, 0.5, 0.3, 45),
                        session("prior-2", 5, 6, 2, 14.0, 0.5, 0.3, 45),
                        session("prior-3", 6, 6, 2, 14.0, 0.5, 0.3, 45));
        when(sessionRepository.findAllByUser_UserIdOrderByDateDesc(USER_ID)).thenReturn(sessions);

        AnalyticsSummaryResponse summary = analyticsService.summary();

        // recent shootingPercentage = 60.0 each, prior = 33.33.. each.
        assertThat(summary.deltas().shootingPercentage()).isCloseTo(26.67, within(0.01));
        // recent shots avg = 10, prior shots avg = 6.
        assertThat(summary.deltas().totalShots()).isCloseTo(4.0, within(0.01));
        // recent avgShotDistance = 20, prior = 14.
        assertThat(summary.deltas().avgShotDistance()).isCloseTo(6.0, within(0.01));
        // recent avgShotDuration = 1.0, prior = 0.5.
        assertThat(summary.deltas().avgShotDuration()).isCloseTo(0.5, within(0.01));
    }

    @Test
    void summaryReturnsZeroesRatherThanDividingByZeroWhenThereAreNoSessions() {
        when(sessionRepository.findAllByUser_UserIdOrderByDateDesc(USER_ID)).thenReturn(List.of());

        AnalyticsSummaryResponse summary = analyticsService.summary();

        assertThat(summary.totalSessions()).isZero();
        assertThat(summary.shootingPercentage()).isZero();
        assertThat(summary.avgShotDistance()).isZero();
    }

    private static TrainingSession session(
            String id,
            int daysAgo,
            int shots,
            int makes,
            double avgShotDistance,
            double avgShotDuration,
            double avgTimeToApex,
            int durationMinutes) {
        return new TrainingSession(
                id,
                owner(),
                id,
                Instant.now().minusSeconds(daysAgo * 86_400L),
                durationMinutes,
                shots,
                makes,
                makes * 100.0 / shots,
                avgShotDistance,
                avgShotDuration,
                avgTimeToApex,
                ProcessingStatus.COMPLETE,
                "Test Gym",
                TrainingType.SHOOTING);
    }

    private static User owner() {
        return new User(
                USER_ID, "Test User", "test@followthrough.app", "hash", null, null, null,
                SubscriptionTier.FREE, null, null);
    }
}
