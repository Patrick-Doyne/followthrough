package com.followthrough.api.dto.user;

public record UsageResponse(
        int videosProcessed,
        int videoLimit,
        double storageUsedGb,
        double storageLimitGb,
        int liveMinutesUsed,
        int liveMinutesLimit) {
}
