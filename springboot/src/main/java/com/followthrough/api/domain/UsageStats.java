package com.followthrough.api.domain;

import jakarta.persistence.Embeddable;

@Embeddable
public class UsageStats {

    private int videosProcessed;
    private int videoLimit;
    private double storageUsedGb;
    private double storageLimitGb;
    private int liveMinutesUsed;
    private int liveMinutesLimit;

    protected UsageStats() {
    }

    public UsageStats(
            int videosProcessed,
            int videoLimit,
            double storageUsedGb,
            double storageLimitGb,
            int liveMinutesUsed,
            int liveMinutesLimit) {
        this.videosProcessed = videosProcessed;
        this.videoLimit = videoLimit;
        this.storageUsedGb = storageUsedGb;
        this.storageLimitGb = storageLimitGb;
        this.liveMinutesUsed = liveMinutesUsed;
        this.liveMinutesLimit = liveMinutesLimit;
    }

    public int getVideosProcessed() {
        return videosProcessed;
    }

    public void setVideosProcessed(int videosProcessed) {
        this.videosProcessed = videosProcessed;
    }

    public int getVideoLimit() {
        return videoLimit;
    }

    public void setVideoLimit(int videoLimit) {
        this.videoLimit = videoLimit;
    }

    public double getStorageUsedGb() {
        return storageUsedGb;
    }

    public void setStorageUsedGb(double storageUsedGb) {
        this.storageUsedGb = storageUsedGb;
    }

    public double getStorageLimitGb() {
        return storageLimitGb;
    }

    public void setStorageLimitGb(double storageLimitGb) {
        this.storageLimitGb = storageLimitGb;
    }

    public int getLiveMinutesUsed() {
        return liveMinutesUsed;
    }

    public void setLiveMinutesUsed(int liveMinutesUsed) {
        this.liveMinutesUsed = liveMinutesUsed;
    }

    public int getLiveMinutesLimit() {
        return liveMinutesLimit;
    }

    public void setLiveMinutesLimit(int liveMinutesLimit) {
        this.liveMinutesLimit = liveMinutesLimit;
    }
}
