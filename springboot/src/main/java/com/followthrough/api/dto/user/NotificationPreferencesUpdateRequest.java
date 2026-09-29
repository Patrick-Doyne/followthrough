package com.followthrough.api.dto.user;

public record NotificationPreferencesUpdateRequest(
        Boolean trainingReminders,
        Boolean sessionCompletion,
        Boolean weeklyDigest,
        Boolean missedSession) {
}
