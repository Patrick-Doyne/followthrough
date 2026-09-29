package com.followthrough.api.controller;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Local stand-in for S3 object storage. LocalUploadUrlService hands the
 * browser a URL under this controller instead of a real presigned S3 PUT
 * URL, and LocalPlaybackUrlService reads back through here too, so the
 * record -> upload -> ingest -> playback loop is genuinely exercised end to
 * end in local dev. Delete this whole controller once a real S3 bucket
 * exists -- nothing above the UploadUrlService/PlaybackUrlService interfaces
 * needs to know it's gone.
 */
@RestController
@RequestMapping("/videos/local-blob")
public class LocalBlobStorageController {

    private final Path storageRoot;

    public LocalBlobStorageController(@Value("${followthrough.storage.local.directory}") String directory) {
        this.storageRoot = Path.of(directory).toAbsolutePath().normalize();
    }

    /**
     * Callers must send a real Content-Type (a real presigned S3 PUT would
     * require this too). Without one, Spring's FormContentFilter treats the
     * PUT as form-urlencoded and consumes the body before this method ever
     * sees it, silently writing an empty file -- so a mismatched byte count
     * fails loudly here rather than reporting success on a truncated
     * recording. Browsers never hit this: fetch(url, {body: someBlob}) sets
     * Content-Type from the Blob's own type automatically.
     */
    @PutMapping("/{*storageKey}")
    public ResponseEntity<Void> upload(@PathVariable String storageKey, HttpServletRequest request)
            throws IOException {
        Path target = resolve(storageKey);
        Files.createDirectories(target.getParent());
        long written;
        try (var in = request.getInputStream()) {
            written = Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
        long expected = request.getContentLengthLong();
        if (expected > 0 && written != expected) {
            Files.deleteIfExists(target);
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Upload body was empty or truncated (wrote " + written + " of " + expected
                            + " bytes) -- make sure the PUT request sets a real Content-Type");
        }
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{*storageKey}")
    public ResponseEntity<Resource> download(@PathVariable String storageKey) {
        Path target = resolve(storageKey);
        if (!Files.isRegularFile(target)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No local recording at " + storageKey);
        }
        return ResponseEntity.ok().contentType(mediaTypeFor(storageKey)).body(new FileSystemResource(target));
    }

    /**
     * The media type to serve a stored blob as.
     *
     * <p>Everything here used to go out as application/octet-stream. It
     * mostly worked, because browsers sniff media, but it cost two real
     * things. A &lt;video&gt; element is entitled to refuse a response
     * whose type says it is not video, and a byte-range request -- which
     * is how seeking works at all -- is on much firmer ground when the
     * type is honest. And an error on this route could not be rendered:
     * Spring had already pinned the response to octet-stream, so writing
     * a ProblemDetail threw HttpMessageNotWritableException and a clean
     * 404 surfaced as a 500.
     *
     * <p>Keyed off the extension rather than by sniffing the file, because
     * this is a local stand-in for S3 object metadata, which is exactly
     * what a real bucket would be returning here.
     */
    static MediaType mediaTypeFor(String storageKey) {
        String key = storageKey.toLowerCase(java.util.Locale.ROOT);
        // .mov shares MP4's container family, and video/mp4 is what
        // browsers accept for H.264 inside one.
        if (key.endsWith(".mp4") || key.endsWith(".m4v") || key.endsWith(".mov")) {
            return MediaType.valueOf("video/mp4");
        }
        if (key.endsWith(".webm")) {
            return MediaType.valueOf("video/webm");
        }
        if (key.endsWith(".jpg") || key.endsWith(".jpeg")) {
            return MediaType.IMAGE_JPEG;
        }
        if (key.endsWith(".png")) {
            return MediaType.IMAGE_PNG;
        }
        return MediaType.APPLICATION_OCTET_STREAM;
    }

    /** Package-private (not private) so the leading-slash-stripping branch
     * -- always exercised in practice via Spring's {*storageKey} capture,
     * which always includes the leading slash -- can still be exercised
     * directly by a same-package test for full branch coverage. */
    Path resolve(String storageKey) {
        String key = storageKey.startsWith("/") ? storageKey.substring(1) : storageKey;
        Path target = storageRoot.resolve(key).normalize();
        if (!target.startsWith(storageRoot)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid storage key");
        }
        return target;
    }
}
