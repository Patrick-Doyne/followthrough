package com.followthrough.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/** securityFilterChain() itself isn't unit-testable in isolation -- HttpSecurity
 * needs the machinery Spring's WebSecurityConfiguration normally supplies --
 * but it's exercised by every MockMvc test in the suite (a null or
 * misconfigured chain would fail every one of them, permitAll and
 * authenticated endpoints alike), which is a stronger signal than a
 * contrived standalone test could give. passwordEncoder() has no such
 * dependency, so it gets a direct test. */
class SecurityConfigTest {

    @Test
    void passwordEncoderBeanIsARealBCryptEncoder() {
        SecurityConfig config = new SecurityConfig(new JwtAuthenticationFilter(mock(JwtService.class)));

        PasswordEncoder encoder = config.passwordEncoder();

        assertThat(encoder).isInstanceOf(BCryptPasswordEncoder.class);
        assertThat(encoder.matches("a-password", encoder.encode("a-password"))).isTrue();
    }
}
