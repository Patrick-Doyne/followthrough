package com.followthrough.api.controller;

import com.followthrough.api.dto.session.TrainingSessionRequest;
import com.followthrough.api.dto.session.TrainingSessionResponse;
import com.followthrough.api.dto.video.VideoAssetResponse;
import com.followthrough.api.dto.video.VideoIngestRequest;
import com.followthrough.api.dto.video.VideoProcessingRequest;
import com.followthrough.api.service.TrainingSessionService;
import com.followthrough.api.service.VideoAssetService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/sessions")
public class TrainingSessionController {

    private final TrainingSessionService sessionService;
    private final VideoAssetService videoService;

    public TrainingSessionController(
            TrainingSessionService sessionService, VideoAssetService videoService) {
        this.sessionService = sessionService;
        this.videoService = videoService;
    }

    @GetMapping
    public List<TrainingSessionResponse> list() {
        return sessionService.list();
    }

    @GetMapping("/{sessionId}")
    public TrainingSessionResponse get(@PathVariable String sessionId) {
        return sessionService.get(sessionId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TrainingSessionResponse create(@Valid @RequestBody TrainingSessionRequest request) {
        return sessionService.create(request);
    }

    @PutMapping("/{sessionId}")
    public TrainingSessionResponse update(
            @PathVariable String sessionId, @Valid @RequestBody TrainingSessionRequest request) {
        return sessionService.update(sessionId, request);
    }

    @DeleteMapping("/{sessionId}")
    public ResponseEntity<Void> delete(@PathVariable String sessionId) {
        sessionService.delete(sessionId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{sessionId}/videos")
    public List<VideoAssetResponse> videos(@PathVariable String sessionId) {
        return videoService.listBySession(sessionId);
    }

    /** Called by the frontend once it has uploaded a session's overlay
     * recording to S3 -- see VideoIngestRequest. */
    @PostMapping("/{sessionId}/videos")
    @ResponseStatus(HttpStatus.CREATED)
    public VideoAssetResponse ingestVideo(
            @PathVariable String sessionId, @Valid @RequestBody VideoIngestRequest request) {
        return videoService.ingest(sessionId, request);
    }

    /** For a pre-recorded file the frontend couldn't live-stream -- stats
     * aren't known yet, so this returns a QUEUED video immediately and lets
     * offline processing (see VideoProcessingRunner) fill them in. */
    @PostMapping("/{sessionId}/videos/process")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public VideoAssetResponse processVideo(
            @PathVariable String sessionId, @Valid @RequestBody VideoProcessingRequest request) {
        return videoService.startProcessing(sessionId, request);
    }
}
