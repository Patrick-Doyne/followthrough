package com.followthrough.api.dto.user;

import com.followthrough.api.domain.SubscriptionTier;

public record UserResponse(
        String userId,
        String name,
        String email,
        String position,
        String team,
        String avatarInitials,
        SubscriptionTier tier,
        UsageResponse usage,
        UserPreferencesResponse preferences) {
}
