package com.followthrough.api.service;

import java.time.Instant;

public record UploadUrl(String uploadUrl, String storageKey, Instant expiresAt) {
}
