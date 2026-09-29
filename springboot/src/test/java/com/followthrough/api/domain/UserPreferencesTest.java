package com.followthrough.api.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class UserPreferencesTest {

    @Test
    void settersOverwriteTheValuesTheAllArgsConstructorSet() {
        NotificationPreferences notifications = new NotificationPreferences(true, true, false, true);
        NotificationPreferences otherNotifications =
                new NotificationPreferences(false, false, true, false);

        UserPreferences preferences =
                new UserPreferences(
                        60,
                        List.of(TrainingType.SHOOTING),
                        Units.IMPERIAL,
                        MetricKey.SHOOTING_PERCENTAGE,
                        ChartType.LINE,
                        true,
                        false,
                        notifications);

        assertThat(preferences.isShowTrendlines())
                .as("constructor value, before any setter call")
                .isTrue();
        assertThat(preferences.isDenseTables())
                .as("constructor value, before any setter call")
                .isFalse();

        preferences.setDefaultSessionDuration(90);
        preferences.setPreferredTrainingTypes(List.of(TrainingType.SKILLS, TrainingType.CONDITIONING));
        preferences.setUnits(Units.METRIC);
        preferences.setDefaultMetric(MetricKey.SHOT_DISTANCE);
        preferences.setDefaultChartType(ChartType.BAR);
        preferences.setShowTrendlines(false);
        preferences.setDenseTables(true);
        preferences.setNotifications(otherNotifications);
        preferences.setUsabilitySettings("{\"version\":2}");

        assertThat(preferences.getDefaultSessionDuration()).isEqualTo(90);
        assertThat(preferences.getPreferredTrainingTypes())
                .containsExactly(TrainingType.SKILLS, TrainingType.CONDITIONING);
        assertThat(preferences.getUnits()).isEqualTo(Units.METRIC);
        assertThat(preferences.getDefaultMetric()).isEqualTo(MetricKey.SHOT_DISTANCE);
        assertThat(preferences.getDefaultChartType()).isEqualTo(ChartType.BAR);
        assertThat(preferences.isShowTrendlines()).isFalse();
        assertThat(preferences.isDenseTables()).isTrue();
        assertThat(preferences.getNotifications()).isEqualTo(otherNotifications);
        assertThat(preferences.getUsabilitySettings()).isEqualTo("{\"version\":2}");
    }

    @Test
    void theShorterConstructorLeavesUsabilitySettingsUnset() {
        // The eight-arg constructor is what seeding and registration use:
        // a brand-new account has no client settings document yet, and the
        // client reads null as "keep whatever is on this device".
        UserPreferences preferences =
                new UserPreferences(
                        60,
                        List.of(TrainingType.SHOOTING),
                        Units.IMPERIAL,
                        MetricKey.SHOOTING_PERCENTAGE,
                        ChartType.LINE,
                        true,
                        false,
                        new NotificationPreferences(true, true, false, true));

        assertThat(preferences.getUsabilitySettings()).isNull();
    }

    @Test
    void theLongerConstructorKeepsTheUsabilitySettingsDocumentVerbatim() {
        // Stored opaquely on purpose -- the server must not normalise,
        // re-serialise or validate the client's schema, or a newer client
        // writing a field this build does not know about would lose it.
        String document = "{\"version\":2,\"theme\":\"light\",\"shortcuts\":{\"nav.live\":\"alt+9\"}}";
        UserPreferences preferences =
                new UserPreferences(
                        60,
                        List.of(TrainingType.SHOOTING),
                        Units.IMPERIAL,
                        MetricKey.SHOOTING_PERCENTAGE,
                        ChartType.LINE,
                        true,
                        false,
                        new NotificationPreferences(true, true, false, true),
                        document);

        assertThat(preferences.getUsabilitySettings()).isEqualTo(document);
    }

    @Test
    void constructorDefensivelyCopiesThePreferredTrainingTypesList() {
        List<TrainingType> mutableSource = new java.util.ArrayList<>(List.of(TrainingType.SHOOTING));
        UserPreferences preferences =
                new UserPreferences(
                        60,
                        mutableSource,
                        Units.IMPERIAL,
                        MetricKey.SHOOTING_PERCENTAGE,
                        ChartType.LINE,
                        true,
                        false,
                        new NotificationPreferences(true, true, false, true));

        mutableSource.add(TrainingType.SKILLS);

        assertThat(preferences.getPreferredTrainingTypes()).containsExactly(TrainingType.SHOOTING);
    }
}
