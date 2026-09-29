package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Exercises the real ProcessBuilder/waitFor/exit-code/file-read
 * orchestration in CppVideoProcessor against small fixture shell scripts
 * (src/test/resources/fixtures/) standing in for the real C++ binary and
 * Node preparation script -- no GPU, CUDA, TensorRT, Node, or ffmpeg needed. The
 * one thing this can't verify is whether the *real* subprocesses behave
 * correctly; that's covered by a manual curl pass against the actually
 * compiled binaries (see BACKLOG.md), the same honest limit already
 * accepted for the one permanently-surviving SecurityConfig PIT mutant.
 */
class CppVideoProcessorTest {

    private static final Path FIXTURES = Path.of("src/test/resources/fixtures").toAbsolutePath();

    @BeforeAll
    static void makeFixturesExecutable() throws IOException {
        try (var files = Files.list(FIXTURES)) {
            for (Path script : files.toList()) {
                Files.setPosixFilePermissions(script, PosixFilePermissions.fromString("rwxr-xr-x"));
            }
        }
    }

    private CppVideoProcessor processor(
            String cppScript,
            String prepareScript,
            long cppTimeoutMinutes,
            long prepareTimeoutMinutes,
            Path scratchDir) {
        return new CppVideoProcessor(
                new TelemetryJsonlParser(new tools.jackson.databind.json.JsonMapper()),
                FIXTURES.resolve(cppScript).toString(),
                FIXTURES.toString(),
                cppTimeoutMinutes,
                List.of("bash"),
                FIXTURES.resolve(prepareScript).toString(),
                FIXTURES.toString(),
                prepareTimeoutMinutes,
                scratchDir.toString());
    }

    /**
     * The overlay is drawn at playback from this same telemetry now, so
     * the stored recording is left exactly as uploaded. This used to
     * assert the opposite -- that a composited copy replaced it -- which
     * was destructive: it overwrote the only clean copy, and a video
     * processed that way can never have its overlay taken off again.
     */
    @Test
    void onSuccessLeavesTheOriginalVideoAloneAndReturnsParsedTelemetry(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");

        VideoProcessor.ProcessingOutcome outcome =
                processor("fake-cpp-binary.sh", "fake-prepare.sh", 1, 1, scratchDir).process(video.toFile());

        assertThat(outcome.fps()).isEqualTo(30.0);
        assertThat(outcome.telemetry()).hasSize(5); // 3 frame lines + 2 shot_event lines
        assertThat(outcome.result().analyzedShots()).isEqualTo(2);
        assertThat(outcome.result().shootingPercentage()).isEqualTo(50.0);
        assertThat(outcome.result().avgShotDistance()).isEqualTo(19.5); // (15.0 + 24.0) / 2
        assertThat(Files.readString(video)).isEqualTo("original raw bytes");
        // The preparation step still runs: it makes the gallery tile.
        assertThat(outcome.thumbnailFile()).isNotNull();
        assertThat(Files.readString(outcome.thumbnailFile().toPath())).isEqualTo("fake thumbnail bytes\n");
    }

    /**
     * The upload is playable as it stands, so nothing is transcoded and
     * the outcome carries no playback copy. That absence is the signal --
     * the backend reads it as "serve the upload itself".
     */
    @Test
    void whenTheUploadIsAlreadyPlayableNoPlaybackCopyIsProduced(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");

        VideoProcessor.ProcessingOutcome outcome =
                processor("fake-cpp-binary.sh", "fake-prepare.sh", 1, 1, scratchDir)
                        .process(video.toFile());

        assertThat(outcome.playbackFile()).isNull();
        assertThat(Files.readString(video)).isEqualTo("original raw bytes");
    }

    /**
     * An HEVC upload -- which no browser decodes -- gets a browser-playable
     * copy written beside it. Beside, not over: the recording itself is
     * still exactly what was uploaded.
     */
    @Test
    void whenTheUploadNeedsTranscodingThePlaybackCopyIsReturnedAndTheOriginalIsUntouched(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");

        VideoProcessor.ProcessingOutcome outcome =
                processor("fake-cpp-binary.sh", "fake-prepare-with-playback.sh", 1, 1, scratchDir)
                        .process(video.toFile());

        assertThat(outcome.playbackFile()).isNotNull();
        assertThat(Files.readString(outcome.playbackFile().toPath()))
                .isEqualTo("fake h264 playback bytes\n");
        assertThat(Files.readString(video)).isEqualTo("original raw bytes");
    }

