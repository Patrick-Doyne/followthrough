package com.followthrough.api.controller;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

/** @Import(MockMvcAuthConfig.class) authenticates every request as DataSeeder's seeded demo
 * account -- everything here targets that account's own data. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(com.followthrough.api.config.MockMvcAuthConfig.class)
class AnalyticsControllerTest {

    @Autowired private MockMvc mockMvc;

    @Test
    void summaryAggregatesAcrossAllSeededSessions() throws Exception {
        mockMvc.perform(get("/analytics/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalSessions").value(9))
                .andExpect(jsonPath("$.totalShots").value(greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.deltas.shootingPercentage").exists());
    }

    @Test
    void shootingSeriesReturnsOnePointPerSessionOldestFirst() throws Exception {
        mockMvc.perform(get("/analytics/shooting"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(9))
                // seeded data's oldest session is "Catch & Shoot Circuit" (46 days ago)
                .andExpect(jsonPath("$[0].label").value("Catch & Shoot Circuit"));
    }
}
