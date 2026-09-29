package com.followthrough.api.dto.video;

import java.util.List;
import tools.jackson.databind.JsonNode;

/** The full ordered frame/shot_event telemetry stream for a processed
 * video (see TelemetryStore) -- the same schema cpp/follow-through-webrtc.cpp
 * sends live sessions. fps lets a consumer convert a message's frame_id
 * into a video-time offset. */
public record VideoTelemetryResponse(double fps, List<JsonNode> messages) {
}
