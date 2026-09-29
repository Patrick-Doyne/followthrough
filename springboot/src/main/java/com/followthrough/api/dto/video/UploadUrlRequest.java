package com.followthrough.api.dto.video;

import jakarta.validation.constraints.NotBlank;

/**
 * What the frontend POSTs to /videos/upload-url right as a live session
 * ends (or as soon as a file is picked for upload), to get somewhere to
 * PUT the recording.
 * contentType is optional -- if omitted, the storage key is just given a
 * default extension.
 */
public record UploadUrlRequest(@NotBlank String sessionId, String contentType) {
}
