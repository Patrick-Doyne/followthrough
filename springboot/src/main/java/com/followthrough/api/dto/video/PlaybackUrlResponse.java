package com.followthrough.api.dto.video;

import java.time.Instant;

public record PlaybackUrlResponse(String url, Instant expiresAt) {
}
