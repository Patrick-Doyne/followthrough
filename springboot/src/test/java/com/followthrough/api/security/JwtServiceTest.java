package com.followthrough.api.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class JwtServiceTest {

    private static final String SECRET = "test-secret-at-least-32-bytes-long-for-hmac-sha256!!";

    @Test
    void aTokenRoundTripsBackToTheSameUserId() {
        JwtService service = new JwtService(SECRET, 60);

        String token = service.issueToken("user-001");

        assertThat(service.validateAndGetUserId(token)).contains("user-001");
    }

    @Test
    void anExpiredTokenFailsValidation() {
        JwtService service = new JwtService(SECRET, -1);

        String token = service.issueToken("user-001");

        assertThat(service.validateAndGetUserId(token)).isEmpty();
    }

    @Test
    void aTokenSignedWithADifferentSecretFailsValidation() {
        JwtService issuer = new JwtService("a-completely-different-secret-of-at-least-32-bytes", 60);
        JwtService verifier = new JwtService(SECRET, 60);

        String token = issuer.issueToken("user-001");

        assertThat(verifier.validateAndGetUserId(token)).isEmpty();
    }

    @Test
    void garbageIsNotATokenAtAll() {
        JwtService service = new JwtService(SECRET, 60);

        assertThat(service.validateAndGetUserId("not-a-real-jwt")).isEmpty();
    }
}
