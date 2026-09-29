package com.followthrough.api.dto.user;

import com.followthrough.api.domain.SubscriptionTier;

public record UserUpdateRequest(
        String name,
        String position,
        String team,
        String avatarInitials,
        SubscriptionTier tier,
        UserPreferencesUpdateRequest preferences) {
}
