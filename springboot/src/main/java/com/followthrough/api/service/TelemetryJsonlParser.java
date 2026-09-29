package com.followthrough.api.service;

import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Reads the JSONL telemetry file follow_through_batch_gpu (see
 * cpp/follow-through-batch.cpp) produces:
 * one {@code metadata} line (fps, source resolution) followed by
 * {@code frame}/{@code shot_event} lines in the same schema
 * cpp/follow-through-webrtc.cpp already sends live sessions. Pure --
 * given the same lines, always produces the same result, no I/O of its
 * own -- so this can be fully exercised with plain string fixtures
 * instead of a real subprocess.
 */
@Component
public class TelemetryJsonlParser {

    private final ObjectMapper objectMapper;

    public TelemetryJsonlParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public record ParsedTelemetry(
            VideoProcessor.ProcessingResult result, double fps, List<JsonNode> messages) {
    }

    public ParsedTelemetry parse(List<String> lines) {
        List<JsonNode> nodes = new ArrayList<>();
        for (String line : lines) {
            if (!line.isBlank()) {
                nodes.add(objectMapper.readTree(line));
            }
        }
        return parseMessages(nodes);
    }

    /**
     * The same reading, over telemetry that has already been parsed once
     * and stored.
     *
     * <p>Exists so a session's aggregates can be recomputed from the
     * recordings it still has -- after one is deleted, say -- using the
     * very arithmetic that produced them, rather than a second
     * implementation that agrees with the first only by inspection.
     */
    public ParsedTelemetry parseMessages(List<JsonNode> nodes) {
        double fps = 0.0;
        List<JsonNode> messages = new ArrayList<>();
        int makes = 0;
        int misses = 0;
        double totalDistance = 0.0;
        double totalDuration = 0.0;
        double totalTimeToApex = 0.0;
        int completedShots = 0;

        for (JsonNode node : nodes) {
            String type = node.path("type").asString("");

            if ("metadata".equals(type)) {
                fps = node.path("fps").asDouble(0.0);
                continue;
            }

            messages.add(node);

            if ("shot_event".equals(type)) {
                makes = node.path("makes").asInt(makes);
                misses = node.path("misses").asInt(misses);
            } else if ("frame".equals(type) && isCompletedShotFrame(node)) {
                totalDistance += node.path("shot_distance_ft").asDouble();
                totalDuration += node.path("shot_duration").asDouble();
                totalTimeToApex += node.path("time_to_apex").asDouble();
                completedShots++;
            }
        }

        int analyzedShots = makes + misses;
        double shootingPercentage = analyzedShots > 0 ? 100.0 * makes / analyzedShots : 0.0;
        double avgShotDistance = completedShots > 0 ? totalDistance / completedShots : 0.0;
        double avgShotDuration = completedShots > 0 ? totalDuration / completedShots : 0.0;
        double avgTimeToApex = completedShots > 0 ? totalTimeToApex / completedShots : 0.0;

        VideoProcessor.ProcessingResult result =
                new VideoProcessor.ProcessingResult(
                        analyzedShots, shootingPercentage, avgShotDistance, avgShotDuration, avgTimeToApex);
        return new ParsedTelemetry(result, fps, messages);
    }

    /** A frame only carries real shot metrics once a shot has actually
     * finished on it -- present (non-null) on exactly those frames. */
    private static boolean isCompletedShotFrame(JsonNode frame) {
        return isPresent(frame.path("shot_distance_ft"))
                && isPresent(frame.path("shot_duration"))
                && isPresent(frame.path("time_to_apex"));
    }

    private static boolean isPresent(JsonNode field) {
        return !field.isMissingNode() && !field.isNull();
    }
}
