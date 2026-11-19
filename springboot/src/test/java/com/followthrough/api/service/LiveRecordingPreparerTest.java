package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Drives the preparer with the same fixture scripts CppVideoProcessorTest
 * uses in place of the Node preparation script, so what is checked is the
 * plumbing: the telemetry handed over as JSONL, the script's outputs
 * relocated the way an upload's are, and the video marked complete whether
 * or not a tile came out.
 */
class LiveRecordingPreparerTest {

    private static final Path FIXTURES = Path.of("src/test/resources/fixtures").toAbsolutePath();
    private static final String STORAGE_KEY = "sessions/session-live/recording.webm";

    @TempDir Path storage;
    @TempDir Path temp;

    @BeforeAll
    static void makeFixturesExecutable() throws IOException {
        try (var files = Files.list(FIXTURES)) {
            for (Path script : files.toList()) {
                Files.setPosixFilePermissions(script, PosixFilePermissions.fromString("rwxr-xr-x"));
            }
        }
    }

    private static TelemetryStore storeWith(List<JsonNode> messages) {
        return new TelemetryStore() {
            @Override
            public void save(String videoId, double fps, List<JsonNode> ignored) {}

            @Override
            public void delete(String videoId) {}

            @Override
            public Optional<TelemetryBundle> load(String videoId) {
                return messages == null ? Optional.empty() : Optional.of(new TelemetryBundle(30.0, messages));
            }
        };
    }

    private LiveRecordingPreparer preparer(
            VideoProcessingTransactions transactions, TelemetryStore store, String prepareScript) {
        return preparer(transactions, store, prepareScript, 1);
    }

    private LiveRecordingPreparer preparer(
            VideoProcessingTransactions transactions, TelemetryStore store, String prepareScript, long timeoutMinutes) {
        VideoProcessingRunner runner =
                new VideoProcessingRunner(
                        transactions,
                        file -> {
                            throw new UnsupportedOperationException("offline processing is not used here");
                        },
                        store,
                        storage.toString(),
                        "http://api.test/api/v1");
        return new LiveRecordingPreparer(
                transactions,
                store,
                runner,
                new JsonMapper(),
                List.of("bash"),
                FIXTURES.resolve(prepareScript).toString(),
                FIXTURES.toString(),
                timeoutMinutes,
                storage.toString(),
                temp.toString());
    }

    private void placeRecording() throws IOException {
        Path recording = storage.resolve(STORAGE_KEY);
        Files.createDirectories(recording.getParent());
        Files.writeString(recording, "fake recording bytes");
    }

    @Test
    void relocatesTheThumbnailBesideTheRecordingAndMarksTheVideoComplete() throws Exception {
        placeRecording();
        VideoProcessingTransactions transactions = mock(VideoProcessingTransactions.class);
        when(transactions.getStorageKey("video-live")).thenReturn(STORAGE_KEY);
        JsonMapper mapper = new JsonMapper();
        List<JsonNode> messages =
                List.of(
                        mapper.readTree("{\"type\":\"frame\",\"frame_id\":0,\"frame_width\":1920,\"frame_height\":1080}"),
                        mapper.readTree(
                                "{\"type\":\"frame\",\"frame_id\":45,\"frame_width\":1920,\"frame_height\":1080,\"apex_point\":{\"x\":1,\"y\":2}}"));

        preparer(transactions, storeWith(messages), "fake-prepare.sh").prepare("video-live");

        String thumbnailKey = VideoStorageKeys.thumbnail(STORAGE_KEY);
        assertThat(storage.resolve(thumbnailKey)).exists();
        assertThat(Files.readString(storage.resolve(thumbnailKey))).isEqualTo("fake thumbnail bytes\n");
        verify(transactions).setThumbnailUrl("video-live", "http://api.test/api/v1/videos/local-blob/" + thumbnailKey);
        verify(transactions).markComplete("video-live");
        // The recording itself is untouched and the temporary telemetry file is gone.
        assertThat(Files.readString(storage.resolve(STORAGE_KEY))).isEqualTo("fake recording bytes");
        try (var leftovers = Files.list(temp)) {
            assertThat(leftovers.toList()).isEmpty();
        }
    }

    @Test
    void aScriptThatProducesNoThumbnailStillLeavesTheVideoComplete() throws Exception {
        placeRecording();
        VideoProcessingTransactions transactions = mock(VideoProcessingTransactions.class);
        when(transactions.getStorageKey("video-live")).thenReturn(STORAGE_KEY);
        JsonMapper mapper = new JsonMapper();
        List<JsonNode> messages =
                List.of(mapper.readTree("{\"type\":\"frame\",\"frame_id\":0,\"frame_width\":1920,\"frame_height\":1080}"));

        preparer(transactions, storeWith(messages), "fake-prepare-no-thumbnail.sh").prepare("video-live");

        verify(transactions, never()).setThumbnailUrl(anyString(), anyString());
        verify(transactions).markComplete("video-live");
    }

