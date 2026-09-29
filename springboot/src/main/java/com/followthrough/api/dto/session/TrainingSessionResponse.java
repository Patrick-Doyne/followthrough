package com.followthrough.api.dto.session;

import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.TrainingType;
import java.time.Instant;

public record TrainingSessionResponse(
        String sessionId,
        String name,
        Instant date,
        int durationMinutes,
        int shots,
        int makes,
        double shootingPercentage,
        double avgShotDistance,
        double avgShotDuration,
        double avgTimeToApex,
        ProcessingStatus status,
        String location,
        TrainingType trainingType) {
}