    @Test
    void whenThePreparationScriptProducesNoThumbnailTheOutcomesThumbnailFileIsNull(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");

        VideoProcessor.ProcessingOutcome outcome =
                processor("fake-cpp-binary.sh", "fake-prepare-no-thumbnail.sh", 1, 1, scratchDir)
                        .process(video.toFile());

        assertThat(outcome.thumbnailFile()).isNull();
    }

    /** Regression test for a real bug found via live testing: every other
     * test here passes an already-absolute cppBinaryPath (FIXTURES.resolve
     * (...)), which never exercised the actual configured property shape
     * (a path relative to this app's own working directory, e.g.
     * "../cpp/build/follow_through_batch_gpu"). ProcessBuilder.directory(...)
     * changes the child's cwd *before* exec, and on POSIX a relative
     * argv[0] resolves against that new cwd, not this app's own -- so a
     * relative binary path combined with a *different* working directory
     * silently resolved to the wrong (nonexistent) file. The fix resolves
     * cppBinaryPath to an absolute path up front; this test would have
     * failed before that fix. */
    @Test
    void aRelativeBinaryPathResolvesAgainstThisAppsOwnWorkingDirectoryNotTheSubprocessWorkingDirectory(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");
        // Deliberately relative (this app's own cwd during a Maven/Surefire
        // run is the module root, springboot/, matching this path) and a
        // cppWorkingDirectory that is NOT an ancestor of it -- exactly the
        // shape that triggered the real bug.
        CppVideoProcessor processor =
                new CppVideoProcessor(
                        new TelemetryJsonlParser(new tools.jackson.databind.json.JsonMapper()),
                        "src/test/resources/fixtures/fake-cpp-binary.sh",
                        scratchDir.toString(),
                        1,
                        List.of("bash"),
                        FIXTURES.resolve("fake-prepare.sh").toString(),
                        FIXTURES.toString(),
                        1,
                        scratchDir.toString());

        VideoProcessor.ProcessingOutcome outcome = processor.process(video.toFile());

        assertThat(outcome.fps()).isEqualTo(30.0);
    }

    @Test
    void onSuccessCleansUpBothTempFilesButLeavesTheThumbnailForRelocation(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");

        VideoProcessor.ProcessingOutcome outcome =
                processor("fake-cpp-binary.sh", "fake-prepare.sh", 1, 1, scratchDir).process(video.toFile());

        // The telemetry temp file is this method's
        // own scratch work and get cleaned up; the thumbnail is
        // deliberately left behind (not created via createTempFile()/
        // deleted in a finally) because VideoProcessingRunner still needs
        // to relocate it into permanent storage after this call returns.
        try (var leftovers = Files.list(scratchDir)) {
            assertThat(leftovers.toList()).containsExactly(outcome.thumbnailFile().toPath());
        }
    }

    @Test
    void whenTheDetectionStepExitsNonZeroItThrowsWithTheSubprocessOutputAndLeavesTheOriginalFileAlone(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");

        assertThatThrownBy(
                        () ->
                                processor("fake-cpp-binary-fail.sh", "fake-prepare.sh", 1, 1, scratchDir)
                                        .process(video.toFile()))
                .isInstanceOf(VideoProcessingException.class)
                .hasMessageContaining("detection")
                .hasMessageContaining("simulated detection failure");

        assertThat(Files.readString(video)).isEqualTo("original raw bytes");
    }

    @Test
    void whenTheDetectionStepHangsItTimesOutRatherThanBlockingForever(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");
        // waitFor's smallest unit is whole minutes -- 0 minutes still gives
        // it a moment to start before immediately timing out, well under
        // the hang script's own 60s sleep.
        CppVideoProcessor processor = processor("fake-cpp-binary-hang.sh", "fake-prepare.sh", 0, 1, scratchDir);

        assertThatThrownBy(() -> processor.process(video.toFile()))
                .isInstanceOf(VideoProcessingException.class)
                .hasMessageContaining("timed out");
    }

