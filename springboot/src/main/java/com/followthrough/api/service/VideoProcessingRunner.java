package com.followthrough.api.service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * Runs offline video processing off the request thread (see AsyncConfig)
 * so a slow "analyze this file" job can't tie up the app's normal
 * request-handling threads. By the time this runs, the caller's ownership
 * of the session has already been checked synchronously in
 * VideoAssetService.startProcessing -- this only ever operates on one
 * already-created, already-authorized videoId, so it deliberately doesn't
 * use CurrentUser: Spring Security's context is bound to the request
 * thread and wouldn't be available here anyway.
 *
 * <p>All actual DB reads/writes are delegated to VideoProcessingTransactions
 * (a separate bean, not just separate methods) -- an @Async method calling
 * @Transactional methods on `this` would silently skip the transactional
 * proxy (Spring's well-known self-invocation gap), which is exactly what
 * happened here during development.
 */
@Service
public class VideoProcessingRunner {

    private static final Logger log = LoggerFactory.getLogger(VideoProcessingRunner.class);

    private final VideoProcessingTransactions transactions;
    private final VideoProcessor videoProcessor;
    private final TelemetryStore telemetryStore;
    private final Path storageRoot;
    private final String baseUrl;

    public VideoProcessingRunner(
            VideoProcessingTransactions transactions,
            VideoProcessor videoProcessor,
            TelemetryStore telemetryStore,
            @Value("${followthrough.storage.local.directory}") String storageDirectory,
            @Value("${followthrough.storage.local.base-url}") String baseUrl) {
        this.transactions = transactions;
        this.videoProcessor = videoProcessor;
        this.telemetryStore = telemetryStore;
        this.storageRoot = Path.of(storageDirectory).toAbsolutePath().normalize();
        this.baseUrl = baseUrl;
    }

    @Async
    public void processAsync(String videoId) {
        String storageKey = transactions.markProcessingAndGetStorageKey(videoId);
        if (storageKey == null) {
            return;
        }
        try {
            File file = storageRoot.resolve(storageKey).normalize().toFile();
            VideoProcessor.ProcessingOutcome outcome = videoProcessor.process(file);
            transactions.applyResult(videoId, outcome.result());
            // Kept separate from applyResult -- neither a telemetry-save
            // nor a thumbnail-relocation failure should roll back an
            // otherwise-correct stats result.
            telemetryStore.save(videoId, outcome.fps(), outcome.telemetry());
            relocateThumbnail(videoId, storageKey, outcome.thumbnailFile());
            relocatePlaybackCopy(videoId, storageKey, outcome.playbackFile());
        } catch (RuntimeException e) {
            log.warn("Video processing failed for video {}", videoId, e);
            transactions.markFailed(videoId);
        }
    }

    /**
     * Moves the browser-playable copy into storage beside the upload and
     * records its key, when one was made.
     *
     * <p>Beside, never over: the upload is kept exactly as it arrived, and
     * this is the copy the player is pointed at instead (see
     * VideoAsset.playbackStorageKey).
     *
     * <p>Not best-effort, unlike the thumbnail. A missing thumbnail costs
     * a gallery tile; a missing playback copy for an upload no browser can
     * decode is a video that plays as a black rectangle, which is worse
     * than an honest failure.
     */
    private void relocatePlaybackCopy(String videoId, String storageKey, File playbackFile) {
        if (playbackFile == null) {
            // The upload plays as it stands, so nothing was transcoded.
            return;
        }
        try {
            String playbackKey = VideoStorageKeys.playback(storageKey);
            Path target = storageRoot.resolve(playbackKey).normalize();
            Files.createDirectories(target.getParent());
            Files.move(playbackFile.toPath(), target, StandardCopyOption.REPLACE_EXISTING);
            transactions.setPlaybackStorageKey(videoId, playbackKey);
        } catch (IOException e) {
            throw new VideoProcessingException(
                    "Failed to store the playback copy for video " + videoId, e);
        }
    }

    /** Moves the processor's temp thumbnail file into the same local
     * storage videos themselves live in, alongside the video under its
     * own session folder, and records the resulting URL. Best-effort: a
     * missing/unrelocatable thumbnail just means the gallery falls back
     * to its placeholder, not a failed video. */
    private void relocateThumbnail(String videoId, String storageKey, File thumbnailFile) {
        if (thumbnailFile == null) {
            return;
        }
        try {
            String thumbnailKey = VideoStorageKeys.thumbnail(storageKey);
            Path target = storageRoot.resolve(thumbnailKey).normalize();
            Files.createDirectories(target.getParent());
            Files.move(thumbnailFile.toPath(), target, StandardCopyOption.REPLACE_EXISTING);
            transactions.setThumbnailUrl(videoId, baseUrl + "/videos/local-blob/" + thumbnailKey);
        } catch (IOException e) {
            log.warn("Failed to relocate thumbnail for video {}", videoId, e);
        }
    }
}
