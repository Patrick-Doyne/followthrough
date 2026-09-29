package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.followthrough.api.domain.ChartType;
import com.followthrough.api.domain.MetricKey;
import com.followthrough.api.domain.NotificationPreferences;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.TrainingType;
import com.followthrough.api.domain.Units;
import com.followthrough.api.domain.UsageStats;
import com.followthrough.api.domain.User;
import com.followthrough.api.domain.UserPreferences;
import com.followthrough.api.dto.user.NotificationPreferencesUpdateRequest;
import com.followthrough.api.dto.user.UserPreferencesUpdateRequest;
import com.followthrough.api.dto.user.UserResponse;
import com.followthrough.api.dto.user.UserUpdateRequest;
import com.followthrough.api.exception.ResourceNotFoundException;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.security.CurrentUser;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    private static final String USER_ID = "user-001";

    @Mock private UserRepository userRepository;
    @Mock private CurrentUser currentUser;

    private UserService userService;
    private User seededUser;

    @BeforeEach
    void setUp() {
        when(currentUser.userId()).thenReturn(USER_ID);
        userService = new UserService(userRepository, currentUser);
        seededUser =
                new User(
                        USER_ID,
                        "Patrick Doyne",
                        "patrick.doyne@followthrough.app",
                        "hashed-password",
                        "Combo Guard",
                        "Riverside Elite",
                        "PD",
                        SubscriptionTier.BASIC,
                        new UsageStats(9, 25, 12.4, 50, 84, 120),
                        new UserPreferences(
                                75,
                                List.of(TrainingType.SHOOTING, TrainingType.SKILLS),
                                Units.IMPERIAL,
                                MetricKey.SHOOTING_PERCENTAGE,
                                ChartType.LINE,
                                true,
                                false,
                                new NotificationPreferences(true, true, false, true)));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(seededUser));
    }

    @Test
    void updatingOnlyNameLeavesEverythingElseUntouched() {
        UserResponse result =
                userService.updateCurrentUser(
                        new UserUpdateRequest("Pat Doyne", null, null, null, null, null));

        assertThat(result.name()).isEqualTo("Pat Doyne");
        assertThat(result.position()).isEqualTo("Combo Guard");
        assertThat(result.team()).isEqualTo("Riverside Elite");
        assertThat(result.tier()).isEqualTo(SubscriptionTier.BASIC);
        assertThat(result.preferences().units()).isEqualTo(Units.IMPERIAL);
    }

    @Test
    void switchingTierDoesNotTouchPreferences() {
        UserResponse result =
                userService.updateCurrentUser(
                        new UserUpdateRequest(null, null, null, null, SubscriptionTier.PREMIUM, null));

        assertThat(result.tier()).isEqualTo(SubscriptionTier.PREMIUM);
        assertThat(result.preferences().defaultChartType()).isEqualTo(ChartType.LINE);
    }

    /** The other tests only ever patch a single field, so every "use the
     * existing value" branch in mergePreferences/mergeNotifications gets
     * covered but never the "use the patch value" branch for most fields.
     * A fully populated patch exercises the other side of every ternary. */
    @Test
    void aFullyPopulatedPatchReplacesEveryPreferenceAndNotificationField() {
        UserResponse result =
                userService.updateCurrentUser(
                        new UserUpdateRequest(
                                null,
                                null,
                                null,
                                null,
                                null,
                                new UserPreferencesUpdateRequest(
                                        45,
                                        List.of(TrainingType.CONDITIONING),
                                        Units.METRIC,
                                        MetricKey.SHOT_DISTANCE,
                                        ChartType.BAR,
                                        false,
                                        true,
                                        new NotificationPreferencesUpdateRequest(false, false, true, false),
                                        "{\"version\":2,\"theme\":\"light\"}")));

        assertThat(result.preferences().defaultSessionDuration()).isEqualTo(45);
        assertThat(result.preferences().preferredTrainingTypes())
                .containsExactly(TrainingType.CONDITIONING);
        assertThat(result.preferences().units()).isEqualTo(Units.METRIC);
        assertThat(result.preferences().defaultMetric()).isEqualTo(MetricKey.SHOT_DISTANCE);
        assertThat(result.preferences().defaultChartType()).isEqualTo(ChartType.BAR);
        assertThat(result.preferences().showTrendlines()).isFalse();
        assertThat(result.preferences().denseTables()).isTrue();
        assertThat(result.preferences().notifications().trainingReminders()).isFalse();
        assertThat(result.preferences().notifications().sessionCompletion()).isFalse();
        assertThat(result.preferences().notifications().weeklyDigest()).isTrue();
        assertThat(result.preferences().notifications().missedSession()).isFalse();
    }

    @Test
    void patchingPositionTeamAndAvatarInitialsReplacesEachOfThem() {
        UserResponse result =
                userService.updateCurrentUser(
                        new UserUpdateRequest(
                                null, "Shooting Guard", "Metro Ballers", "PDX", null, null));

        assertThat(result.position()).isEqualTo("Shooting Guard");
        assertThat(result.team()).isEqualTo("Metro Ballers");
        assertThat(result.avatarInitials()).isEqualTo("PDX");
    }

    @Test
    void aPreferencesPatchWithNoNotificationsSubPatchLeavesNotificationsUntouched() {
        UserResponse result =
                userService.updateCurrentUser(
                        new UserUpdateRequest(
                                null,
                                null,
                                null,
                                null,
                                null,
                                new UserPreferencesUpdateRequest(
                                        90, null, null, null, null, null, null, null, null)));

        assertThat(result.preferences().defaultSessionDuration()).isEqualTo(90);
        assertThat(result.preferences().notifications().trainingReminders()).isTrue();
        assertThat(result.preferences().notifications().sessionCompletion()).isTrue();
        assertThat(result.preferences().notifications().weeklyDigest()).isFalse();
        assertThat(result.preferences().notifications().missedSession()).isTrue();
    }

    @Test
    void aNotificationsPatchThatOmitsAFieldLeavesItAtItsExistingValue() {
        User customUser =
                new User(
                        USER_ID,
                        "Someone Else",
                        "someone@followthrough.app",
                        "hashed-password",
                        "Center",
                        "Other Team",
                        "SE",
                        SubscriptionTier.FREE,
                        new UsageStats(1, 5, 2.0, 10, 5, 30),
                        new UserPreferences(
                                60,
                                List.of(TrainingType.SKILLS),
                                Units.METRIC,
                                MetricKey.SHOT_DISTANCE,
                                ChartType.BAR,
                                false,
                                true,
                                new NotificationPreferences(false, false, true, false)));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(customUser));

        UserResponse result =
                userService.updateCurrentUser(
                        new UserUpdateRequest(
                                null,
                                null,
                                null,
                                null,
                                null,
                                new UserPreferencesUpdateRequest(
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        new NotificationPreferencesUpdateRequest(true, null, null, null),
                                        null)));

        assertThat(result.preferences().notifications().trainingReminders()).isTrue();
        assertThat(result.preferences().notifications().weeklyDigest())
                .as("omitted field should keep the existing value, not reset it")
                .isTrue();
    }

    @Test
    void currentUserLookupThrowsWhenNoUserHasBeenSeededYet() {
        when(userRepository.findById(USER_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userService.getCurrentUser())
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("No user has been seeded yet");
    }

    @Test
    void aUsabilitySettingsDocumentIsStoredVerbatimAndReturnedToTheClient() {
        // The whole point of syncing it is that another device gets back
        // exactly what this one wrote, so any reformatting would be a bug.
        String document =
                "{\"version\":2,\"theme\":\"light\",\"textScale\":\"large\",\"shortcuts\":{}}";

        UserResponse result =
                userService.updateCurrentUser(
                        new UserUpdateRequest(
                                null,
                                null,
                                null,
                                null,
                                null,
                                new UserPreferencesUpdateRequest(
                                        null, null, null, null, null, null, null, null, document)));

        assertThat(result.preferences().usabilitySettings()).isEqualTo(document);
    }

    @Test
    void aPatchThatOmitsUsabilitySettingsLeavesTheStoredDocumentAlone() {
        // Every other tab on the settings page patches preferences without
        // knowing about this field; none of them may wipe it.
        String document = "{\"version\":2,\"theme\":\"dark\"}";
        userService.updateCurrentUser(
                new UserUpdateRequest(
                        null,
                        null,
                        null,
                        null,
                        null,
                        new UserPreferencesUpdateRequest(
                                null, null, null, null, null, null, null, null, document)));

        UserResponse result =
                userService.updateCurrentUser(
                        new UserUpdateRequest(
                                null,
                                null,
                                null,
                                null,
                                null,
                                new UserPreferencesUpdateRequest(
                                        120, null, null, null, null, null, null, null, null)));

        assertThat(result.preferences().defaultSessionDuration()).isEqualTo(120);
        assertThat(result.preferences().usabilitySettings())
                .as("an unrelated preferences patch must not clear the settings document")
                .isEqualTo(document);
    }
}
