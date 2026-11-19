package com.followthrough.api.service;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Gives a live session's recording the gallery thumbnail an upload gets,
 * by the same route: once the recording and its telemetry are stored, the
 * preparation script (follow-through-pro-19/scripts/prepare-playback.ts) is
 * run over them exactly as CppVideoProcessor runs it after detection, and
 * what it writes is relocated by the same code (VideoProcessingRunner). The
 * script reads the telemetry as the JSONL stream detection would have
 * written, so the stored messages are handed to it that way: a metadata
 * line, the frames and shot events, an explicit end-of-stream marker.
 *
 * <p>Best effort, like the offline thumbnail: by the time this runs the
 * recording and its telemetry are complete and playable, so a failure here
 * costs a tile, not a video. The video is marked complete either way; it is
 * left PROCESSING by VideoAssetService.storeTelemetry until then so the
 * gallery polls and picks the tile up.
 *
 * <p>Runs off the request thread (see AsyncConfig) and only touches the
 * database through VideoProcessingTransactions, for the same reasons
 * VideoProcessingRunner does.
 */
@Service
public class LiveRecordingPreparer {

    private static final Logger log = LoggerFactory.getLogger(LiveRecordingPreparer.class);

    private final VideoProcessingTransactions transactions;
    private final TelemetryStore telemetryStore;
    private final VideoProcessingRunner runner;
    private final ObjectMapper objectMapper;
    private final List<String> nodeCommandPrefix;
    private final String prepareScriptPath;
    private final Path nodeWorkingDirectory;
    private final long prepareTimeoutMinutes;
    private final Path storageRoot;
    private final Path tempDirectory;

    public LiveRecordingPreparer(
            VideoProcessingTransactions transactions,
            TelemetryStore telemetryStore,
            VideoProcessingRunner runner,
            ObjectMapper objectMapper,
            @Value("${followthrough.node.command-prefix:npx,tsx}") List<String> nodeCommandPrefix,
            @Value("${followthrough.node.prepare-script:scripts/prepare-playback.ts}") String prepareScriptPath,
            @Value("${followthrough.node.working-directory:../follow-through-pro-19}") String nodeWorkingDirectory,
            @Value("${followthrough.node.timeout-minutes:30}") long prepareTimeoutMinutes,
            @Value("${followthrough.storage.local.directory}") String storageDirectory,
            @Value("${followthrough.live.temp-directory:${java.io.tmpdir}}") String tempDirectory) {
        this.transactions = transactions;
        this.telemetryStore = telemetryStore;
        this.runner = runner;
        this.objectMapper = objectMapper;
        this.nodeCommandPrefix = nodeCommandPrefix;
        this.prepareScriptPath = prepareScriptPath;
        this.nodeWorkingDirectory = Path.of(nodeWorkingDirectory).toAbsolutePath().normalize();
        this.prepareTimeoutMinutes = prepareTimeoutMinutes;
        this.storageRoot = Path.of(storageDirectory).toAbsolutePath().normalize();
        this.tempDirectory = Path.of(tempDirectory).toAbsolutePath().normalize();
    }

    @Async
    public void prepareAsync(String videoId) {
        prepare(videoId);
    }

    /** The synchronous core of prepareAsync, so it can be exercised directly. */
    public void prepare(String videoId) {
        try {
            String storageKey = transactions.getStorageKey(videoId);
            if (storageKey == null) {
                return;
            }
            Optional<TelemetryStore.TelemetryBundle> bundle = telemetryStore.load(videoId);
            if (bundle.isEmpty()) {
                log.warn("Live recording {} has no stored telemetry; no thumbnail can be chosen", videoId);
                return;
            }
            File videoFile = storageRoot.resolve(storageKey).normalize().toFile();
            String runId = UUID.randomUUID().toString();
            Path telemetryFile = tempDirectory.resolve("ft-live-telemetry-" + runId + ".jsonl");
            Path thumbnailFile = tempDirectory.resolve("ft-live-thumbnail-" + runId + ".jpg");
            Path playbackFile = tempDirectory.resolve("ft-live-playback-" + runId + ".mp4");
            try {
                writeTelemetryJsonl(telemetryFile, bundle.get());
                runPreparation(videoId, videoFile, telemetryFile, thumbnailFile, playbackFile);
                runner.relocateThumbnail(
                        videoId, storageKey, Files.exists(thumbnailFile) ? thumbnailFile.toFile() : null);
                runner.relocatePlaybackCopy(
                        videoId, storageKey, Files.exists(playbackFile) ? playbackFile.toFile() : null);
            } finally {
                // The relocations move these away on success; whatever is
                // still here after a failure is a leftover.
                deleteQuietly(telemetryFile);
                deleteQuietly(thumbnailFile);
                deleteQuietly(playbackFile);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("Interrupted while preparing live recording {}", videoId);
        } catch (IOException | RuntimeException e) {
            log.warn(
                    "Preparing live recording {} failed; it stays playable without a thumbnail", videoId, e);
        } finally {
            transactions.markComplete(videoId);
        }
    }

    /**
     * The stream exactly as detection writes it for an upload (see
     * TelemetryJsonlParser): one metadata line with the frame rate and
     * source size, then the messages, then the end marker the script waits
     * for. The size comes from the first frame, since the store keeps only
     * the frame rate of the metadata it was given.
     */
    private void writeTelemetryJsonl(Path file, TelemetryStore.TelemetryBundle bundle) throws IOException {
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("type", "metadata");
        metadata.put("fps", bundle.fps());
        for (JsonNode message : bundle.messages()) {
            if ("frame".equals(message.path("type").asString(""))) {
                metadata.set("frame_width", message.path("frame_width"));
                metadata.set("frame_height", message.path("frame_height"));
                break;
            }
        }
        try (BufferedWriter writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
            writer.write(objectMapper.writeValueAsString(metadata));
            writer.newLine();
            for (JsonNode message : bundle.messages()) {
                writer.write(objectMapper.writeValueAsString(message));
                writer.newLine();
            }
            writer.write("{\"type\":\"eos\"}");
            writer.newLine();
        }
    }

    private void runPreparation(
            String videoId, File videoFile, Path telemetryFile, Path thumbnailFile, Path playbackFile)
            throws IOException, InterruptedException {
        List<String> command = new ArrayList<>(nodeCommandPrefix);
        command.add(prepareScriptPath);
        command.add(videoFile.getAbsolutePath());
        command.add(telemetryFile.toString());
        command.add(thumbnailFile.toString());
        command.add(playbackFile.toString());
        Process process =
                new ProcessBuilder(command)
                        .directory(nodeWorkingDirectory.toFile())
                        .redirectErrorStream(true)
                        .start();
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader =
                new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append('\n');
            }
        }
        if (!process.waitFor(prepareTimeoutMinutes, TimeUnit.MINUTES)) {
            process.destroyForcibly();
            log.warn("Playback preparation for live recording {} timed out after {} min", videoId, prepareTimeoutMinutes);
        } else if (process.exitValue() != 0) {
            log.warn(
                    "Playback preparation for live recording {} exited with {}:\n{}",
                    videoId,
                    process.exitValue(),
                    output);
        }
    }

    private static void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            log.debug("Could not delete {}", file, e);
        }
    }
}
