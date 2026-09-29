package com.followthrough.api.service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Stand-in for a real S3 presigned-PUT-URL generator. There is no S3 bucket
 * in this local dev environment, so the "upload URL" it hands back points at
 * this same backend's own LocalBlobStorageController, which saves the bytes
 * to disk instead of a bucket -- close enough to exercise the real
 * record -> upload -> ingest -> playback flow end to end before AWS exists.
 */
@Service
public class LocalUploadUrlService implements UploadUrlService {

    private static final Duration TTL = Duration.ofMinutes(15);
    /**
     * The extension to store an upload under, by the content type the
     * client declared.
     *
     * <p>The stored key's extension is not cosmetic: it is what
     * LocalBlobStorageController serves the file back as, standing in for
     * the object metadata a real bucket would carry. Getting it wrong
     * means telling a browser a recording is something it is not.
     *
     * <p>QuickTime is here because that is what phones send, and it used
     * to fall through to the default below -- so a .mov arrived and was
     * stored as ".webm", which was a lie about a real file that a real
     * user uploaded.
     */
    private static final Map<String, String> EXTENSIONS_BY_CONTENT_TYPE =
            Map.of(
                    "video/webm", ".webm",
                    "video/mp4", ".mp4",
                    "video/quicktime", ".mov",
                    "video/x-m4v", ".m4v",
                    "video/x-matroska", ".mkv");

    /**
     * For a content type nobody here recognises.
     *
     * <p>Deliberately not a video extension. Guessing ".webm" -- which is
     * what this used to do -- produced a file whose name contradicted its
     * contents, and the only thing saving playback was that browsers sniff
     * media rather than trusting what they are told. A neutral extension
     * is served as application/octet-stream, which is honest: we do not
     * know, so we do not claim.
     */
    private static final String UNKNOWN_EXTENSION = ".bin";

    private final String baseUrl;

    public LocalUploadUrlService(@Value("${followthrough.storage.local.base-url}") String baseUrl) {
        this.baseUrl = baseUrl;
    }

    @Override
    public UploadUrl generate(String sessionId, String contentType) {
        String extension =
                EXTENSIONS_BY_CONTENT_TYPE.getOrDefault(
                        contentType == null ? "" : contentType.toLowerCase(java.util.Locale.ROOT),
                        UNKNOWN_EXTENSION);
        String storageKey = "sessions/%s/%s%s".formatted(sanitize(sessionId), UUID.randomUUID(), extension);
        String uploadUrl = baseUrl + "/videos/local-blob/" + storageKey;
        return new UploadUrl(uploadUrl, storageKey, Instant.now().plus(TTL));
    }

    private static String sanitize(String sessionId) {
        return sessionId.replaceAll("[^a-zA-Z0-9-]", "_");
    }
}
