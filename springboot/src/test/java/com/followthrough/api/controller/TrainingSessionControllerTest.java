package com.followthrough.api.controller;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** @Import(MockMvcAuthConfig.class) authenticates every request as DataSeeder's seeded demo
 * account -- everything here targets that account's own data.
 * @Transactional rolls back the video-ingestion tests' writes so they
 * don't leave extra rows behind for other tests to see. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(com.followthrough.api.config.MockMvcAuthConfig.class)
@Transactional
class TrainingSessionControllerTest {

    @Autowired private MockMvc mockMvc;

    @Test
    void listReturnsEveryStoredSessionNewestFirst() throws Exception {
        mockMvc.perform(get("/sessions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(greaterThanOrEqualTo(9)))
                // seeded data's most recent session is "Morning Shootaround" (1 day ago)
                .andExpect(jsonPath("$[0].name").value("Morning Shootaround"));
    }

    @Test
    void getReturnsTheRequestedSession() throws Exception {
        mockMvc.perform(get("/sessions/session-001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value("session-001"))
                .andExpect(jsonPath("$.name").value("Catch & Shoot Circuit"));
    }

    @Test
    void getUnknownSessionReturnsNotFound() throws Exception {
        mockMvc.perform(get("/sessions/does-not-exist"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").value("Session does-not-exist not found"));
    }

    @Test
    void createSessionStartsAtZeroedStatsWithQueuedStatus() throws Exception {
        String body =
                """
                {
                  "name": "New Manual Session",
                  "date": "2026-09-24T18:00:00Z",
                  "durationMinutes": 60,
                  "location": "Backyard Court",
                  "trainingType": "SHOOTING"
                }
                """;

        mockMvc.perform(post("/sessions").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("New Manual Session"))
                .andExpect(jsonPath("$.shots").value(0))
                .andExpect(jsonPath("$.makes").value(0))
                .andExpect(jsonPath("$.status").value("QUEUED"));
    }

    @Test
    void createSessionWithoutANameReturnsBadRequest() throws Exception {
        String body =
                """
                {
                  "date": "2026-09-24T18:00:00Z",
                  "durationMinutes": 60,
                  "location": "Backyard Court",
                  "trainingType": "SHOOTING"
                }
                """;

        mockMvc.perform(post("/sessions").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.name").exists());
    }

    @Test
    void updateSessionAppliesEveryEditableFieldButLeavesStatsAlone() throws Exception {
        mockMvc.perform(
                        put("/sessions/session-001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "name": "Renamed Session",
                                          "date": "2026-09-24T18:00:00Z",
                                          "durationMinutes": 45,
                                          "location": "New Gym",
                                          "trainingType": "CONDITIONING"
                                        }
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Renamed Session"))
                .andExpect(jsonPath("$.date").value("2026-09-24T18:00:00Z"))
                .andExpect(jsonPath("$.durationMinutes").value(45))
                .andExpect(jsonPath("$.location").value("New Gym"))
                .andExpect(jsonPath("$.trainingType").value("CONDITIONING"))
                // session-001's seeded shots/makes are untouched by an update.
                .andExpect(jsonPath("$.shots").value(62));
    }

    @Test
    void updateUnknownSessionReturnsNotFound() throws Exception {
        mockMvc.perform(
                        put("/sessions/does-not-exist")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "name": "Doesn't matter",
                                          "date": "2026-09-24T18:00:00Z",
                                          "durationMinutes": 45,
                                          "location": "New Gym",
                                          "trainingType": "CONDITIONING"
                                        }
                                        """))
                .andExpect(status().isNotFound());
    }

    @Test
    void deletingASessionRemovesItsVideosAndUnlinksButKeepsItsCalendarEvents() throws Exception {
        String created =
                mockMvc.perform(
                                post("/sessions")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "name": "Session To Delete",
                                                  "date": "2026-09-24T18:00:00Z",
                                                  "durationMinutes": 30,
                                                  "location": "Test Gym",
                                                  "trainingType": "SHOOTING"
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String sessionId = JsonPath.read(created, "$.sessionId");

        mockMvc.perform(
                        post("/sessions/" + sessionId + "/videos")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "title": "Video on the session about to be deleted",
                                          "date": "2026-09-24T18:00:00Z",
                                          "durationSeconds": 300,
                                          "storageKey": "sessions/to-delete/recording.mp4",
                                          "analyzedShots": 10,
                                          "shootingPercentage": 50,
                                          "sizeMb": 20
                                        }
                                        """))
                .andExpect(status().isCreated());

        String eventCreated =
                mockMvc.perform(
                                post("/calendar/events")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "title": "Event linked to the session about to be deleted",
                                                  "date": "2026-09-24",
                                                  "startTime": "17:00",
                                                  "endTime": "18:00",
                                                  "location": "Test Gym",
                                                  "trainingType": "SHOOTING",
                                                  "sessionId": "%s"
                                                }
                                                """
                                                .formatted(sessionId)))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String eventId = JsonPath.read(eventCreated, "$.eventId");

        mockMvc.perform(delete("/sessions/" + sessionId)).andExpect(status().isNoContent());

        mockMvc.perform(get("/sessions/" + sessionId)).andExpect(status().isNotFound());
        // The event survives with its session link cleared, not deleted itself.
        mockMvc.perform(get("/calendar/events"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.eventId == '" + eventId + "')].sessionId").value((Object) null));
    }

    @Test
    void deleteUnknownSessionReturnsNotFound() throws Exception {
        mockMvc.perform(delete("/sessions/does-not-exist")).andExpect(status().isNotFound());
    }

    @Test
    void videosForAKnownSessionReturnsThatSessionsVideo() throws Exception {
        mockMvc.perform(get("/sessions/session-001/videos"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].sessionId").value("session-001"));
    }

    @Test
    void ingestVideoCreatesItAgainstTheRealSessionAndDefaultsStatusToComplete() throws Exception {
        String body =
                """
                {
                  "title": "Live Session Recording",
                  "date": "2026-09-23T18:00:00Z",
                  "durationSeconds": 900,
                  "storageKey": "sessions/session-001/live-recording.mp4",
                  "analyzedShots": 42,
                  "shootingPercentage": 51.2,
                  "sizeMb": 210.4
                }
                """;

        mockMvc.perform(
                        post("/sessions/session-001/videos")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.sessionId").value("session-001"))
                .andExpect(jsonPath("$.storageKey").value("sessions/session-001/live-recording.mp4"))
                .andExpect(jsonPath("$.status").value("COMPLETE"));
    }

    @Test
    void ingestVideoWithAnExplicitStatusUsesItInsteadOfDefaultingToComplete() throws Exception {
        String body =
                """
                {
                  "title": "Still Processing Recording",
                  "date": "2026-09-23T18:00:00Z",
                  "durationSeconds": 900,
                  "storageKey": "sessions/session-001/still-processing.mp4",
                  "analyzedShots": 0,
                  "shootingPercentage": 0,
                  "sizeMb": 210.4,
                  "status": "PROCESSING"
                }
                """;

        mockMvc.perform(
                        post("/sessions/session-001/videos")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PROCESSING"));
    }

    @Test
    void ingestVideoForAnUnknownSessionReturnsNotFound() throws Exception {
        String body =
                """
                {
                  "title": "Orphaned Recording",
                  "date": "2026-09-23T18:00:00Z",
                  "durationSeconds": 900,
                  "storageKey": "sessions/does-not-exist/recording.mp4",
                  "analyzedShots": 0,
                  "shootingPercentage": 0,
                  "sizeMb": 10
                }
                """;

        mockMvc.perform(
                        post("/sessions/does-not-exist/videos")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isNotFound());
    }

    @Test
    void ingestVideoWithoutAStorageKeyReturnsBadRequest() throws Exception {
        String body =
                """
                {
                  "title": "Missing Storage Key",
                  "date": "2026-09-23T18:00:00Z",
                  "durationSeconds": 900,
                  "analyzedShots": 0,
                  "shootingPercentage": 0,
                  "sizeMb": 10
                }
                """;

        mockMvc.perform(
                        post("/sessions/session-001/videos")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.storageKey").exists());
    }
}
