package com.followthrough.api.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Scoped to only the fields UserService/AuthService never touch via a
 * setter -- everything else (name, position, team, avatarInitials, tier,
 * preferences) already gets exercised with real assertions via
 * UserServiceTest/AuthServiceTest. Duplicating those here would just be
 * redundant coverage of the exact same setters. */
class UserTest {

    @Test
    void setEmailAndSetUsageOverwriteTheValuesTheConstructorSet() {
        UsageStats originalUsage = new UsageStats(9, 25, 12.4, 50, 84, 120);
        UsageStats updatedUsage = new UsageStats(10, 30, 15.0, 60, 90, 150);
        User user =
                new User(
                        "user-001",
                        "Patrick Doyne",
                        "original@followthrough.app",
                        "hash",
                        "Combo Guard",
                        "Riverside Elite",
                        "PD",
                        SubscriptionTier.BASIC,
                        originalUsage,
                        new UserPreferences(
                                60,
                                List.of(),
                                Units.IMPERIAL,
                                MetricKey.SHOOTING_PERCENTAGE,
                                ChartType.LINE,
                                true,
                                false,
                                new NotificationPreferences(true, true, true, true)));

        user.setEmail("updated@followthrough.app");
        user.setUsage(updatedUsage);
        user.setPasswordHash("a-different-hash");

        assertThat(user.getEmail()).isEqualTo("updated@followthrough.app");
        assertThat(user.getUsage()).isSameAs(updatedUsage);
        assertThat(user.getPasswordHash()).isEqualTo("a-different-hash");
    }
}
