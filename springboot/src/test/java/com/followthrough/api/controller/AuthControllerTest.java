package com.followthrough.api.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** /auth/** is deliberately reachable without a token (see SecurityConfig) --
 * these tests don't need MockMvcAuthConfig the way every other controller
 * test does. @Transactional rolls back the accounts each test registers. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AuthControllerTest {

    @Autowired private MockMvc mockMvc;

    @Test
    void registerCreatesAnAccountAndReturnsAUsableToken() throws Exception {
        mockMvc.perform(
                        post("/auth/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"name": "New Player", "email": "new-player@followthrough.app", "password": "a-real-password"}
                                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.user.email").value("new-player@followthrough.app"))
                .andExpect(jsonPath("$.user.tier").value("FREE"));
    }

    @Test
    void registerWithAnAlreadyRegisteredEmailReturnsConflict() throws Exception {
        mockMvc.perform(
                        post("/auth/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"name": "Duplicate", "email": "patrick.doyne@followthrough.app", "password": "a-real-password"}
                                        """))
                .andExpect(status().isConflict());
    }

    @Test
    void registerWithATooShortPasswordReturnsBadRequest() throws Exception {
        mockMvc.perform(
                        post("/auth/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"name": "Someone", "email": "someone@followthrough.app", "password": "short"}
                                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.password").exists());
    }

    @Test
    void loginWithTheSeededDemoAccountSucceeds() throws Exception {
        mockMvc.perform(
                        post("/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"email": "patrick.doyne@followthrough.app", "password": "followthrough-dev"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.user.userId").value("user-001"));
    }

    @Test
    void loginWithAnUnknownEmailReturnsUnauthorized() throws Exception {
        mockMvc.perform(
                        post("/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"email": "nobody@followthrough.app", "password": "whatever123"}
                                        """))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void loginWithTheWrongPasswordReturnsUnauthorized() throws Exception {
        mockMvc.perform(
                        post("/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"email": "patrick.doyne@followthrough.app", "password": "not-the-real-password"}
                                        """))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aTokenIssuedByRegisterActuallyAuthenticatesLaterRequestsAsThatNewAccount() throws Exception {
        String registerResponse =
                mockMvc.perform(
                                post("/auth/register")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"name": "Fresh Account", "email": "fresh@followthrough.app", "password": "a-real-password"}
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String token = JsonPath.read(registerResponse, "$.token");

        mockMvc.perform(get("/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("fresh@followthrough.app"))
                // a brand-new account starts with none of the demo account's seeded data.
                .andExpect(jsonPath("$.usage.videosProcessed").value(0));

        mockMvc.perform(get("/sessions").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void aRequestWithNoTokenIsRejected() throws Exception {
        mockMvc.perform(get("/sessions")).andExpect(status().isForbidden());
    }

    @Test
    void aRequestWithAGarbageTokenIsRejected() throws Exception {
        mockMvc.perform(get("/sessions").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isForbidden());
    }
}
