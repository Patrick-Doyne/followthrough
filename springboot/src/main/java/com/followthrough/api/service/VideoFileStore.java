package com.followthrough.api.service;

/**
 * Removing a stored recording's bytes.
 *
 * <p>The counterpart to UploadUrlService and PlaybackUrlService, and an
 * interface for the same reason: this is a local stand-in for object
 * storage, and the day it becomes a real bucket nothing above this line
 * should have to change.
 */
public interface VideoFileStore {

    /**
     * Deletes the object at `storageKey`, if it is there.
     *
     * <p>Missing is not an error. A recording can legitimately have no
     * thumbnail or no playback copy, and a delete that threw on their
     * absence would fail halfway and leave the rest behind.
     *
     * @return true when a file was actually removed
     */
    boolean delete(String storageKey);
}
