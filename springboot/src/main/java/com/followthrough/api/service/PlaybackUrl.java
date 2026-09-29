package com.followthrough.api.service;

import java.time.Instant;

public record PlaybackUrl(String url, Instant expiresAt) {
}
