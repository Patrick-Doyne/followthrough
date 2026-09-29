package com.followthrough.api.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Stand-in for a real S3 presigner until AWS is actually wired up (no
 * credentials/bucket exist in this local dev environment yet). Returns the
 * same shape a real presigned URL response would have -- a URL plus a real
 * expiration -- so callers above this interface don't need to change when
 * this gets replaced with a real S3PlaybackUrlService later.
 *
 * <p>If a recording was actually uploaded through LocalBlobStorageController
 * for this storage key, that real file is served back; otherwise (e.g. the
 * seeded demo videos, which were never really uploaded anywhere) this falls
 * back to a fixed sample video so the player still has something to show.
 */
@Service
public class LocalPlaybackUrlService implements PlaybackUrlService {

    private static final Duration TTL = Duration.ofMinutes(15);
    private static final String SAMPLE_VIDEO_URL =
            "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";

    private final Path storageRoot;
    private final String baseUrl;

    public LocalPlaybackUrlService(
            @Value("${followthrough.storage.local.directory}") String directory,
            @Value("${followthrough.storage.local.base-url}") String baseUrl) {
        this.storageRoot = Path.of(directory).toAbsolutePath().normalize();
        this.baseUrl = baseUrl;
    }

    @Override
    public PlaybackUrl generate(String storageKey) {
        Path localFile = storageRoot.resolve(storageKey).normalize();
        if (localFile.startsWith(storageRoot) && Files.isRegularFile(localFile)) {
            return new PlaybackUrl(baseUrl + "/videos/local-blob/" + storageKey, Instant.now().plus(TTL));
        }
        return new PlaybackUrl(SAMPLE_VIDEO_URL, Instant.now().plus(TTL));
    }
}
