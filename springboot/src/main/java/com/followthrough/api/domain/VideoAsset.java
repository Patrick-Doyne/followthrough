package com.followthrough.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "videos")
public class VideoAsset {

    @Id
    @Column(name = "video_id")
    private String videoId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private TrainingSession session;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private Instant date;

    private int durationSeconds;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProcessingStatus status;

    private int analyzedShots;
    private double shootingPercentage;
    private String thumbnailUrl;

    /** The S3 object key (e.g. "sessions/session-001/recording.mp4") --
     * never a playable URL. Actual playback URLs are short-lived and
     * generated on demand by PlaybackUrlService, never stored, since a
     * stored presigned URL would just expire. */
    @Column(nullable = false)
    private String storageKey;

    /**
     * Where a browser-playable copy of this recording lives, or null when
     * the upload itself is playable.
     *
     * <p>Phones shoot HEVC and no Chromium-based browser will decode it:
     * the video element reports a width of zero and the player draws as a
     * black rectangle. So processing writes an H.264 copy beside the
     * upload and records it here. The upload is never touched -- that is
     * the point of holding a second key rather than overwriting the first.
     *
     * <p>Null for everything that arrived in a format browsers already
     * play, which is most of it, and nothing is re-encoded in that case.
     */
    @Column
    private String playbackStorageKey;

    private double sizeMb;

    protected VideoAsset() {
    }

    public VideoAsset(
            String videoId,
            TrainingSession session,
            String title,
            Instant date,
            int durationSeconds,
            ProcessingStatus status,
            int analyzedShots,
            double shootingPercentage,
            String thumbnailUrl,
            String storageKey,
            double sizeMb) {
        this.videoId = videoId;
        this.session = session;
        this.title = title;
        this.date = date;
        this.durationSeconds = durationSeconds;
        this.status = status;
        this.analyzedShots = analyzedShots;
        this.shootingPercentage = shootingPercentage;
        this.thumbnailUrl = thumbnailUrl;
        this.storageKey = storageKey;
        this.sizeMb = sizeMb;
    }

    public String getVideoId() {
        return videoId;
    }

    public TrainingSession getSession() {
        return session;
    }

    public void setSession(TrainingSession session) {
        this.session = session;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public Instant getDate() {
        return date;
    }

    public void setDate(Instant date) {
        this.date = date;
    }

    public int getDurationSeconds() {
        return durationSeconds;
    }

    public void setDurationSeconds(int durationSeconds) {
        this.durationSeconds = durationSeconds;
    }

    public ProcessingStatus getStatus() {
        return status;
    }

    public void setStatus(ProcessingStatus status) {
        this.status = status;
    }

    public int getAnalyzedShots() {
        return analyzedShots;
    }

    public void setAnalyzedShots(int analyzedShots) {
        this.analyzedShots = analyzedShots;
    }

    public double getShootingPercentage() {
        return shootingPercentage;
    }

    public void setShootingPercentage(double shootingPercentage) {
        this.shootingPercentage = shootingPercentage;
    }

    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    public void setThumbnailUrl(String thumbnailUrl) {
        this.thumbnailUrl = thumbnailUrl;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public void setStorageKey(String storageKey) {
        this.storageKey = storageKey;
    }

    /** The key to actually play: the browser-playable copy when one was
     * needed, otherwise the upload itself. */
    public String getPlayableStorageKey() {
        return playbackStorageKey != null ? playbackStorageKey : storageKey;
    }

    public String getPlaybackStorageKey() {
        return playbackStorageKey;
    }

    public void setPlaybackStorageKey(String playbackStorageKey) {
        this.playbackStorageKey = playbackStorageKey;
    }

    public double getSizeMb() {
        return sizeMb;
    }

    public void setSizeMb(double sizeMb) {
        this.sizeMb = sizeMb;
    }

}
