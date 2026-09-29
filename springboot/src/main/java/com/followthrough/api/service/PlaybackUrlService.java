package com.followthrough.api.service;

/**
 * Turns a stored S3 object key into a short-lived, playable URL. Never
 * store the result -- generate one fresh right before playback, since a
 * real presigned URL expires and a stored copy would eventually stop
 * working with no warning.
 */
public interface PlaybackUrlService {

    PlaybackUrl generate(String storageKey);
}
