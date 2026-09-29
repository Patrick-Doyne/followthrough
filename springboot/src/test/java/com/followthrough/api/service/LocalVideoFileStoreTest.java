package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LocalVideoFileStoreTest {

    @Test
    void deletesTheFileAtTheKey(@TempDir Path root) throws IOException {
        Path file = root.resolve("sessions/s1/rec.mp4");
        Files.createDirectories(file.getParent());
        Files.writeString(file, "bytes");

        assertThat(new LocalVideoFileStore(root.toString()).delete("sessions/s1/rec.mp4")).isTrue();
        assertThat(file).doesNotExist();
    }

    @Test
    void treatsAMissingFileAsNothingToDo() {
        // A recording legitimately has no playback copy when the browser
        // could already play it, and no thumbnail when detection found
        // nothing. Throwing on either would fail a delete halfway.
        assertThat(new LocalVideoFileStore("target/does-not-exist").delete("sessions/s1/nope.mp4"))
                .isFalse();
    }

    @Test
    void ignoresAnEmptyKeyRatherThanResolvingTheStorageRootItself() {
        // playbackStorageKey is null for most recordings; resolving "" would
        // hand Files.delete the whole storage directory.
        LocalVideoFileStore store = new LocalVideoFileStore("target/test-file-store");
        assertThat(store.delete(null)).isFalse();
        assertThat(store.delete("")).isFalse();
        assertThat(store.delete("   ")).isFalse();
    }

    @Test
    void refusesAKeyThatClimbsOutOfTheStorageRoot(@TempDir Path root) throws IOException {
        Path outside = root.resolve("outside.txt");
        Files.writeString(outside, "not yours");
        Path storage = root.resolve("storage");
        Files.createDirectories(storage);

        assertThat(new LocalVideoFileStore(storage.toString()).delete("../outside.txt")).isFalse();
        assertThat(outside).exists();
    }
}
