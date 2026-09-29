package com.followthrough.api.service;

import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.domain.VideoAsset;
import com.followthrough.api.dto.common.PageResponse;
import com.followthrough.api.dto.video.PlaybackUrlResponse;
import com.followthrough.api.dto.video.UploadUrlRequest;
import com.followthrough.api.dto.video.UploadUrlResponse;
import com.followthrough.api.dto.video.VideoAssetResponse;
import com.followthrough.api.dto.video.VideoAssetUpdateRequest;
import com.followthrough.api.dto.video.VideoIngestRequest;
import com.followthrough.api.dto.video.VideoProcessingRequest;
import com.followthrough.api.dto.video.VideoTelemetryResponse;
import com.followthrough.api.exception.ResourceNotFoundException;
import com.followthrough.api.repository.TrainingSessionRepository;
import com.followthrough.api.repository.VideoAssetRepository;
import com.followthrough.api.security.CurrentUser;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Every query here is scoped to the caller's own account -- a video (via
 * its session) or a session id that exists but belongs to someone else
 * looks identical to one that doesn't exist at all (see CurrentUser). */
@Service
@Transactional(readOnly = true)
public class VideoAssetService {

    private final VideoAssetRepository videoRepository;
    private final TrainingSessionRepository sessionRepository;
    private final PlaybackUrlService playbackUrlService;
    private final UploadUrlService uploadUrlService;
    private final VideoProcessingRunner videoProcessingRunner;
    private final TelemetryStore telemetryStore;
    private final VideoFileStore videoFileStore;
    private final TelemetryJsonlParser telemetryParser;
    private final CurrentUser currentUser;

    public VideoAssetService(
            VideoAssetRepository videoRepository,
            TrainingSessionRepository sessionRepository,
            PlaybackUrlService playbackUrlService,
            UploadUrlService uploadUrlService,
            VideoProcessingRunner videoProcessingRunner,
            TelemetryStore telemetryStore,
            VideoFileStore videoFileStore,
            TelemetryJsonlParser telemetryParser,
            CurrentUser currentUser) {
        this.videoRepository = videoRepository;
        this.sessionRepository = sessionRepository;
        this.playbackUrlService = playbackUrlService;
        this.uploadUrlService = uploadUrlService;
        this.videoProcessingRunner = videoProcessingRunner;
        this.telemetryStore = telemetryStore;
        this.videoFileStore = videoFileStore;
        this.telemetryParser = telemetryParser;
        this.currentUser = currentUser;
    }

    public PageResponse<VideoAssetResponse> list(Pageable pageable) {
        return PageResponse.of(
                videoRepository.findAllBySession_User_UserIdOrderByDateDesc(currentUser.userId(), pageable),
                VideoAssetService::toResponse);
    }

    public VideoAssetResponse get(String videoId) {
        return toResponse(findVideoOrThrow(videoId));
    }

    public List<VideoAssetResponse> listBySession(String sessionId) {
        return videoRepository
                .findBySession_SessionIdAndSession_User_UserId(sessionId, currentUser.userId())
                .stream()
                .map(VideoAssetService::toResponse)
                .toList();
    }

    /** 404s if this video hasn't finished processing yet (or processing
     * never persisted telemetry -- e.g. StubVideoProcessor never does). */
    public VideoTelemetryResponse getTelemetry(String videoId) {
        findVideoOrThrow(videoId);
        TelemetryStore.TelemetryBundle bundle =
                telemetryStore
                        .load(videoId)
                        .orElseThrow(
                                () -> new ResourceNotFoundException("No telemetry for video " + videoId));
        return new VideoTelemetryResponse(bundle.fps(), bundle.messages());
    }

