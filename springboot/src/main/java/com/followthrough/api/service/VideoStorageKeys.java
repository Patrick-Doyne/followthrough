package com.followthrough.api.service;

/**
 * The keys that belong to one uploaded recording.
 *
 * <p>Processing writes two files beside the upload -- a gallery thumbnail
 * and, when the browser could not play what was uploaded, an H.264 copy --
 * and both take their name from the upload's own key. That derivation was
 * written out twice in VideoProcessingRunner and would have been written a
 * third time by anything that needed to clean up after a recording, which
 * is exactly how a delete comes to leave files behind: the rule that names
 * them lives somewhere the deleter never read.
 */
public final class VideoStorageKeys {

    private VideoStorageKeys() {
    }

    /** The browser-playable copy written beside an upload it cannot play. */
    public static String playback(String storageKey) {
        return stripExtension(storageKey) + "-playback.mp4";
    }

    /** The gallery tile. */
    public static String thumbnail(String storageKey) {
        return stripExtension(storageKey) + "-thumbnail.jpg";
    }

    private static String stripExtension(String storageKey) {
        return storageKey.replaceFirst("\\.[^.]+$", "");
    }
}
