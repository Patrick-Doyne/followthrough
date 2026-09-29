package com.followthrough.api.dto.video;

import java.time.Instant;

public record UploadUrlResponse(String uploadUrl, String storageKey, Instant expiresAt) {
}
