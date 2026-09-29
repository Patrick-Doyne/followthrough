package com.followthrough.api.dto.video;

import com.followthrough.api.domain.ProcessingStatus;
import java.time.Instant;

/** storageKey is the raw S3 object key, exposed for reference -- it is not
 * playable on its own. Fetch GET /videos/{id}/playback-url for a short-lived
 * URL actually usable in a &lt;video&gt; element. */
public record VideoAssetResponse(
        String videoId,
        String sessionId,
        String title,
        Instant date,
        int durationSeconds,
        ProcessingStatus status,
        int analyzedShots,
        double shootingPercentage,
        String thumbnailUrl,
        String storageKey,
        double sizeMb) {
}
