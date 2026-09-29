package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** VideoProcessingRunner is a thin @Async orchestrator -- all the actual DB
 * work (and its correctness, including the shot-count roll-up math) is
 * covered by VideoProcessingTransactionsTest. This only checks that the
 * steps (mark processing -> run the processor -> apply/save/relocate
 * thumbnail/fail) are sequenced correctly. */
@ExtendWith(MockitoExtension.class)
class VideoProcessingRunnerTest {

    private static final String BASE_URL = "http://localhost:8082/api/v1";

    @Mock private VideoProcessingTransactions transactions;
    @Mock private VideoProcessor videoProcessor;
    @Mock private TelemetryStore telemetryStore;

    private VideoProcessingRunner runner(Path storageRoot) {
        return new VideoProcessingRunner(transactions, videoProcessor, telemetryStore, storageRoot.toString(), BASE_URL);
    }

    @Test
    void onSuccessMarksProcessingRunsTheProcessorAndAppliesTheResult(@TempDir Path storageRoot) {
        when(transactions.markProcessingAndGetStorageKey("video-001")).thenReturn("sessions/s/rec.mp4");
        VideoProcessor.ProcessingResult result =
                new VideoProcessor.ProcessingResult(10, 50.0, 12.0, 0.8, 0.4);
        VideoProcessor.ProcessingOutcome outcome =
                new VideoProcessor.ProcessingOutcome(result, 59.94, List.of(), null, null);
        when(videoProcessor.process(any())).thenReturn(outcome);

        runner(storageRoot).processAsync("video-001");

        verify(transactions).applyResult("video-001", result);
        verify(telemetryStore).save("video-001", 59.94, List.of());
        verify(transactions, never()).markFailed(any());
    }

    @Test
    void whenAThumbnailIsProducedItIsRelocatedIntoStorageAndItsUrlIsRecorded(@TempDir Path storageRoot)
            throws IOException {
        when(transactions.markProcessingAndGetStorageKey("video-001")).thenReturn("sessions/s1/rec.mp4");
        File thumbnail = Files.createTempFile("thumb-", ".jpg").toFile();
        Files.writeString(thumbnail.toPath(), "fake thumbnail bytes");
        VideoProcessor.ProcessingResult result = new VideoProcessor.ProcessingResult(1, 100.0, 1.0, 1.0, 1.0);
        when(videoProcessor.process(any()))
                .thenReturn(new VideoProcessor.ProcessingOutcome(result, 30.0, List.of(), thumbnail, null));

        runner(storageRoot).processAsync("video-001");

        verify(transactions)
                .setThumbnailUrl("video-001", BASE_URL + "/videos/local-blob/sessions/s1/rec-thumbnail.jpg");
        Path relocated = storageRoot.resolve("sessions/s1/rec-thumbnail.jpg");
        assertThat(relocated).exists();
        assertThat(Files.readString(relocated)).isEqualTo("fake thumbnail bytes");
        assertThat(thumbnail).doesNotExist(); // moved, not copied
    }

    @Test
    void whenAPlaybackCopyIsProducedItIsRelocatedBesideTheUploadAndRecorded(@TempDir Path storageRoot)
            throws IOException {
        when(transactions.markProcessingAndGetStorageKey("video-001")).thenReturn("sessions/s1/rec.mov");
        File playback = Files.createTempFile("playback-", ".mp4").toFile();
        Files.writeString(playback.toPath(), "fake h264 playback bytes");
        VideoProcessor.ProcessingResult result = new VideoProcessor.ProcessingResult(1, 100.0, 1.0, 1.0, 1.0);
        when(videoProcessor.process(any()))
                .thenReturn(new VideoProcessor.ProcessingOutcome(result, 30.0, List.of(), null, playback));

        runner(storageRoot).processAsync("video-001");

        // Beside the upload, under its own key -- the upload's storageKey
        // is never reassigned, so the original stays reachable.
        verify(transactions).setPlaybackStorageKey("video-001", "sessions/s1/rec-playback.mp4");
        Path relocated = storageRoot.resolve("sessions/s1/rec-playback.mp4");
        assertThat(relocated).exists();
        assertThat(Files.readString(relocated)).isEqualTo("fake h264 playback bytes");
        assertThat(playback).doesNotExist(); // moved, not copied
    }

