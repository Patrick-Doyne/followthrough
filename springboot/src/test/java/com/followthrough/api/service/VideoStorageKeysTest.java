package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * One rule for the files that belong to a recording. It used to be
 * written out wherever it was needed, which is how a delete comes to
 * leave files behind: the rule that names them lives somewhere the
 * deleter never read.
 */
class VideoStorageKeysTest {

    @Test
    void derivesBothCompanionsFromTheUploadsOwnKey() {
        assertThat(VideoStorageKeys.playback("sessions/s1/rec.mp4"))
                .isEqualTo("sessions/s1/rec-playback.mp4");
        assertThat(VideoStorageKeys.thumbnail("sessions/s1/rec.mp4"))
                .isEqualTo("sessions/s1/rec-thumbnail.jpg");
    }

    @Test
    void replacesWhateverExtensionTheUploadArrivedWith() {
        for (String key : new String[] {"a/b/c.mov", "a/b/c.webm", "a/b/c.bin", "a/b/c.mkv"}) {
            assertThat(VideoStorageKeys.thumbnail(key)).endsWith("/c-thumbnail.jpg");
            assertThat(VideoStorageKeys.playback(key)).endsWith("/c-playback.mp4");
        }
    }

    @Test
    void doesNotMistakeADottedDirectoryForAnExtension() {
        // Only the last segment's extension is a extension.
        assertThat(VideoStorageKeys.thumbnail("a.b/c/rec.mp4")).isEqualTo("a.b/c/rec-thumbnail.jpg");
    }
}
