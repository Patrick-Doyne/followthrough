package com.followthrough.api.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class VideoAssetTest {

    @Test
    void settersOverwriteTheValuesTheAllArgsConstructorSet() {
        User owner = fakeUser("user-001");
        TrainingSession session =
                new TrainingSession(
                        "session-001",
                        owner,
                        "Morning Shootaround",
                        Instant.parse("2026-01-01T12:00:00Z"),
                        60,
                        50,
                        30,
                        60.0,
                        18.5,
                        1.2,
                        0.6,
                        ProcessingStatus.COMPLETE,
                        "Main Gym",
                        TrainingType.SHOOTING);
        TrainingSession otherSession =
                new TrainingSession(
                        "session-002",
                        owner,
                        "Evening Shootaround",
                        Instant.parse("2026-01-02T18:00:00Z"),
                        60,
                        40,
                        20,
                        50.0,
                        17.0,
                        1.1,
                        0.5,
                        ProcessingStatus.COMPLETE,
                        "Practice Gym",
                        TrainingType.SKILLS);

        VideoAsset video =
                new VideoAsset(
                        "video-001",
                        session,
                        "Original Title",
                        Instant.parse("2026-01-01T12:30:00Z"),
                        900,
                        ProcessingStatus.PROCESSING,
                        10,
                        50.0,
                        "https://example.com/thumb.jpg",
                        "sessions/session-001/recording.mp4",
                        120.5);

        video.setSession(otherSession);
        video.setTitle("Updated Title");
        video.setDate(Instant.parse("2026-01-02T19:00:00Z"));
        video.setDurationSeconds(1800);
        video.setStatus(ProcessingStatus.COMPLETE);
        video.setAnalyzedShots(42);
        video.setShootingPercentage(66.7);
        video.setThumbnailUrl("https://example.com/updated-thumb.jpg");
        video.setStorageKey("sessions/session-002/recording.mp4");
        video.setSizeMb(210.4);

        assertThat(video.getVideoId()).isEqualTo("video-001");
        assertThat(video.getSession()).isEqualTo(otherSession);
        assertThat(video.getTitle()).isEqualTo("Updated Title");
        assertThat(video.getDate()).isEqualTo(Instant.parse("2026-01-02T19:00:00Z"));
        assertThat(video.getDurationSeconds()).isEqualTo(1800);
        assertThat(video.getStatus()).isEqualTo(ProcessingStatus.COMPLETE);
        assertThat(video.getAnalyzedShots()).isEqualTo(42);
        assertThat(video.getShootingPercentage()).isEqualTo(66.7);
        assertThat(video.getThumbnailUrl()).isEqualTo("https://example.com/updated-thumb.jpg");
        assertThat(video.getStorageKey()).isEqualTo("sessions/session-002/recording.mp4");
        assertThat(video.getSizeMb()).isEqualTo(210.4);
    }

    private static User fakeUser(String userId) {
        return new User(
                userId, "Test User", userId + "@followthrough.app", "hash", null, null, null,
                SubscriptionTier.FREE, null, null);
    }

    @Test
    void playableStorageKeyPrefersTheBrowserPlayableCopyWhenOneWasMade() {
        // An HEVC upload is stored untouched and cannot be decoded by any
        // browser, so what gets played is the H.264 copy beside it.
        VideoAsset video = new VideoAsset(
                "video-001",
                null,
                "Clip",
                Instant.EPOCH,
                60,
                ProcessingStatus.COMPLETE,
                0,
                0.0,
                null,
                "sessions/s/rec.mov",
                10.0);

        assertThat(video.getPlaybackStorageKey()).isNull();
        assertThat(video.getPlayableStorageKey()).isEqualTo("sessions/s/rec.mov");

        video.setPlaybackStorageKey("sessions/s/rec-playback.mp4");

        assertThat(video.getPlayableStorageKey()).isEqualTo("sessions/s/rec-playback.mp4");
        // The upload's own key is never reassigned, so the original stays
        // reachable for download and re-processing.
        assertThat(video.getStorageKey()).isEqualTo("sessions/s/rec.mov");
    }
}
