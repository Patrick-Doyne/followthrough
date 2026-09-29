package com.followthrough.api.service;

import java.io.File;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * Local-dev stand-in for the real C++ detection pipeline (see
 * CppVideoProcessor) -- no GPU/CUDA/TensorRT/Node toolchain needed.
 * Simulates processing time and derives plausible, deterministic numbers
 * from the file's size so the upload -> queue -> process -> complete flow
 * is genuinely exercisable end to end, including in tests. Produces no
 * telemetry (an empty list), no thumbnail and no playback copy, and like
 * CppVideoProcessor leaves the upload exactly as it arrived. Active
 * whenever followthrough.processing.engine isn't explicitly set to "cpp"
 * (including in every test, where no GPU exists).
 */
@Service
@ConditionalOnProperty(
        name = "followthrough.processing.engine",
        havingValue = "stub",
        matchIfMissing = true)
public class StubVideoProcessor implements VideoProcessor {

    private static final long SIMULATED_PROCESSING_MILLIS = 400;

    @Override
    public ProcessingOutcome process(File videoFile) {
        simulateProcessingDelay();

        long fileSizeMb = Math.max(1L, videoFile.length() / (1024 * 1024));
        int analyzedShots = (int) Math.min(50, Math.max(10, fileSizeMb * 2));
        int makes = Math.round(analyzedShots * 0.55f);
        double shootingPercentage = 100.0 * makes / analyzedShots;

        ProcessingResult result =
                new ProcessingResult(analyzedShots, shootingPercentage, 16.5, 0.85, 0.42);
        // No telemetry, no thumbnail, no playback copy.
        return new ProcessingOutcome(result, 0.0, List.of(), null, null);
    }

    private static void simulateProcessingDelay() {
        try {
            Thread.sleep(SIMULATED_PROCESSING_MILLIS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