    @Test
    void whenTheCompositingStepExitsNonZeroItThrowsWithTheSubprocessOutputAndLeavesTheOriginalFileAlone(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");

        assertThatThrownBy(
                        () ->
                                processor("fake-cpp-binary.sh", "fake-prepare-fail.sh", 1, 1, scratchDir)
                                        .process(video.toFile()))
                .isInstanceOf(VideoProcessingException.class)
                .hasMessageContaining("playback preparation")
                .hasMessageContaining("prepare step exploded");

        assertThat(Files.readString(video)).isEqualTo("original raw bytes");
        // The telemetry temp file (written by the cpp step, which did
        // succeed) should still be cleaned up despite the failure.
        try (var leftovers = Files.list(scratchDir)) {
            assertThat(leftovers).isEmpty();
        }
    }

    @Test
    void whenTheBinaryCannotBeStartedAtAllItThrows(@TempDir Path tempDir, @TempDir Path scratchDir)
            throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");
        CppVideoProcessor processor =
                new CppVideoProcessor(
                        new TelemetryJsonlParser(new tools.jackson.databind.json.JsonMapper()),
                        FIXTURES.resolve("does-not-exist.sh").toString(),
                        FIXTURES.toString(),
                        1,
                        List.of("bash"),
                        FIXTURES.resolve("fake-prepare.sh").toString(),
                        FIXTURES.toString(),
                        1,
                        scratchDir.toString());

        assertThatThrownBy(() -> processor.process(video.toFile()))
                .isInstanceOf(VideoProcessingException.class)
                .hasMessageContaining("Failed to start");
    }

    @Test
    void whenTheTempDirectoryDoesNotExistItThrowsInsteadOfANakedIOException(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");
        Path missingScratchDir = scratchDir.resolve("does-not-exist");

        assertThatThrownBy(
                        () ->
                                processor("fake-cpp-binary.sh", "fake-prepare.sh", 1, 1, missingScratchDir)
                                        .process(video.toFile()))
                .isInstanceOf(VideoProcessingException.class)
                .hasMessageContaining("Failed to create a temp file");
    }

    @Test
    void whenDetectionExitsCleanlyButWritesNoTelemetryFileItThrows(@TempDir Path tempDir, @TempDir Path scratchDir)
            throws IOException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");

        assertThatThrownBy(
                        () ->
                                processor("fake-cpp-binary-no-output.sh", "fake-prepare.sh", 1, 1, scratchDir)
                                        .process(video.toFile()))
                .isInstanceOf(VideoProcessingException.class)
                .hasMessageContaining("Failed to read telemetry output");
    }

    @Test
    void interruptingTheCallingThreadRestoresTheInterruptFlagAndStopsTheSubprocess(
            @TempDir Path tempDir, @TempDir Path scratchDir) throws IOException, InterruptedException {
        Path video = tempDir.resolve("upload.mp4");
        Files.writeString(video, "original raw bytes");
        CppVideoProcessor processor = processor("fake-cpp-binary-hang.sh", "fake-prepare.sh", 5, 1, scratchDir);
        var caught = new AtomicReference<Throwable>();

        Thread worker =
                new Thread(
                        () -> {
                            try {
                                processor.process(video.toFile());
                            } catch (Throwable t) {
                                caught.set(t);
                            }
                        });
        worker.start();
        Thread.sleep(300); // let the subprocess actually start before interrupting
        worker.interrupt();
        worker.join(5_000);

        assertThat(caught.get()).isInstanceOf(VideoProcessingException.class);
        assertThat(caught.get()).hasMessageContaining("interrupted");
        // Thread.currentThread().interrupt() inside runSubprocess should have
        // restored the flag before the exception propagated out of the
        // worker -- isInterrupted() (unlike the static Thread.interrupted())
        // doesn't clear it, so it's still observable here.
        assertThat(worker.isInterrupted()).isTrue();
    }
}
