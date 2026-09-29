package com.followthrough.api.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
 * @Transactional here rolls back every write each test makes -- MockMvc
 * dispatches in-process on the same thread as the test method, so the
 * rollback correctly undoes it, keeping tests independent of run order
 * without needing to manually revert mutations. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(com.followthrough.api.config.MockMvcAuthConfig.class)
@Transactional
class UserControllerTest {

    @Autowired private MockMvc mockMvc;

    @Test
    void meReturnsTheSeededUser() throws Exception {
        mockMvc.perform(get("/users/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("user-001"))
                .andExpect(jsonPath("$.email").value("patrick.doyne@followthrough.app"))
                .andExpect(jsonPath("$.preferences.defaultMetric").value("shootingPercentage"));
    }

    @Test
    void updatingOnlyTeamLeavesEverythingElseUnchanged() throws Exception {
        mockMvc.perform(
                        put("/users/me")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"team\": \"Test Gym Warriors\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.team").value("Test Gym Warriors"))
                .andExpect(jsonPath("$.name").value("Patrick Doyne"))
                .andExpect(jsonPath("$.tier").exists());
    }

    @Test
    void updatingOneNotificationLeavesTheOthersUntouched() throws Exception {
        mockMvc.perform(
                        put("/users/me")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"preferences": {"notifications": {"weeklyDigest": true}}}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences.notifications.weeklyDigest").value(true))
                .andExpect(jsonPath("$.preferences.notifications.trainingReminders").value(true));
    }
}
