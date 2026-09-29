package com.followthrough.api.service;

import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.repository.VideoAssetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The transactional DB operations behind offline video processing, split
 * out from VideoProcessingRunner so its @Async method can call these
 * through a real Spring proxy -- calling @Transactional methods via `this`
 * from within the same class (self-invocation) silently skips the proxy
 * and runs with no transaction at all, which is exactly the kind of bug
 * that only shows up as a LazyInitializationException on VideoAsset's
 * lazy `session` relation once something actually tries to touch it.
 */
@Service
public class VideoProcessingTransactions {

    private final VideoAssetRepository videoRepository;

    public VideoProcessingTransactions(VideoAssetRepository videoRepository) {
        this.videoRepository = videoRepository;
    }

    /** Returns null (instead of throwing) if the video was deleted before
     * processing got a chance to start -- there's nothing left to process. */
    @Transactional
    public String markProcessingAndGetStorageKey(String videoId) {
        return videoRepository
                .findById(videoId)
                .map(
                        video -> {
                            video.setStatus(ProcessingStatus.PROCESSING);
                            video.getSession().setStatus(ProcessingStatus.PROCESSING);
                            return video.getStorageKey();
                        })
                .orElse(null);
    }

    @Transactional
    public void applyResult(
            String videoId, VideoProcessor.ProcessingResult result) {
        videoRepository
                .findById(videoId)
                .ifPresent(
                        video -> {
                            video.setAnalyzedShots(result.analyzedShots());
                            video.setShootingPercentage(result.shootingPercentage());
                            video.setStatus(ProcessingStatus.COMPLETE);
                            rollUpIntoSession(video.getSession(), result);
                            video.getSession().setStatus(ProcessingStatus.COMPLETE);
                        });
    }

    @Transactional
    public void setThumbnailUrl(String videoId, String thumbnailUrl) {
        videoRepository.findById(videoId).ifPresent(video -> video.setThumbnailUrl(thumbnailUrl));
    }

    /** Points playback at the browser-playable copy written beside the
     * upload. The upload's own storageKey is left alone. */
    @Transactional
    public void setPlaybackStorageKey(String videoId, String playbackStorageKey) {
        videoRepository
                .findById(videoId)
                .ifPresent(video -> video.setPlaybackStorageKey(playbackStorageKey));
    }

    @Transactional
    public void markFailed(String videoId) {
        videoRepository
                .findById(videoId)
                .ifPresent(
                        video -> {
                            video.setStatus(ProcessingStatus.FAILED);
                            video.getSession().setStatus(ProcessingStatus.FAILED);
                        });
    }

    /** Merges this video's numbers into the session's running totals --
     * shots/makes accumulate, and the three averages are recombined as a
     * shot-count-weighted average rather than overwritten, so a session
     * with more than one processed video still ends up with a real
     * aggregate instead of just reflecting whichever video finished last. */
    private void rollUpIntoSession(TrainingSession session, VideoProcessor.ProcessingResult result) {
        int priorShots = session.getShots();
        int newShots = priorShots + result.analyzedShots();
        int newMakes =
                session.getMakes()
                        + Math.round((float) (result.analyzedShots() * result.shootingPercentage() / 100.0));

        session.setShots(newShots);
        session.setMakes(newMakes);
        session.setShootingPercentage(newShots > 0 ? 100.0 * newMakes / newShots : 0.0);
        session.setAvgShotDistance(
                weightedAverage(
                        session.getAvgShotDistance(), priorShots, result.avgShotDistance(), result.analyzedShots()));
        session.setAvgShotDuration(
                weightedAverage(
                        session.getAvgShotDuration(), priorShots, result.avgShotDuration(), result.analyzedShots()));
        session.setAvgTimeToApex(
                weightedAverage(
                        session.getAvgTimeToApex(), priorShots, result.avgTimeToApex(), result.analyzedShots()));
    }

    private static double weightedAverage(
            double existingAvg, int existingCount, double newAvg, int newCount) {
        int total = existingCount + newCount;
        if (total == 0) {
            return 0.0;
        }
        return (existingAvg * existingCount + newAvg * newCount) / total;
    }
}
