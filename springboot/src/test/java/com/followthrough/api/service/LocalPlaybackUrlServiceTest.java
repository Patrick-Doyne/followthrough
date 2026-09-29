package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LocalPlaybackUrlServiceTest {

    @TempDir private Path storageRoot;

    @Test
    void fallsBackToTheSampleVideoWhenNoLocalFileExistsForTheKey() {
        var service = new LocalPlaybackUrlService(storageRoot.toString(), "http://localhost:8082/api/v1");

        PlaybackUrl result = service.generate("sessions/session-001/recording.mp4");

        assertThat(result.url()).contains("googleapis.com");
        assertThat(result.expiresAt()).isAfter(java.time.Instant.now());
    }

    @Test
    void fallsBackToTheSampleVideoWhenTheKeyTriesToEscapeTheStorageRoot() {
        var service = new LocalPlaybackUrlService(storageRoot.toString(), "http://localhost:8082/api/v1");

        PlaybackUrl result = service.generate("../../../etc/passwd");

        assertThat(result.url()).contains("googleapis.com");
    }

    @Test
    void servesTheRealFileWhenOneWasActuallyUploadedForThatKey() throws IOException {
        String storageKey = "sessions/session-001/recording.mp4";
        Path uploaded = storageRoot.resolve(storageKey);
        Files.createDirectories(uploaded.getParent());
        Files.writeString(uploaded, "fake recording bytes");
        var service = new LocalPlaybackUrlService(storageRoot.toString(), "http://localhost:8082/api/v1");

        PlaybackUrl result = service.generate(storageKey);

        assertThat(result.url())
                .isEqualTo("http://localhost:8082/api/v1/videos/local-blob/" + storageKey);
    }
}
