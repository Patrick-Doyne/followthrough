package com.followthrough.api.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class NotificationPreferencesTest {

    @Test
    void settersOverwriteTheValuesTheAllArgsConstructorSet() {
        NotificationPreferences notifications = new NotificationPreferences(true, true, false, true);

        notifications.setTrainingReminders(false);
        notifications.setSessionCompletion(false);
        notifications.setWeeklyDigest(true);
        notifications.setMissedSession(false);

        assertThat(notifications.isTrainingReminders()).isFalse();
        assertThat(notifications.isSessionCompletion()).isFalse();
        assertThat(notifications.isWeeklyDigest()).isTrue();
        assertThat(notifications.isMissedSession()).isFalse();
    }
}