    @Test
    void whenTheUploadIsAlreadyPlayableNoPlaybackKeyIsRecorded(@TempDir Path storageRoot) {
        when(transactions.markProcessingAndGetStorageKey("video-001")).thenReturn("sessions/s/rec.mp4");
        VideoProcessor.ProcessingResult result = new VideoProcessor.ProcessingResult(1, 100.0, 1.0, 1.0, 1.0);
        when(videoProcessor.process(any()))
                .thenReturn(new VideoProcessor.ProcessingOutcome(result, 30.0, List.of(), null, null));

        runner(storageRoot).processAsync("video-001");

        verify(transactions, never()).setPlaybackStorageKey(any(), any());
    }

    /**
     * Unlike a thumbnail, this one is not best-effort. A missing gallery
     * tile costs a tile; a missing playback copy for an upload no browser
     * can decode is a video that plays as a black rectangle, which is
     * worse than an honest failure.
     */
    @Test
    void whenThePlaybackCopyCannotBeRelocatedTheVideoIsMarkedFailed(@TempDir Path storageRoot) {
        when(transactions.markProcessingAndGetStorageKey("video-001")).thenReturn("sessions/s/rec.mov");
        File missingPlayback = new File(storageRoot.toFile(), "does-not-exist.mp4");
        VideoProcessor.ProcessingResult result = new VideoProcessor.ProcessingResult(1, 100.0, 1.0, 1.0, 1.0);
        when(videoProcessor.process(any()))
                .thenReturn(new VideoProcessor.ProcessingOutcome(result, 30.0, List.of(), null, missingPlayback));

        runner(storageRoot).processAsync("video-001");

        verify(transactions).markFailed("video-001");
        verify(transactions, never()).setPlaybackStorageKey(any(), any());
    }

    @Test
    void whenNoThumbnailIsProducedNothingIsRelocated(@TempDir Path storageRoot) {
        when(transactions.markProcessingAndGetStorageKey("video-001")).thenReturn("sessions/s/rec.mp4");
        VideoProcessor.ProcessingResult result = new VideoProcessor.ProcessingResult(1, 100.0, 1.0, 1.0, 1.0);
        when(videoProcessor.process(any()))
                .thenReturn(new VideoProcessor.ProcessingOutcome(result, 30.0, List.of(), null, null));

        runner(storageRoot).processAsync("video-001");

        verify(transactions, never()).setThumbnailUrl(any(), any());
    }

    @Test
    void whenTheThumbnailCannotBeRelocatedProcessingStillSucceeds(@TempDir Path storageRoot) {
        when(transactions.markProcessingAndGetStorageKey("video-001")).thenReturn("sessions/s/rec.mp4");
        File missingThumbnail = new File(storageRoot.toFile(), "does-not-exist.jpg");
        VideoProcessor.ProcessingResult result = new VideoProcessor.ProcessingResult(1, 100.0, 1.0, 1.0, 1.0);
        when(videoProcessor.process(any()))
                .thenReturn(new VideoProcessor.ProcessingOutcome(result, 30.0, List.of(), missingThumbnail, null));

        runner(storageRoot).processAsync("video-001");

        verify(transactions).applyResult("video-001", result);
        verify(transactions, never()).setThumbnailUrl(any(), any());
        verify(transactions, never()).markFailed(any());
    }

    @Test
    void whenTheVideoIsAlreadyGoneItNeverRunsTheProcessor(@TempDir Path storageRoot) {
        when(transactions.markProcessingAndGetStorageKey("gone")).thenReturn(null);

        runner(storageRoot).processAsync("gone");

        verify(videoProcessor, never()).process(any());
        verify(transactions, never()).applyResult(any(), any());
        verify(transactions, never()).markFailed(any());
        verify(telemetryStore, never()).save(any(), anyDouble(), any());
    }

    @Test
    void whenTheProcessorThrowsItMarksTheVideoFailedInsteadOfApplyingAResult(@TempDir Path storageRoot) {
        when(transactions.markProcessingAndGetStorageKey("video-001")).thenReturn("sessions/s/rec.mp4");
        when(videoProcessor.process(any())).thenThrow(new RuntimeException("boom"));

        runner(storageRoot).processAsync("video-001");

        verify(transactions).markFailed(eq("video-001"));
        verify(transactions, never()).applyResult(any(), any());
        verify(telemetryStore, never()).save(any(), anyDouble(), any());
    }
}
