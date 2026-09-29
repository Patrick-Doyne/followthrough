package com.followthrough.api.service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * The real VideoProcessor: two subprocess steps per video.
 *
 * <p>1) The follow_through_batch_gpu binary (cpp/follow-through-batch.cpp)
 * analyzes the file and writes JSONL telemetry (see TelemetryJsonlParser
 * for the schema). 2) The Node
 * preparation script (follow-through-pro-19/scripts/prepare-playback.ts)
 * makes the gallery tile from that telemetry, and -- only when the upload
 * is in a codec no browser decodes -- writes an H.264 copy beside it for
 * the player to use.
 *
 * <p><strong>The uploaded recording is never modified.</strong> It used to
 * be: the overlay was painted into every frame and the re-encoded copy
 * replaced the original in place. That was destructive -- it overwrote the
 * only clean copy, so a video processed that way can never have the
 * overlay taken off again -- and it froze at upload time a thing that
 * should follow the viewer: the analysis could not take the theme the
 * viewer had picked, and improving the artwork meant re-encoding the whole
 * library. The overlay is now drawn over the video as it plays, from this
 * same telemetry, by src/components/video/TelemetryOverlayCanvas.tsx.
 * Removing the re-encode also took roughly 88% of the processing cost of
 * an upload with it.
 *
 * <p>Active only when followthrough.processing.engine=cpp -- this needs a
 * real GPU/CUDA/TensorRT toolchain plus Node (ffmpeg/ffprobe come with the
 * frontend's npm dependencies), none of which exist in the test/CI
 * environment (see StubVideoProcessor, the default).
 */
@Service
@ConditionalOnProperty(name = "followthrough.processing.engine", havingValue = "cpp")
public class CppVideoProcessor implements VideoProcessor {

    private static final Logger log = LoggerFactory.getLogger(CppVideoProcessor.class);

    private final TelemetryJsonlParser telemetryParser;
    private final String cppBinaryPath;
    private final Path cppWorkingDirectory;
    private final long cppTimeoutMinutes;
    private final List<String> nodeCommandPrefix;
    private final String prepareScriptPath;
    private final Path nodeWorkingDirectory;
    private final long prepareTimeoutMinutes;
    private final Path tempDirectory;

    public CppVideoProcessor(
            TelemetryJsonlParser telemetryParser,
            @Value("${followthrough.cpp.binary-path}") String cppBinaryPath,
            @Value("${followthrough.cpp.working-directory}") String cppWorkingDirectory,
            @Value("${followthrough.cpp.timeout-minutes:10}") long cppTimeoutMinutes,
            // The full command that gets the preparation script running, minus
            // the script path/its own args -- "npx,tsx" for a real run (npx
            // resolves tsx to run the TypeScript script directly); tests
            // override this to something like "bash" to run a plain fixture
            // shell script instead, without touching the real npx/tsx path.
            @Value("${followthrough.node.command-prefix:npx,tsx}") List<String> nodeCommandPrefix,
            @Value("${followthrough.node.prepare-script}") String prepareScriptPath,
            @Value("${followthrough.node.working-directory}") String nodeWorkingDirectory,
            @Value("${followthrough.node.timeout-minutes:30}") long prepareTimeoutMinutes,
            // Defaults to the JVM's own temp dir -- overridable so tests can
            // point it at a @TempDir (making both cleanup and "this directory
            // doesn't exist" genuinely testable, unlike java.io.tmpdir itself,
            // which the JDK reads once and caches at startup).
            @Value("${followthrough.cpp.temp-directory:${java.io.tmpdir}}") String tempDirectory) {
        this.telemetryParser = telemetryParser;
        // Resolved to an absolute path up front, rather than left relative:
        // ProcessBuilder.directory(...) changes the child's cwd *before*
        // exec, and on POSIX a relative argv[0] resolves against that new
        // cwd, not this app's own -- so a path meant to be relative to this
        // app's working directory would silently resolve to the wrong file
        // once combined with .directory(cppWorkingDirectory) below.
        this.cppBinaryPath = Path.of(cppBinaryPath).toAbsolutePath().normalize().toString();
        this.cppWorkingDirectory = Path.of(cppWorkingDirectory).toAbsolutePath().normalize();
        this.cppTimeoutMinutes = cppTimeoutMinutes;
        this.nodeCommandPrefix = nodeCommandPrefix;
        this.prepareScriptPath = prepareScriptPath;
        this.nodeWorkingDirectory = Path.of(nodeWorkingDirectory).toAbsolutePath().normalize();
        this.prepareTimeoutMinutes = prepareTimeoutMinutes;
        this.tempDirectory = Path.of(tempDirectory);
    }

    /**
     * Runs detection and compositing <em>concurrently</em> rather than back
     * to back.
     *
     * <p>The two stages used to be strictly serial: detection wrote the
     * whole telemetry file, then compositing read it. Measured on a 28s 4K
     * clip that is ~18s of detection followed by ~118s of compositing, so
     * the video was effectively decoded twice in sequence and detection's
     * cost was fully additive.
     *
     * <p>The preparation script consumes telemetry as it is written (see
     * prepare-playback.ts's TelemetryTail, and the periodic flush in
     * follow-through-batch.cpp). It is far cheaper than it used to be,
     * now that it renders one frame rather than re-encoding the whole
     * recording, so in practice it now finishes moments after detection
     * does rather than dominating the run.
     *
     * <p>Detection is still awaited first: if it fails, the renderer is
     * killed immediately rather than left waiting on a file that will never
     * be finished.
     */
    @Override
    public ProcessingOutcome process(File videoFile) {
        // Created before either subprocess starts so the preparation script
        // always has a file to open, rather than racing detection's first
        // write.
        Path telemetryFile = createTempFile("ft-telemetry-", ".jsonl");
        try {
            // Deliberately not created via createTempFile()/deleted in a
            // finally: the thumbnail has to survive past this call for
            // VideoProcessingRunner to relocate into permanent storage.
            String runId = UUID.randomUUID().toString();
            Path thumbnailFile = Path.of(tempDirectory.toString(), "ft-thumbnail-" + runId + ".jpg");
            /*
             * Written only when the upload is in a format no browser can
             * decode -- so its absence afterwards is the signal that the
             * upload is playable as it stands, not a failure.
             */
            Path playbackFile = Path.of(tempDirectory.toString(), "ft-playback-" + runId + ".mp4");

            List<String> prepareCommand = new ArrayList<>(nodeCommandPrefix);
            prepareCommand.add(prepareScriptPath);
            prepareCommand.add(videoFile.getAbsolutePath());
            prepareCommand.add(telemetryFile.toString());
            prepareCommand.add(thumbnailFile.toString());
            prepareCommand.add(playbackFile.toString());

            Process detection =
                    startSubprocess(
                            "detection",
                            List.of(cppBinaryPath, videoFile.getAbsolutePath(), telemetryFile.toString()),
                            cppWorkingDirectory);
            Process preparing;
            try {
                preparing = startSubprocess("playback preparation", prepareCommand, nodeWorkingDirectory);
            } catch (RuntimeException e) {
                detection.destroyForcibly();
                throw e;
            }

            try {
                awaitSubprocess("detection", detection, cppTimeoutMinutes);
            } catch (RuntimeException e) {
                preparing.destroyForcibly();
                throw e;
            }
            awaitSubprocess("playback preparation", preparing, prepareTimeoutMinutes);

            // Parsed after both stages finish: the file is complete by now,
            // and these aggregates are only needed for the stored result.
            TelemetryJsonlParser.ParsedTelemetry parsed = telemetryParser.parse(readLines(telemetryFile));
            File thumbnail = Files.exists(thumbnailFile) ? thumbnailFile.toFile() : null;
            File playback = Files.exists(playbackFile) ? playbackFile.toFile() : null;
            return new ProcessingOutcome(
                    parsed.result(), parsed.fps(), parsed.messages(), thumbnail, playback);
        } finally {
            deleteQuietly(telemetryFile);
        }
    }

    private Process startSubprocess(String stepName, List<String> command, Path workingDirectory) {
        try {
            return new ProcessBuilder(command)
                    .directory(workingDirectory.toFile())
                    .redirectErrorStream(true)
                    .start();
        } catch (IOException e) {
            throw new VideoProcessingException("Failed to start " + stepName + " subprocess", e);
        }
    }

    private void awaitSubprocess(String stepName, Process process, long timeoutMinutes) {
        boolean finished;
        try {
            finished = process.waitFor(timeoutMinutes, TimeUnit.MINUTES);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            throw new VideoProcessingException(stepName + " subprocess was interrupted", e);
        }

        if (!finished) {
            process.destroyForcibly();
            throw new VideoProcessingException(stepName + " subprocess timed out after " + timeoutMinutes + " minutes");
        }

        int exitCode = process.exitValue();
        if (exitCode != 0) {
            String output = readProcessOutputQuietly(process);
            log.warn("{} subprocess exited {} -- output:\n{}", stepName, exitCode, output);
            throw new VideoProcessingException(
                    stepName + " subprocess exited with code " + exitCode + " -- output: " + output);
        }
    }

    /** IOException here (a live process's own stdout pipe failing mid-read)
     * isn't realistically triggerable in a test without mocking Process
     * itself -- same category of accepted-untestable as the one documented
     * PIT survivor in SecurityConfigTest. Best-effort only: this is already
     * on the "something went wrong" path, so a failure here just means a
     * slightly less useful log line, not a functional difference. */
    private static String readProcessOutputQuietly(Process process) {
        try {
            return new String(process.getInputStream().readAllBytes());
        } catch (IOException e) {
            return "(could not read subprocess output: " + e.getMessage() + ")";
        }
    }

    private static List<String> readLines(Path file) {
        try {
            return Files.readAllLines(file);
        } catch (IOException e) {
            throw new VideoProcessingException("Failed to read telemetry output at " + file, e);
        }
    }

    private Path createTempFile(String prefix, String suffix) {
        try {
            return Files.createTempFile(tempDirectory, prefix, suffix);
        } catch (IOException e) {
            throw new VideoProcessingException("Failed to create a temp file for video processing", e);
        }
    }

    /** IOException here would mean the shared system temp directory itself
     * became undeletable mid-run -- not safely reproducible in a test
     * without mutating that shared directory's permissions (which would
     * affect the whole machine, not just this test). Accepted untestable
     * for the same reason as the other two above; this is best-effort
     * cleanup in a finally block regardless, so a failure here was never
     * going to affect correctness, only leave a stray temp file behind. */
    private static void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            log.warn("Failed to delete temp file {}", file, e);
        }
    }
}
