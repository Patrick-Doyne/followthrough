package com.followthrough.api.dto.user;

public record NotificationPreferencesResponse(
        boolean trainingReminders,
        boolean sessionCompletion,
        boolean weeklyDigest,
        boolean missedSession) {
}
