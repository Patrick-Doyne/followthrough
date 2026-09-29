package com.followthrough.api.dto.analytics;

import java.time.Instant;

public record SeriesPointResponse(
        String sessionId,
        String label,
        Instant date,
        double shootingPercentage,
        int shots,
        int makes,
        double avgShotDistance,
        double avgShotDuration,
        double avgTimeToApex) {
}
