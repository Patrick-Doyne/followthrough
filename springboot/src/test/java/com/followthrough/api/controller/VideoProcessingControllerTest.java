package com.followthrough.api.controller;

import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Deliberately NOT @Transactional (unlike the other controller test
 * classes) -- offline processing runs @Async on its own thread with its
 * own transaction, so this needs the setup request's insert to actually
 * commit for that worker thread to see it. Since nothing here auto-rolls
 * back, createSession() tracks every session it creates so @AfterEach can
 * delete them (cascading away their videos too, per Phase 1's delete
 * semantics) -- other suites like AnalyticsControllerTest assert exact
 * counts over the seeded demo account's sessions, which leftover rows here
 * would otherwise inflate.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(com.followthrough.api.config.MockMvcAuthConfig.class)
class VideoProcessingControllerTest {

    @Autowired private MockMvc mockMvc;

    private final List<String> createdSessionIds = new ArrayList<>();

    @AfterEach
    void cleanUpCreatedSessions() throws Exception {
        for (String sessionId : createdSessionIds) {
            mockMvc.perform(delete("/sessions/" + sessionId));
        }
        createdSessionIds.clear();
    }

    @Test
    void processingAVideoStartsQueuedAndEventuallyCompletesWithRolledUpSessionStats() throws Exception {
        String sessionId = createSession();

        String processed =
                mockMvc.perform(
                                post("/sessions/" + sessionId + "/videos/process")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "title": "Uploaded practice recording",
                                                  "date": "2026-09-24T18:00:00Z",
                                                  "storageKey": "sessions/%s/upload-does-not-exist-on-disk.mp4",
                                                  "durationSeconds": 42,
                                                  "sizeMb": 12.5
                                                }
                                                """
                                                        .formatted(sessionId)))
                        .andExpect(status().isAccepted())
                        .andExpect(jsonPath("$.status").value("QUEUED"))
                        .andExpect(jsonPath("$.analyzedShots").value(0))
                        // durationSeconds/sizeMb are known from the file itself, not
                        // something processing discovers -- present immediately.
                        .andExpect(jsonPath("$.durationSeconds").value(42))
                        .andExpect(jsonPath("$.sizeMb").value(12.5))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String videoId = JsonPath.read(processed, "$.videoId");

        await()
                .atMost(Duration.ofSeconds(5))
                .pollInterval(Duration.ofMillis(50))
                .untilAsserted(
                        () ->
                                mockMvc.perform(get("/videos/" + videoId))
                                        .andExpect(status().isOk())
                                        .andExpect(jsonPath("$.status").value("COMPLETE")));

        mockMvc.perform(get("/videos/" + videoId))
                .andExpect(status().isOk())
                // a missing file on disk is treated as the smallest size by StubVideoProcessor.
                .andExpect(jsonPath("$.analyzedShots").value(10))
                // unchanged by processing -- it was already known at upload time.
                .andExpect(jsonPath("$.durationSeconds").value(42));

        mockMvc.perform(get("/sessions/" + sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETE"))
                .andExpect(jsonPath("$.shots").value(10));
    }

    @Test
    void processVideoForAnUnknownSessionReturnsNotFound() throws Exception {
        mockMvc.perform(
                        post("/sessions/does-not-exist/videos/process")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "title": "Doesn't matter",
                                          "date": "2026-09-24T18:00:00Z",
                                          "storageKey": "sessions/does-not-exist/recording.mp4",
                                          "durationSeconds": 30,
                                          "sizeMb": 5.0
                                        }
                                        """))
                .andExpect(status().isNotFound());
    }

    @Test
    void processVideoWithoutAStorageKeyReturnsBadRequest() throws Exception {
        String sessionId = createSession();

        mockMvc.perform(
                        post("/sessions/" + sessionId + "/videos/process")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "title": "Missing storage key",
                                          "date": "2026-09-24T18:00:00Z",
                                          "durationSeconds": 30,
                                          "sizeMb": 5.0
                                        }
                                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.storageKey").exists());
    }

    @Test
    void processVideoWithoutADurationReturnsBadRequestInsteadOfAServerError() throws Exception {
        String sessionId = createSession();

        mockMvc.perform(
                        post("/sessions/" + sessionId + "/videos/process")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "title": "Missing duration",
                                          "date": "2026-09-24T18:00:00Z",
                                          "storageKey": "sessions/%s/recording.mp4",
                                          "sizeMb": 5.0
                                        }
                                        """
                                                .formatted(sessionId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.durationSeconds").exists());
    }

    private String createSession() throws Exception {
        String created =
                mockMvc.perform(
                                post("/sessions")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "name": "Session for offline processing",
                                                  "date": "2026-09-24T18:00:00Z",
                                                  "durationMinutes": 45,
                                                  "location": "Home Gym",
                                                  "trainingType": "SHOOTING"
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String sessionId = JsonPath.read(created, "$.sessionId");
        createdSessionIds.add(sessionId);
        return sessionId;
    }
}
