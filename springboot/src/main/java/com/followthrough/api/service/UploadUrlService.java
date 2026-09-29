package com.followthrough.api.service;

/**
 * Issues a short-lived URL the browser can PUT a finished recording to
 * directly, bypassing this backend for the actual video bytes. Mirrors
 * PlaybackUrlService's shape so a real S3 presigner can be swapped in later
 * without callers above this interface changing.
 */
public interface UploadUrlService {

    UploadUrl generate(String sessionId, String contentType);
}
