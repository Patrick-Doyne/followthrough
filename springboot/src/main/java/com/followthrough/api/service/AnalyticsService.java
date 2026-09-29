package com.followthrough.api.service;

import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.dto.analytics.AnalyticsSummaryResponse;
import com.followthrough.api.dto.analytics.DeltasResponse;
import com.followthrough.api.dto.analytics.SeriesPointResponse;
import com.followthrough.api.repository.TrainingSessionRepository;
import com.followthrough.api.security.CurrentUser;
import java.util.List;
import java.util.function.ToDoubleFunction;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Built entirely from TrainingSession's own aggregate columns (each session
 * already carries its shot/make counts and averages) -- never from
 * individual shot rows, since shot-level telemetry is intentionally kept
 * out of this relational store. Scoped to the caller's own sessions (see
 * CurrentUser) -- one account's analytics never include another's data.
 */
@Service
@Transactional(readOnly = true)
public class AnalyticsService {

    private static final int TREND_WINDOW = 3;

    private final TrainingSessionRepository sessionRepository;
    private final CurrentUser currentUser;

    public AnalyticsService(TrainingSessionRepository sessionRepository, CurrentUser currentUser) {
        this.sessionRepository = sessionRepository;
        this.currentUser = currentUser;
    }

    public AnalyticsSummaryResponse summary() {
        List<TrainingSession> sessions =
                sessionRepository.findAllByUser_UserIdOrderByDateDesc(currentUser.userId());

        int totalShots = sessions.stream().mapToInt(TrainingSession::getShots).sum();
        int totalMakes = sessions.stream().mapToInt(TrainingSession::getMakes).sum();
        int totalTrainingMinutes =
                sessions.stream().mapToInt(TrainingSession::getDurationMinutes).sum();

        List<TrainingSession> recent = sessions.stream().limit(TREND_WINDOW).toList();
        List<TrainingSession> prior =
                sessions.stream().skip(TREND_WINDOW).limit(TREND_WINDOW).toList();

        return new AnalyticsSummaryResponse(
                sessions.size(),
                totalShots,
                totalMakes,
                percentage(totalMakes, totalShots),
                weightedAverage(sessions, TrainingSession::getAvgShotDistance, totalShots),
                weightedAverage(sessions, TrainingSession::getAvgShotDuration, totalShots),
                weightedAverage(sessions, TrainingSession::getAvgTimeToApex, totalShots),
                totalTrainingMinutes,
                new DeltasResponse(
                        average(recent, TrainingSession::getShootingPercentage)
                                - average(prior, TrainingSession::getShootingPercentage),
                        average(recent, s -> s.getShots())
                                - average(prior, s -> s.getShots()),
                        average(recent, TrainingSession::getAvgShotDistance)
                                - average(prior, TrainingSession::getAvgShotDistance),
                        average(recent, TrainingSession::getAvgShotDuration)
                                - average(prior, TrainingSession::getAvgShotDuration)));
    }

    public List<SeriesPointResponse> shootingSeries() {
        return sessionRepository.findAllByUser_UserIdOrderByDateAsc(currentUser.userId()).stream()
                .map(
                        s ->
                                new SeriesPointResponse(
                                        s.getSessionId(),
                                        s.getName(),
                                        s.getDate(),
                                        s.getShootingPercentage(),
                                        s.getShots(),
                                        s.getMakes(),
                                        s.getAvgShotDistance(),
                                        s.getAvgShotDuration(),
                                        s.getAvgTimeToApex()))
                .toList();
    }

    private static double percentage(int part, int whole) {
        return whole == 0 ? 0 : (double) part / whole * 100;
    }

    /** Shot-count-weighted average across sessions -- a session with more
     * shots contributes proportionally more to the overall average. */
    private static double weightedAverage(
            List<TrainingSession> sessions, ToDoubleFunction<TrainingSession> metric, int totalShots) {
        if (totalShots == 0) {
            return 0;
        }
        double sum = sessions.stream().mapToDouble(s -> metric.applyAsDouble(s) * s.getShots()).sum();
        return sum / totalShots;
    }

    private static double average(List<TrainingSession> sessions, ToDoubleFunction<TrainingSession> metric) {
        if (sessions.isEmpty()) {
            return 0;
        }
        return sessions.stream().mapToDouble(metric).average().orElse(0);
    }
}
