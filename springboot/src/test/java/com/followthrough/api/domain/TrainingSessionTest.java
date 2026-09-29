package com.followthrough.api.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/** TrainingSession's setters exist for UserService-style partial updates on
 * other entities, but nothing exercises this entity's own setters yet --
 * this locks in that they actually mutate the field they claim to. */
class TrainingSessionTest {

    @Test
    void settersOverwriteTheValuesTheAllArgsConstructorSet() {
        User owner = fakeUser("user-001");
        User otherOwner = fakeUser("user-002");
        TrainingSession session =
                new TrainingSession(
                        "session-001",
                        owner,
                        "Morning Shootaround",
                        Instant.parse("2026-01-01T12:00:00Z"),
                        60,
                        50,
                        30,
                        60.0,
                        18.5,
                        1.2,
                        0.6,
                        ProcessingStatus.COMPLETE,
                        "Main Gym",
                        TrainingType.SHOOTING);

        session.setUser(otherOwner);
        session.setName("Evening Shootaround");
        session.setDate(Instant.parse("2026-02-01T18:00:00Z"));
        session.setDurationMinutes(90);
        session.setShots(80);
        session.setMakes(45);
        session.setShootingPercentage(56.25);
        session.setAvgShotDistance(20.1);
        session.setAvgShotDuration(1.3);
        session.setAvgTimeToApex(0.7);
        session.setStatus(ProcessingStatus.PROCESSING);
        session.setLocation("Practice Gym");
        session.setTrainingType(TrainingType.CONDITIONING);

        assertThat(session.getSessionId()).isEqualTo("session-001");
        assertThat(session.getName()).isEqualTo("Evening Shootaround");
        assertThat(session.getDate()).isEqualTo(Instant.parse("2026-02-01T18:00:00Z"));
        assertThat(session.getDurationMinutes()).isEqualTo(90);
        assertThat(session.getShots()).isEqualTo(80);
        assertThat(session.getMakes()).isEqualTo(45);
        assertThat(session.getShootingPercentage()).isEqualTo(56.25);
        assertThat(session.getAvgShotDistance()).isEqualTo(20.1);
        assertThat(session.getAvgShotDuration()).isEqualTo(1.3);
        assertThat(session.getAvgTimeToApex()).isEqualTo(0.7);
        assertThat(session.getStatus()).isEqualTo(ProcessingStatus.PROCESSING);
        assertThat(session.getLocation()).isEqualTo("Practice Gym");
        assertThat(session.getTrainingType()).isEqualTo(TrainingType.CONDITIONING);
        assertThat(session.getUser()).isSameAs(otherOwner);
    }

    private static User fakeUser(String userId) {
        return new User(
                userId, "Test User", userId + "@followthrough.app", "hash", null, null, null,
                SubscriptionTier.FREE, null, null);
    }
}
