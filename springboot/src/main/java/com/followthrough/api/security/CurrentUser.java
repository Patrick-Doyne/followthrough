package com.followthrough.api.security;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * Resolves "who is making this request" from the SecurityContext that
 * JwtAuthenticationFilter populates, so services depend on this small
 * component instead of calling SecurityContextHolder directly -- keeps
 * TrainingSessionService/CalendarEventService/VideoAssetService/
 * AnalyticsService/UserService unit-testable with a mocked CurrentUser
 * rather than needing a real populated SecurityContext in every test.
 */
@Component
public class CurrentUser {

    public String userId() {
        return SecurityContextHolder.getContext().getAuthentication().getName();
    }
}