    @Test
    void missingTelemetryMeansNoScriptRunAndStillComplete() {
        VideoProcessingTransactions transactions = mock(VideoProcessingTransactions.class);
        when(transactions.getStorageKey("video-live")).thenReturn(STORAGE_KEY);

        preparer(transactions, storeWith(null), "fake-prepare.sh").prepare("video-live");

        verify(transactions, never()).setThumbnailUrl(anyString(), anyString());
        verify(transactions).markComplete("video-live");
    }

    private static List<JsonNode> oneFrame() throws Exception {
        return List.of(new JsonMapper().readTree("{\"type\":\"frame\",\"frame_id\":0,\"frame_width\":1920,\"frame_height\":1080}"));
    }

    private static VideoProcessingTransactions transactionsFor(String storageKey) {
        VideoProcessingTransactions transactions = mock(VideoProcessingTransactions.class);
        when(transactions.getStorageKey("video-live")).thenReturn(storageKey);
        return transactions;
    }

    @Test
    void prepareAsyncDoesTheSameWorkAsPrepare() throws Exception {
        placeRecording();
        VideoProcessingTransactions transactions = transactionsFor(STORAGE_KEY);

        preparer(transactions, storeWith(oneFrame()), "fake-prepare.sh").prepareAsync("video-live");

        assertThat(storage.resolve(VideoStorageKeys.thumbnail(STORAGE_KEY))).exists();
        verify(transactions).markComplete("video-live");
    }

    @Test
    void aVideoThatIsGoneIsOnlyMarkedComplete() {
        VideoProcessingTransactions transactions = transactionsFor(null);

        preparer(transactions, storeWith(List.of()), "fake-prepare.sh").prepare("video-live");

        verify(transactions, never()).setThumbnailUrl(anyString(), anyString());
        verify(transactions).markComplete("video-live");
    }

    @Test
    void aPlaybackCopyFromTheScriptIsRelocatedToo() throws Exception {
        placeRecording();
        VideoProcessingTransactions transactions = transactionsFor(STORAGE_KEY);

        preparer(transactions, storeWith(oneFrame()), "fake-prepare-with-playback.sh").prepare("video-live");

        verify(transactions).setPlaybackStorageKey(anyString(), anyString());
        verify(transactions).markComplete("video-live");
    }

    @Test
    void telemetryWithoutAFrameStillRunsTheScript() throws Exception {
        placeRecording();
        VideoProcessingTransactions transactions = transactionsFor(STORAGE_KEY);
        List<JsonNode> shotOnly = List.of(new JsonMapper().readTree("{\"type\":\"shot_event\",\"frame_id\":10}"));

        preparer(transactions, storeWith(shotOnly), "fake-prepare.sh").prepare("video-live");

        assertThat(storage.resolve(VideoStorageKeys.thumbnail(STORAGE_KEY))).exists();
        verify(transactions).markComplete("video-live");
    }

    @Test
    void aFailingScriptLeavesNoThumbnailAndStillCompletes() throws Exception {
        placeRecording();
        VideoProcessingTransactions transactions = transactionsFor(STORAGE_KEY);

        preparer(transactions, storeWith(oneFrame()), "fake-prepare-fail.sh").prepare("video-live");

        verify(transactions, never()).setThumbnailUrl(anyString(), anyString());
        verify(transactions).markComplete("video-live");
    }

    @Test
    void aScriptThatOutlivesTheTimeoutIsStoppedAndTheVideoCompletes() throws Exception {
        placeRecording();
        VideoProcessingTransactions transactions = transactionsFor(STORAGE_KEY);

        // A zero-minute budget: the script closes its output and keeps running.
        preparer(transactions, storeWith(oneFrame()), "fake-prepare-hang.sh", 0).prepare("video-live");

        verify(transactions, never()).setThumbnailUrl(anyString(), anyString());
        verify(transactions).markComplete("video-live");
    }

    @Test
    void anUnexpectedFailureIsContainedAndTheVideoCompletes() {
        VideoProcessingTransactions transactions = mock(VideoProcessingTransactions.class);
        when(transactions.getStorageKey("video-live")).thenThrow(new IllegalStateException("database unavailable"));

        preparer(transactions, storeWith(List.of()), "fake-prepare.sh").prepare("video-live");

        verify(transactions).markComplete("video-live");
    }

    @Test
    void anInterruptStopsTheWaitKeepsTheInterruptAndStillCompletes() throws Exception {
        placeRecording();
        VideoProcessingTransactions transactions = transactionsFor(STORAGE_KEY);
        Thread.currentThread().interrupt();
        try {
            preparer(transactions, storeWith(oneFrame()), "fake-prepare.sh").prepare("video-live");
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
        verify(transactions).markComplete("video-live");
    }
}
