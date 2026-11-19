package com.followthrough.api.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** @Import(MockMvcAuthConfig.class) authenticates every request as DataSeeder's seeded demo
 * account -- everything here targets that account's own data.
 * @Transactional rolls back the update/delete tests' writes so they don't
 * leave a mutated video-001 behind for other tests to see. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(com.followthrough.api.config.MockMvcAuthConfig.class)
@Transactional
class VideoAssetControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private com.followthrough.api.service.TelemetryStore telemetryStore;
    // Mocked so storing live telemetry does not start the real preparation
    // script against a recording that does not exist; it used to do nothing
    // only because the test's transaction hid the row from the async thread.
    @MockitoBean private com.followthrough.api.service.LiveRecordingPreparer liveRecordingPreparer;

    @Test
    void listReturnsThePageEnvelopeWithTheSeededVideos() throws Exception {
        mockMvc.perform(get("/videos"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(greaterThanOrEqualTo(9)))
                .andExpect(jsonPath("$.totalElements").value(greaterThanOrEqualTo(9)));
    }

    @Test
    void listHonoursPageAndSizeQueryParams() throws Exception {
        mockMvc.perform(get("/videos").param("page", "1").param("size", "4"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.size").value(4));
    }

    @Test
    void getReturnsTheRequestedVideo() throws Exception {
        mockMvc.perform(get("/videos/video-001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.videoId").value("video-001"))
                .andExpect(jsonPath("$.sessionId").value("session-001"))
                // storageKey is a raw S3 key, never a playable URL directly.
                .andExpect(jsonPath("$.storageKey").value("sessions/session-001/recording.mp4"));
    }

    @Test
    void getUnknownVideoReturnsNotFound() throws Exception {
        mockMvc.perform(get("/videos/does-not-exist")).andExpect(status().isNotFound());
    }

    @Test
    void updateChangesTitleAndThumbnailButLeavesPipelineFieldsAlone() throws Exception {
        mockMvc.perform(
                        put("/videos/video-001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"title": "Renamed Video", "thumbnailUrl": "https://example.com/new-thumb.jpg"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Renamed Video"))
                .andExpect(jsonPath("$.thumbnailUrl").value("https://example.com/new-thumb.jpg"))
                // seeded storageKey/analyzedShots are untouched by an update.
                .andExpect(jsonPath("$.storageKey").value("sessions/session-001/recording.mp4"))
                .andExpect(jsonPath("$.analyzedShots").value(62));
    }

    @Test
    void updateWithoutATitleReturnsBadRequest() throws Exception {
        mockMvc.perform(put("/videos/video-001").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.title").exists());
    }

    @Test
    void updateUnknownVideoReturnsNotFound() throws Exception {
        mockMvc.perform(
                        put("/videos/does-not-exist")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                        {"title": "Doesn't matter"}
                                        """))
                .andExpect(status().isNotFound());
    }

    @Test
    void deletingAVideoRemovesItAndALaterGetReturnsNotFound() throws Exception {
        String ingested =
                mockMvc.perform(
                                post("/sessions/session-001/videos")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "title": "Video to delete",
                                                  "date": "2026-09-24T18:00:00Z",
                                                  "durationSeconds": 300,
                                                  "storageKey": "sessions/session-001/to-delete.mp4",
                                                  "analyzedShots": 5,
                                                  "shootingPercentage": 40,
                                                  "sizeMb": 10
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String videoId = JsonPath.read(ingested, "$.videoId");

        mockMvc.perform(delete("/videos/" + videoId)).andExpect(status().isNoContent());

        mockMvc.perform(get("/videos/" + videoId)).andExpect(status().isNotFound());
    }

    /**
     * A live session hands over the telemetry it collected once its
     * recording is ingested. It must come back for playback the way a
     * processed upload's does (metadata stripped, fps kept) and recount the
     * video with the same arithmetic as offline processing.
     */
    @Test
    void storingLiveTelemetryKeepsItForPlaybackAndRecountsTheVideo() throws Exception {
        String ingested =
                mockMvc.perform(
                                post("/sessions/session-001/videos")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "title": "Live recording",
                                                  "date": "2026-11-18T15:00:00Z",
                                                  "durationSeconds": 30,
                                                  "storageKey": "sessions/session-001/live.webm",
                                                  "analyzedShots": 0,
                                                  "shootingPercentage": 0,
                                                  "sizeMb": 2
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String videoId = JsonPath.read(ingested, "$.videoId");

        mockMvc.perform(
                        put("/videos/" + videoId + "/telemetry")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        [
                                          {"type": "metadata", "fps": 30, "frame_width": 1920, "frame_height": 1080, "source": "live"},
                                          {"type": "frame", "frame_id": 0, "frame_width": 1920, "frame_height": 1080},
                                          {"type": "frame", "frame_id": 45, "frame_width": 1920, "frame_height": 1080,
                                           "shot_distance_ft": 15.2, "shot_duration": 1.1, "time_to_apex": 0.5},
                                          {"type": "shot_event", "frame_id": 45, "result": "MAKE", "makes": 1, "misses": 0}
                                        ]
                                        """))
                .andExpect(status().isOk())
                // PROCESSING until the thumbnail step (LiveRecordingPreparer) marks it complete.
                .andExpect(jsonPath("$.status").value("PROCESSING"))
                .andExpect(jsonPath("$.analyzedShots").value(1))
                .andExpect(jsonPath("$.shootingPercentage").value(100.0));
        verify(liveRecordingPreparer).prepareAsync(videoId);

        mockMvc.perform(get("/videos/" + videoId + "/telemetry"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fps").value(30.0))
                .andExpect(jsonPath("$.messages.length()").value(3))
                .andExpect(jsonPath("$.messages[2].type").value("shot_event"));
    }

    /**
     * A delete the UI calls permanent has to be permanent. The telemetry
     * is the part most easily orphaned: it is keyed by video id rather
     * than related to the row, so nothing cascades.
     */
    @Test
    void deletingAVideoTakesItsTelemetryWithIt() throws Exception {
        String ingested =
                mockMvc.perform(
                                post("/sessions/session-001/videos")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "title": "Video with telemetry",
                                                  "date": "2026-09-24T18:00:00Z",
                                                  "durationSeconds": 120,
                                                  "storageKey": "sessions/session-001/telemetry-owner.mp4",
                                                  "analyzedShots": 2,
                                                  "shootingPercentage": 50,
                                                  "sizeMb": 4
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String videoId = JsonPath.read(ingested, "$.videoId");

        telemetryStore.save(videoId, 30.0, List.of());
        assertThat(telemetryStore.load(videoId)).isPresent();

        mockMvc.perform(delete("/videos/" + videoId)).andExpect(status().isNoContent());

        assertThat(telemetryStore.load(videoId)).isEmpty();
        mockMvc.perform(get("/videos/" + videoId)).andExpect(status().isNotFound());
    }

    /** Deleting a session's only recording leaves nothing to count: the
     * totals go back to zero rather than dividing by it. */
    @Test
    void deletingASessionsOnlyVideoResetsItsTotalsToZero() throws Exception {
        String created =
                mockMvc.perform(
                                post("/sessions")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "name": "One-video session",
                                                  "date": "2026-09-24T18:00:00Z",
                                                  "durationMinutes": 30,
                                                  "location": "Backyard Court",
                                                  "trainingType": "SHOOTING"
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String sessionId = JsonPath.read(created, "$.sessionId");
        String ingested =
                mockMvc.perform(
                                post("/sessions/" + sessionId + "/videos")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "title": "The only video",
                                                  "date": "2026-09-24T18:00:00Z",
                                                  "durationSeconds": 60,
                                                  "storageKey": "sessions/one-video/only.mp4",
                                                  "analyzedShots": 4,
                                                  "shootingPercentage": 50,
                                                  "sizeMb": 2
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String videoId = JsonPath.read(ingested, "$.videoId");

        mockMvc.perform(delete("/videos/" + videoId)).andExpect(status().isNoContent());

        mockMvc.perform(get("/sessions/" + sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shots").value(0))
                .andExpect(jsonPath("$.makes").value(0))
                .andExpect(jsonPath("$.shootingPercentage").value(0.0));
    }

    @Test
    void deleteUnknownVideoReturnsNotFound() throws Exception {
        mockMvc.perform(delete("/videos/does-not-exist")).andExpect(status().isNotFound());
    }

    @Test
    void telemetryReturnsNotFoundWhenNoneHasBeenSavedYet() throws Exception {
        mockMvc.perform(get("/videos/video-001/telemetry")).andExpect(status().isNotFound());
    }

    @Test
    void telemetryForUnknownVideoReturnsNotFound() throws Exception {
        mockMvc.perform(get("/videos/does-not-exist/telemetry")).andExpect(status().isNotFound());
    }

    @Test
    void telemetryReturnsTheSavedFpsAndMessagesOnceProcessingHasSavedSome() throws Exception {
        tools.jackson.databind.json.JsonMapper mapper = new tools.jackson.databind.json.JsonMapper();
        telemetryStore.save(
                "video-001",
                59.94,
                java.util.List.of(mapper.readTree("{\"type\":\"frame\",\"frame_id\":0}")));

        mockMvc.perform(get("/videos/video-001/telemetry"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fps").value(59.94))
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].type").value("frame"));
    }

    @Test
    void playbackUrlReturnsAUrlWithAFutureExpiry() throws Exception {
        mockMvc.perform(get("/videos/video-001/playback-url"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").isNotEmpty())
                .andExpect(jsonPath("$.expiresAt").isNotEmpty());
    }

    @Test
    void playbackUrlForUnknownVideoReturnsNotFound() throws Exception {
        mockMvc.perform(get("/videos/does-not-exist/playback-url")).andExpect(status().isNotFound());
    }

    @Test
    void uploadUrlReturnsAWritableUrlAndStorageKeyForAKnownSession() throws Exception {
        mockMvc.perform(
                        post("/videos/upload-url")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"sessionId\": \"session-001\", \"contentType\": \"video/webm\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.uploadUrl").value(org.hamcrest.Matchers.containsString("/videos/local-blob/")))
                .andExpect(jsonPath("$.storageKey").value(org.hamcrest.Matchers.startsWith("sessions/session-001/")))
                .andExpect(jsonPath("$.expiresAt").isNotEmpty());
    }

    @Test
    void uploadUrlForUnknownSessionReturnsNotFound() throws Exception {
        mockMvc.perform(
                        post("/videos/upload-url")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"sessionId\": \"does-not-exist\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void uploadUrlWithoutASessionIdReturnsBadRequest() throws Exception {
        mockMvc.perform(post("/videos/upload-url").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.sessionId").exists());
    }
}