    public PlaybackUrlResponse getPlaybackUrl(String videoId) {
        VideoAsset video = findVideoOrThrow(videoId);
        // Not getStorageKey(): an HEVC upload is stored untouched and no
        // browser can decode it, so what gets played is the H.264 copy
        // written beside it. See VideoAsset.playbackStorageKey.
        PlaybackUrl playbackUrl = playbackUrlService.generate(video.getPlayableStorageKey());
        return new PlaybackUrlResponse(playbackUrl.url(), playbackUrl.expiresAt());
    }

    public UploadUrlResponse getUploadUrl(UploadUrlRequest request) {
        if (!sessionRepository.existsBySessionIdAndUser_UserId(request.sessionId(), currentUser.userId())) {
            throw new ResourceNotFoundException("Session " + request.sessionId() + " not found");
        }
        UploadUrl uploadUrl = uploadUrlService.generate(request.sessionId(), request.contentType());
        return new UploadUrlResponse(uploadUrl.uploadUrl(), uploadUrl.storageKey(), uploadUrl.expiresAt());
    }

    @Transactional
    public VideoAssetResponse ingest(String sessionId, VideoIngestRequest request) {
        TrainingSession session =
                sessionRepository
                        .findBySessionIdAndUser_UserId(sessionId, currentUser.userId())
                        .orElseThrow(
                                () -> new ResourceNotFoundException("Session " + sessionId + " not found"));

        VideoAsset video =
                new VideoAsset(
                        UUID.randomUUID().toString(),
                        session,
                        request.title(),
                        request.date(),
                        request.durationSeconds(),
                        request.status() != null ? request.status() : ProcessingStatus.COMPLETE,
                        request.analyzedShots(),
                        request.shootingPercentage(),
                        request.thumbnailUrl(),
                        request.storageKey(),
                        request.sizeMb());

        return toResponse(videoRepository.save(video));
    }

