package com.followthrough.api.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.followthrough.api.security.JwtService;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcBuilderCustomizer;
import org.springframework.context.annotation.Bean;

/**
 * Every @AutoConfigureMockMvc test in this suite needs to authenticate now
 * that SecurityConfig protects every endpoint except /auth/**. Boot 4.1.1
 * doesn't auto-wire spring-security-test's MockMvc integration the way
 * earlier Boot versions did (neither spring-boot-test-autoconfigure nor
 * spring-boot-webmvc-test ship a security-aware MockMvcBuilderCustomizer,
 * confirmed by inspecting both jars directly), so this does the equivalent
 * by hand: attach a real JWT for DataSeeder's seeded demo account as a
 * default request header, applied to every MockMvc.perform() call. This
 * exercises the actual JwtAuthenticationFilter/JwtService path rather than
 * bypassing it, so it also proves that path works.
 */
@TestConfiguration
public class MockMvcAuthConfig {

    public static final String DEFAULT_TEST_USER_ID = "user-001";

    @Bean
    MockMvcBuilderCustomizer authenticatedDefaultRequestCustomizer(JwtService jwtService) {
        String token = jwtService.issueToken(DEFAULT_TEST_USER_ID);
        return builder -> builder.defaultRequest(get("/").header("Authorization", "Bearer " + token));
    }
}
