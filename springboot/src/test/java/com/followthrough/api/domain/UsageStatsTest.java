package com.followthrough.api.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class UsageStatsTest {

    @Test
    void settersOverwriteTheValuesTheAllArgsConstructorSet() {
        UsageStats usage = new UsageStats(9, 25, 12.4, 50, 84, 120);

        usage.setVideosProcessed(10);
        usage.setVideoLimit(30);
        usage.setStorageUsedGb(15.2);
        usage.setStorageLimitGb(60);
        usage.setLiveMinutesUsed(90);
        usage.setLiveMinutesLimit(150);

        assertThat(usage.getVideosProcessed()).isEqualTo(10);
        assertThat(usage.getVideoLimit()).isEqualTo(30);
        assertThat(usage.getStorageUsedGb()).isEqualTo(15.2);
        assertThat(usage.getStorageLimitGb()).isEqualTo(60);
        assertThat(usage.getLiveMinutesUsed()).isEqualTo(90);
        assertThat(usage.getLiveMinutesLimit()).isEqualTo(150);
    }
}
