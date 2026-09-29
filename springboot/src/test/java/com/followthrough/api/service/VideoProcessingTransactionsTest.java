package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.domain.TrainingType;
import com.followthrough.api.domain.User;
import com.followthrough.api.domain.VideoAsset;
import com.followthrough.api.repository.VideoAssetRepository;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class VideoProcessingTransactionsTest {

    @Mock private VideoAssetRepository videoRepository;

    private VideoProcessingTransactions transactionsWithRepo() {
        return new VideoProcessingTransactions(videoRepository);
    }

    @Test
    void markProcessingSetsBothVideoAndSessionToProcessingAndReturnsTheStorageKey() {
        TrainingSession session = sessionWithStats(0, 0, 0.0, 0.0, 0.0, 0.0);
        VideoAsset video = video(session);
        when(videoRepository.findById("video-001")).thenReturn(Optional.of(video));

        String storageKey = transactionsWithRepo().markProcessingAndGetStorageKey("video-001");

        assertThat(storageKey).isEqualTo("sessions/session-001/upload.mp4");
        assertThat(video.getStatus()).isEqualTo(ProcessingStatus.PROCESSING);
        assertThat(session.getStatus()).isEqualTo(ProcessingStatus.PROCESSING);
    }

    @Test
    void markProcessingReturnsNullWhenTheVideoIsGone() {
        when(videoRepository.findById("gone")).thenReturn(Optional.empty());

        assertThat(transactionsWithRepo().markProcessingAndGetStorageKey("gone")).isNull();
    }

    @Test
    void applyResultMarksCompleteAndRollsShotsUpIntoTheSession() {
        TrainingSession session = sessionWithStats(20, 10, 50.0, 12.0, 0.8, 0.4);
        VideoAsset video = video(session);
        when(videoRepository.findById("video-001")).thenReturn(Optional.of(video));
        VideoProcessor.ProcessingResult result =
                new VideoProcessor.ProcessingResult(20, 60.0, 15.0, 0.9, 0.5);

        transactionsWithRepo().applyResult("video-001", result);

        assertThat(video.getStatus()).isEqualTo(ProcessingStatus.COMPLETE);
        assertThat(video.getAnalyzedShots()).isEqualTo(20);
        assertThat(video.getShootingPercentage()).isEqualTo(60.0);
        assertThat(session.getStatus()).isEqualTo(ProcessingStatus.COMPLETE);

        // 10 existing makes + round(20 * 60%) = 10 + 12 = 22 makes over 40 shots
        assertThat(session.getShots()).isEqualTo(40);
        assertThat(session.getMakes()).isEqualTo(22);
        assertThat(session.getShootingPercentage()).isEqualTo(55.0);
        // weighted averages: (existing*20 + new*20) / 40 for each of the three fields
        assertThat(session.getAvgShotDistance()).isEqualTo(13.5);
        assertThat(session.getAvgShotDuration()).isEqualTo(0.85);
        assertThat(session.getAvgTimeToApex()).isEqualTo(0.45);
    }

    @Test
    void applyResultOnASessionWithNoPriorShotsDoesNotDivideByZero() {
        TrainingSession session = sessionWithStats(0, 0, 0.0, 0.0, 0.0, 0.0);
        VideoAsset video = video(session);
        when(videoRepository.findById("video-001")).thenReturn(Optional.of(video));
        VideoProcessor.ProcessingResult result =
                new VideoProcessor.ProcessingResult(10, 50.0, 14.0, 0.7, 0.3);

        transactionsWithRepo().applyResult("video-001", result);

        assertThat(session.getShots()).isEqualTo(10);
        assertThat(session.getMakes()).isEqualTo(5);
        assertThat(session.getShootingPercentage()).isEqualTo(50.0);
        assertThat(session.getAvgShotDistance()).isEqualTo(14.0);
    }

    @Test
    void applyResultWithNoShotsAtAllLeavesTheSessionAtZeroWithoutDividingByZero() {
        TrainingSession session = sessionWithStats(0, 0, 0.0, 0.0, 0.0, 0.0);
        VideoAsset video = video(session);
        when(videoRepository.findById("video-001")).thenReturn(Optional.of(video));
        VideoProcessor.ProcessingResult result = new VideoProcessor.ProcessingResult(0, 0.0, 0.0, 0.0, 0.0);

        transactionsWithRepo().applyResult("video-001", result);

        assertThat(session.getShots()).isZero();
        assertThat(session.getMakes()).isZero();
        assertThat(session.getShootingPercentage()).isZero();
        assertThat(session.getAvgShotDistance()).isZero();
    }

    @Test
    void applyResultDoesNothingWhenTheVideoIsGone() {
        when(videoRepository.findById("gone")).thenReturn(Optional.empty());

        transactionsWithRepo()
                .applyResult("gone", new VideoProcessor.ProcessingResult(1, 1.0, 1.0, 1.0, 1.0));
        // no exception -- nothing to assert beyond "didn't throw"
    }

    @Test
    void setThumbnailUrlUpdatesTheVideo() {
        TrainingSession session = sessionWithStats(0, 0, 0.0, 0.0, 0.0, 0.0);
        VideoAsset video = video(session);
        when(videoRepository.findById("video-001")).thenReturn(Optional.of(video));

        transactionsWithRepo().setThumbnailUrl("video-001", "http://localhost:8082/api/v1/videos/local-blob/sessions/session-001/upload-thumbnail.jpg");

        assertThat(video.getThumbnailUrl())
                .isEqualTo("http://localhost:8082/api/v1/videos/local-blob/sessions/session-001/upload-thumbnail.jpg");
    }

    @Test
    void setThumbnailUrlDoesNothingWhenTheVideoIsGone() {
        when(videoRepository.findById("gone")).thenReturn(Optional.empty());

        transactionsWithRepo().setThumbnailUrl("gone", "http://example.com/thumb.jpg");
        // no exception -- nothing to assert beyond "didn't throw"
    }

    @Test
    void markFailedSetsBothVideoAndSessionToFailed() {
        TrainingSession session = sessionWithStats(0, 0, 0.0, 0.0, 0.0, 0.0);
        VideoAsset video = video(session);
        when(videoRepository.findById("video-001")).thenReturn(Optional.of(video));

        transactionsWithRepo().markFailed("video-001");

        assertThat(video.getStatus()).isEqualTo(ProcessingStatus.FAILED);
        assertThat(session.getStatus()).isEqualTo(ProcessingStatus.FAILED);
    }

    @Test
    void markFailedDoesNothingWhenTheVideoIsGone() {
        when(videoRepository.findById("gone")).thenReturn(Optional.empty());

        transactionsWithRepo().markFailed("gone");
        // no exception -- nothing to assert beyond "didn't throw"
    }

    private static VideoAsset video(TrainingSession session) {
        return new VideoAsset(
                "video-001",
                session,
                "Uploaded Recording",
                Instant.now(),
                0,
                ProcessingStatus.QUEUED,
                0,
                0.0,
                null,
                "sessions/session-001/upload.mp4",
                0.0);
    }

    private static TrainingSession sessionWithStats(
            int shots,
            int makes,
            double shootingPercentage,
            double avgShotDistance,
            double avgShotDuration,
            double avgTimeToApex) {
        User owner =
                new User(
                        "user-001", "Test User", "test@followthrough.app", "hash", null, null, null,
                        SubscriptionTier.FREE, null, null);
        return new TrainingSession(
                "session-001",
                owner,
                "Uploaded Session",
                Instant.now(),
                60,
                shots,
                makes,
                shootingPercentage,
                avgShotDistance,
                avgShotDuration,
                avgTimeToApex,
                ProcessingStatus.QUEUED,
                "Home Gym",
                TrainingType.SHOOTING);
    }
}
