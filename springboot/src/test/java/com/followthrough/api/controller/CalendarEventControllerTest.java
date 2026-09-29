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
 * @Transactional rolls back every create/update/delete each test makes, so
 * the create-only tests don't leave orphaned rows behind for other tests
 * (in this class or others sharing the same context) to see. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(com.followthrough.api.config.MockMvcAuthConfig.class)
@Transactional
class CalendarEventControllerTest {

    @Autowired private MockMvc mockMvc;

    @Test
    void listWithNoRangeReturnsEveryStoredEvent() throws Exception {
        mockMvc.perform(get("/calendar/events"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(greaterThanOrEqualTo(11)));
    }

    @Test
    void listWithARangeOnlyReturnsEventsInThatRange() throws Exception {
        // Seeded events span roughly 2026-07-18 to 2026-08-23 (see DataSeeder);
        // September has none, so this is a simple, deterministic "empty" check.
        mockMvc.perform(
                        get("/calendar/events").param("from", "2026-09-01").param("to", "2026-09-30"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void listWithARangeCoveringAugustExcludesJulyEvents() throws Exception {
        mockMvc.perform(
                        get("/calendar/events").param("from", "2026-08-01").param("to", "2026-08-31"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.date < '2026-08-01' || @.date > '2026-08-31')]").isEmpty());
    }

    @Test
    void createWithValidBodyReturnsCreatedAndDefaultsStatusToUpcoming() throws Exception {
        mockMvc.perform(
                        post("/calendar/events")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(validEventJson("Extra Shooting Block", "2026-09-30")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Extra Shooting Block"))
                .andExpect(jsonPath("$.status").value("UPCOMING"));
    }

    @Test
    void createWithoutTitleReturnsBadRequestWithFieldError() throws Exception {
        String body =
                """
                {
                  "date": "2026-09-30",
                  "startTime": "17:00",
                  "endTime": "18:00",
                  "location": "North Gym",
                  "trainingType": "SHOOTING"
                }
                """;

        mockMvc.perform(post("/calendar/events").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.title").exists());
    }

    @Test
    void createWithAnUnknownSessionIdReturnsNotFound() throws Exception {
        String body =
                """
                {
                  "title": "Linked to a session",
                  "date": "2026-09-30",
                  "startTime": "17:00",
                  "endTime": "18:00",
                  "location": "North Gym",
                  "trainingType": "SHOOTING",
                  "sessionId": "does-not-exist"
                }
                """;

        mockMvc.perform(post("/calendar/events").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNotFound());
    }

    @Test
    void fullLifecycle_createThenUpdateThenDeleteThenGone() throws Exception {
        String created =
                mockMvc.perform(
                                post("/calendar/events")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(validEventJson("Lifecycle Test Event", "2026-10-05")))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String eventId = JsonPath.read(created, "$.eventId");

        mockMvc.perform(
                        put("/calendar/events/{id}", eventId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(validEventJson("Lifecycle Test Event (rescheduled)", "2026-10-06")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Lifecycle Test Event (rescheduled)"))
                .andExpect(jsonPath("$.date").value("2026-10-06"));

        mockMvc.perform(delete("/calendar/events/{id}", eventId)).andExpect(status().isNoContent());

        mockMvc.perform(
                        put("/calendar/events/{id}", eventId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(validEventJson("Should not exist anymore", "2026-10-07")))
                .andExpect(status().isNotFound());
    }

    @Test
    void deleteUnknownEventReturnsNotFound() throws Exception {
        mockMvc.perform(delete("/calendar/events/does-not-exist")).andExpect(status().isNotFound());
    }

    private static String validEventJson(String title, String date) {
        return """
                {
                  "title": "%s",
                  "date": "%s",
                  "startTime": "17:00",
                  "endTime": "18:00",
                  "location": "North Gym",
                  "trainingType": "SHOOTING"
                }
                """
                .formatted(title, date);
    }
}
