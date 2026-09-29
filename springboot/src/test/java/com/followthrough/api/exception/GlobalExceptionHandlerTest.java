package com.followthrough.api.exception;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.followthrough.api.service.TrainingSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Exercises GlobalExceptionHandler's catch-all -- every other handler in
 * that class is already hit by real validation/not-found scenarios
 * elsewhere, but nothing naturally throws a plain, unmapped exception, so
 * this forces one via a mocked service. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(com.followthrough.api.config.MockMvcAuthConfig.class)
class GlobalExceptionHandlerTest {

    @Autowired private MockMvc mockMvc;

    @MockitoBean private TrainingSessionService sessionService;

    @Test
    void anUnmappedExceptionBecomesA500WithAGenericDetailAndNoLeakedStackTrace() throws Exception {
        given(sessionService.get("session-001")).willThrow(new IllegalStateException("boom"));

        mockMvc.perform(get("/sessions/session-001"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.detail").value("An unexpected error occurred"));
    }
}
