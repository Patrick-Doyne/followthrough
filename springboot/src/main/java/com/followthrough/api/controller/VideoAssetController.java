package com.followthrough.api.controller;

import com.followthrough.api.dto.common.PageResponse;
import com.followthrough.api.dto.video.PlaybackUrlResponse;
import com.followthrough.api.dto.video.UploadUrlRequest;
import com.followthrough.api.dto.video.UploadUrlResponse;
import com.followthrough.api.dto.video.VideoAssetResponse;
import com.followthrough.api.dto.video.VideoAssetUpdateRequest;
import com.followthrough.api.dto.video.VideoTelemetryResponse;
import com.followthrough.api.service.VideoAssetService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/videos")
public class VideoAssetController {

    private final VideoAssetService videoService;

    public VideoAssetController(VideoAssetService videoService) {
        this.videoService = videoService;
    }

    @GetMapping
    public PageResponse<VideoAssetResponse> list(@PageableDefault(size = 20) Pageable pageable) {
        return videoService.list(pageable);
    }

    @GetMapping("/{videoId}")
    public VideoAssetResponse get(@PathVariable String videoId) {
        return videoService.get(videoId);
    }

    @PutMapping("/{videoId}")
    public VideoAssetResponse update(
            @PathVariable String videoId, @Valid @RequestBody VideoAssetUpdateRequest request) {
        return videoService.update(videoId, request);
    }

    @DeleteMapping("/{videoId}")
    public ResponseEntity<Void> delete(@PathVariable String videoId) {
        videoService.delete(videoId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{videoId}/telemetry")
    public VideoTelemetryResponse telemetry(@PathVariable String videoId) {
        return videoService.getTelemetry(videoId);
    }

    /** Fetch fresh right before playback -- never cache/store the result,
     * it's short-lived by design (see PlaybackUrlService). */
    @GetMapping("/{videoId}/playback-url")
    public PlaybackUrlResponse playbackUrl(@PathVariable String videoId) {
        return videoService.getPlaybackUrl(videoId);
    }

    /** Called by the frontend right as a live session ends (before it PUTs
     * the recording and then POSTs /sessions/{sessionId}/videos to ingest
     * it), and as soon as a file is picked for upload (before it PUTs the
     * file and then POSTs /sessions/{sessionId}/videos/process). */
    @PostMapping("/upload-url")
    public UploadUrlResponse uploadUrl(@Valid @RequestBody UploadUrlRequest request) {
        return videoService.getUploadUrl(request);
    }
}
