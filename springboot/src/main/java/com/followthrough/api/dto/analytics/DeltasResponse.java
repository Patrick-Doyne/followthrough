package com.followthrough.api.dto.analytics;

public record DeltasResponse(
        double shootingPercentage,
        double totalShots,
        double avgShotDistance,
        double avgShotDuration) {
}
