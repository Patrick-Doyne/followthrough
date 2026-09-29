package com.followthrough.api.dto.analytics;

public record AnalyticsSummaryResponse(
        int totalSessions,
        int totalShots,
        int totalMakes,
        double shootingPercentage,
        double avgShotDistance,
        double avgShotDuration,
        double avgTimeToApex,
        int totalTrainingMinutes,
        DeltasResponse deltas) {
}