    /** Creates a QUEUED video row immediately and kicks off offline
     * processing in the background (see VideoProcessingRunner) -- for
     * when the stats aren't known yet, unlike ingest() where the frontend
     * already computed them client-side during a live session. */
    @Transactional
    public VideoAssetResponse startProcessing(String sessionId, VideoProcessingRequest request) {
        TrainingSession session =
                sessionRepository
                        .findBySessionIdAndUser_UserId(sessionId, currentUser.userId())
                        .orElseThrow(
                                () -> new ResourceNotFoundException("Session " + sessionId + " not found"));

        VideoAsset video =
                new VideoAsset(
                        UUID.randomUUID().toString(),
                        session,
                        request.title(),
                        request.date(),
                        request.durationSeconds(),
                        ProcessingStatus.QUEUED,
                        0,
                        0.0,
                        null,
                        request.storageKey(),
                        request.sizeMb());
        VideoAsset saved = videoRepository.save(video);
        String videoId = saved.getVideoId();

        // Defer the async dispatch until this transaction actually commits --
        // firing it immediately would let VideoProcessingRunner's worker
        // thread (its own connection, its own transaction) try to read a row
        // that this transaction hasn't made visible yet.
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        videoProcessingRunner.processAsync(videoId);
                    }
                });

        return toResponse(saved);
    }

    /** Only touches title/thumbnailUrl -- see VideoAssetUpdateRequest for
     * why the pipeline-computed fields aren't editable here. */
    @Transactional
    public VideoAssetResponse update(String videoId, VideoAssetUpdateRequest request) {
        VideoAsset video = findVideoOrThrow(videoId);
        video.setTitle(request.title());
        video.setThumbnailUrl(request.thumbnailUrl());
        return toResponse(video);
    }

    /**
     * Removes a recording and everything that was derived from it.
     *
     * <p>Permanent, and deliberately so: this is what the gallery's
     * delete does, and a viewer who has been told it cannot be undone
     * should not find the bytes still on the disk afterwards. Four things
     * belong to a recording and all four go:
     *
     * <ol>
     *   <li>the upload itself;
     *   <li>the browser-playable copy, when one was made;
     *   <li>the gallery thumbnail;
     *   <li>the telemetry, which is keyed by video id rather than related
     *       to the row, so nothing cascades and it would otherwise be
     *       orphaned for good -- and it is by far the largest of the four.
     * </ol>
     *
     * <p>The files are best effort and the row is not. A file left behind
     * is wasted disk; a row left behind is a recording in the library that
     * cannot be played.
     */
    @Transactional
    public void delete(String videoId) {
        VideoAsset video = findVideoOrThrow(videoId);
        TrainingSession session = video.getSession();

        videoFileStore.delete(video.getStorageKey());
        videoFileStore.delete(VideoStorageKeys.playback(video.getStorageKey()));
        videoFileStore.delete(VideoStorageKeys.thumbnail(video.getStorageKey()));
        telemetryStore.delete(videoId);
        videoRepository.delete(video);

        // Flushed before the session is recounted, or the query below still
        // sees the row that is on its way out.
        videoRepository.flush();
        recountSession(session);
    }

    /**
     * Rebuilds a session's totals from the recordings it still has.
     *
     * <p>The totals are accumulated as each video finishes, which is fine
     * until one is removed: there is nothing to subtract, because a
     * shot-count-weighted average cannot be unwound from its result. So
     * they are recomputed from scratch over what is left, through the same
     * parser that produced them in the first place.
     *
     * <p>Without this, deleting the only video of a session left the
     * session still claiming its shots -- visible immediately, since the
     * calendar and the session cards read these fields while the charts
     * read the telemetry that has just gone.
     */
    private void recountSession(TrainingSession session) {
        List<VideoAsset> remaining =
                videoRepository.findBySession_SessionIdAndSession_User_UserId(
                        session.getSessionId(), currentUser.userId());

        int shots = 0;
        int makes = 0;
        double distance = 0;
        double duration = 0;
        double apex = 0;
        int measured = 0;

        for (VideoAsset other : remaining) {
            var telemetry = telemetryStore.load(other.getVideoId());
            if (telemetry.isEmpty()) {
                // No telemetry to re-read: fall back to what the row
                // itself records, which is what the rollup used for the
                // counts anyway.
                shots += other.getAnalyzedShots();
                makes += Math.round((float) (other.getAnalyzedShots() * other.getShootingPercentage() / 100.0));
                continue;
            }
            var parsed = telemetryParser.parseMessages(telemetry.get().messages());
            var result = parsed.result();
            shots += result.analyzedShots();
            makes += Math.round((float) (result.analyzedShots() * result.shootingPercentage() / 100.0));
            distance += result.avgShotDistance() * result.analyzedShots();
            duration += result.avgShotDuration() * result.analyzedShots();
            apex += result.avgTimeToApex() * result.analyzedShots();
            measured += result.analyzedShots();
        }

        session.setShots(shots);
        session.setMakes(makes);
        session.setShootingPercentage(shots > 0 ? 100.0 * makes / shots : 0.0);
        session.setAvgShotDistance(measured > 0 ? distance / measured : 0.0);
        session.setAvgShotDuration(measured > 0 ? duration / measured : 0.0);
        session.setAvgTimeToApex(measured > 0 ? apex / measured : 0.0);
    }

    private VideoAsset findVideoOrThrow(String videoId) {
        return videoRepository
                .findByVideoIdAndSession_User_UserId(videoId, currentUser.userId())
                .orElseThrow(() -> new ResourceNotFoundException("Video " + videoId + " not found"));
    }

    private static VideoAssetResponse toResponse(VideoAsset video) {
        return new VideoAssetResponse(
                video.getVideoId(),
                video.getSession().getSessionId(),
                video.getTitle(),
                video.getDate(),
                video.getDurationSeconds(),
                video.getStatus(),
                video.getAnalyzedShots(),
                video.getShootingPercentage(),
                video.getThumbnailUrl(),
                video.getStorageKey(),
                video.getSizeMb());
    }
}
