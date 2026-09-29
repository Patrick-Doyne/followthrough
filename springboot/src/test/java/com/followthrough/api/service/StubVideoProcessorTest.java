package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class StubVideoProcessorTest {

    private final StubVideoProcessor processor = new StubVideoProcessor();

    @Test
    void derivesPlausibleDeterministicNumbersFromFileSize(@TempDir Path tempDir) throws IOException {
        Path video = tempDir.resolve("recording.mp4");
        Files.write(video, new byte[6 * 1024 * 1024]);

        VideoProcessor.ProcessingOutcome outcome = processor.process(video.toFile());
        VideoProcessor.ProcessingResult result = outcome.result();

        assertThat(result.analyzedShots()).isEqualTo(12);
        assertThat(result.shootingPercentage()).isCloseTo(55.0, org.assertj.core.data.Offset.offset(5.0));
        assertThat(result.avgShotDistance()).isPositive();
        assertThat(result.avgShotDuration()).isPositive();
        assertThat(result.avgTimeToApex()).isPositive();
        assertThat(outcome.fps()).isZero();
        assertThat(outcome.telemetry()).isEmpty();
    }

    @Test
    void clampsAnalyzedShotsToAMinimumForATinyFile(@TempDir Path tempDir) throws IOException {
        Path video = tempDir.resolve("tiny.mp4");
        Files.write(video, new byte[10]);

        VideoProcessor.ProcessingResult result = processor.process(video.toFile()).result();

        assertThat(result.analyzedShots()).isEqualTo(10);
    }

    @Test
    void clampsAnalyzedShotsToAMaximumForAHugeFile(@TempDir Path tempDir) throws IOException {
        Path video = tempDir.resolve("huge.mp4");
        Files.write(video, new byte[40 * 1024 * 1024]);

        VideoProcessor.ProcessingResult result = processor.process(video.toFile()).result();

        assertThat(result.analyzedShots()).isEqualTo(50);
    }

    @Test
    void treatsAMissingFileAsTheSmallestSize() {
        VideoProcessor.ProcessingResult result =
                processor.process(new java.io.File("does-not-exist.mp4")).result();

        assertThat(result.analyzedShots()).isEqualTo(10);
    }

    @Test
    void restoresTheInterruptFlagInsteadOfSwallowingItWhenTheSimulatedDelayIsInterrupted()
            throws InterruptedException {
        var interruptedAfterProcessing = new java.util.concurrent.atomic.AtomicBoolean();
        Thread worker =
                new Thread(
                        () -> {
                            processor.process(new java.io.File("does-not-exist.mp4"));
                            interruptedAfterProcessing.set(Thread.currentThread().isInterrupted());
                        });
        worker.start();
        Thread.sleep(50);
        worker.interrupt();
        worker.join(2_000);

        assertThat(interruptedAfterProcessing.get()).isTrue();
    }
}
