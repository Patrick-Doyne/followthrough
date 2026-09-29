package com.followthrough.api.service;

import java.util.List;
import java.util.Optional;
import tools.jackson.databind.JsonNode;

/**
 * Persists a video's full telemetry stream. RelationalTelemetryStore is
 * the local stand-in (a row in the existing relational DB); a real
 * per-video NoSQL document store is the intended eventual replacement --
 * nothing above this interface needs to change when that swap happens,
 * matching the same pattern already used for UploadUrlService/
 * PlaybackUrlService/VideoProcessor.
 */
public interface TelemetryStore {

    void save(String videoId, double fps, List<JsonNode> messages);

    /**
     * Drops a recording's telemetry.
     *
     * <p>Needed because this is keyed by video id rather than related to
     * the video row, so nothing cascades: without it, deleting a
     * recording left its telemetry behind for good, and telemetry is the
     * largest thing stored per video.
     */
    void delete(String videoId);

    Optional<TelemetryBundle> load(String videoId);

    record TelemetryBundle(double fps, List<JsonNode> messages) {
    }
}
