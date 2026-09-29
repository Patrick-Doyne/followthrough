package com.followthrough.api.config;

import com.followthrough.api.domain.CalendarEvent;
import com.followthrough.api.domain.CalendarEventStatus;
import com.followthrough.api.domain.ChartType;
import com.followthrough.api.domain.MetricKey;
import com.followthrough.api.domain.NotificationPreferences;
import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.domain.TrainingType;
import com.followthrough.api.domain.Units;
import com.followthrough.api.domain.UsageStats;
import com.followthrough.api.domain.User;
import com.followthrough.api.domain.UserPreferences;
import com.followthrough.api.domain.VideoAsset;
import com.followthrough.api.repository.CalendarEventRepository;
import com.followthrough.api.repository.TrainingSessionRepository;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.repository.VideoAssetRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeds a fresh database with a demo account and a small library of
 * plausible training sessions, videos and calendar events, so a new
 * checkout has something to look at before any real recording has been
 * processed. Aggregate stats are simple formulas; there is no shot-level
 * data (the real pipeline stores per-video telemetry, and a seeded session
 * has none, so its charts stay empty until a video is processed into it).
 *
 * <p>All of the seeded data is attached to one demo account (see
 * DEMO_EMAIL/DEMO_PASSWORD) rather than floating ownerless, so a fresh
 * checkout still has a fully working account reachable through the real
 * login flow. Runs only when the users table is empty: an existing
 * database, including its passwords, is left alone.
 */
@Component
public class DataSeeder implements CommandLineRunner {

    private record SessionBlueprint(
            String name, int daysAgo, int shots, double form, TrainingType type, String location, int durationMinutes) {
    }

    private static final List<SessionBlueprint> BLUEPRINT =
            List.of(
                    new SessionBlueprint("Catch & Shoot Circuit", 46, 62, -0.05, TrainingType.SHOOTING, "Riverside Fieldhouse", 74),
                    new SessionBlueprint("Perimeter Volume Block", 39, 78, -0.03, TrainingType.SHOOTING, "Riverside Fieldhouse", 88),
                    new SessionBlueprint("Off-Dribble Pull-Ups", 33, 54, 0.0, TrainingType.SKILLS, "North Gym", 61),
                    new SessionBlueprint("Free Throw + Fatigue Set", 27, 66, 0.02, TrainingType.CONDITIONING, "North Gym", 70),
                    new SessionBlueprint("Corner Three Emphasis", 21, 58, 0.01, TrainingType.SHOOTING, "Riverside Fieldhouse", 65),
                    new SessionBlueprint("Movement Shooting", 14, 82, 0.04, TrainingType.SKILLS, "Performance Center", 92),
                    new SessionBlueprint("Game Speed Reps", 8, 71, 0.05, TrainingType.SCRIMMAGE, "Performance Center", 80),
                    new SessionBlueprint("Pre-Camp Tune Up", 3, 64, 0.07, TrainingType.SHOOTING, "Riverside Fieldhouse", 68),
                    new SessionBlueprint("Morning Shootaround", 1, 45, 0.06, TrainingType.SHOOTING, "North Gym", 48));

    private static final Instant NOW = Instant.parse("2026-08-14T12:00:00.00Z");

    /** Local-dev-only demo credentials -- log in with these against a fresh
     * checkout to see the seeded sessions/videos/calendar below. */
    private static final String DEMO_EMAIL = "patrick.doyne@followthrough.app";
    private static final String DEMO_PASSWORD = "followthrough-dev";

    private final UserRepository userRepository;
    private final TrainingSessionRepository sessionRepository;
    private final VideoAssetRepository videoRepository;
    private final CalendarEventRepository calendarEventRepository;
    private final PasswordEncoder passwordEncoder;

    public DataSeeder(
            UserRepository userRepository,
            TrainingSessionRepository sessionRepository,
            VideoAssetRepository videoRepository,
            CalendarEventRepository calendarEventRepository,
            PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.videoRepository = videoRepository;
        this.calendarEventRepository = calendarEventRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(String... args) {
        User demoUser = resolveDemoUser();
        if (sessionRepository.count() == 0) {
            seedSessionsAndVideos(demoUser);
        }
        if (calendarEventRepository.count() == 0) {
            seedCalendarEvents(demoUser);
        }
    }

    /** Seeds the demo account the first time this ever runs against an
     * empty database; every later run (and every run against a database
     * that already has other real accounts in it) just reuses it. */
    private User resolveDemoUser() {
        if (userRepository.count() == 0) {
            return seedUser();
        }
        return userRepository
                .findByEmail(DEMO_EMAIL)
                .orElseThrow(
                        () ->
                                new IllegalStateException(
                                        "Expected a seeded demo user at " + DEMO_EMAIL + " but found none"));
    }

    private User seedUser() {
        return userRepository.save(
                new User(
                        "user-001",
                        "Patrick Doyne",
                        DEMO_EMAIL,
                        passwordEncoder.encode(DEMO_PASSWORD),
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
                                new NotificationPreferences(true, true, false, true))));
    }

    private void seedSessionsAndVideos(User owner) {
        for (int i = 0; i < BLUEPRINT.size(); i++) {
            SessionBlueprint bp = BLUEPRINT.get(i);
            String sessionId = "session-%03d".formatted(i + 1);
            Instant date = NOW.minus(bp.daysAgo(), ChronoUnit.DAYS);

            double accuracy = Math.min(0.94, Math.max(0.08, 0.46 + bp.form()));
            int makes = (int) Math.round(bp.shots() * accuracy);
            double shootingPercentage = round1(makes * 100.0 / bp.shots());
            ProcessingStatus status =
                    bp.daysAgo() <= 1 ? ProcessingStatus.PROCESSING : ProcessingStatus.COMPLETE;

            TrainingSession session =
                    sessionRepository.save(
                            new TrainingSession(
                                    sessionId,
                                    owner,
                                    bp.name(),
                                    date,
                                    bp.durationMinutes(),
                                    bp.shots(),
                                    makes,
                                    shootingPercentage,
                                    14.5,
                                    1.0,
                                    0.6,
                                    status,
                                    bp.location(),
                                    bp.type()));

            int analyzedShots =
                    status == ProcessingStatus.COMPLETE ? bp.shots() : (int) Math.floor(bp.shots() * 0.4);

            videoRepository.save(
                    new VideoAsset(
                            "video-%03d".formatted(i + 1),
                            session,
                            bp.name(),
                            date,
                            bp.durationMinutes() * 60,
                            status,
                            analyzedShots,
                            shootingPercentage,
                            "",
                            "sessions/%s/recording.mp4".formatted(sessionId),
                            round1(bp.durationMinutes() * 18.4)));
        }
    }

    private void seedCalendarEvents(User owner) {
        List<TrainingSession> mostRecentFirst = sessionRepository.findAllByUser_UserIdOrderByDateDesc(owner.getUserId());

        int index = 1;
        for (TrainingSession session : mostRecentFirst.stream().limit(6).toList()) {
            LocalDate date = session.getDate().atZone(ZoneOffset.UTC).toLocalDate();
            calendarEventRepository.save(
                    new CalendarEvent(
                            "event-past-" + index,
                            owner,
                            session.getName(),
                            date,
                            LocalTime.of(17, 15),
                            LocalTime.of(18, 15),
                            session.getLocation(),
                            "Auto-created from recorded session.",
                            session.getTrainingType(),
                            "Hold shot duration under 1.1s from the arc.",
                            CalendarEventStatus.COMPLETED,
                            session));
            index++;
        }

        calendarEventRepository.save(
                new CalendarEvent(
                        "event-missed-1",
                        owner,
                        "Recovery + Mobility",
                        dateOffset(5),
                        LocalTime.of(8, 0),
                        LocalTime.of(9, 0),
                        "Performance Center",
                        "Skipped -- travel day.",
                        TrainingType.RECOVERY,
                        null,
                        CalendarEventStatus.MISSED,
                        null));

        calendarEventRepository.save(
                new CalendarEvent(
                        "event-up-1",
                        owner,
                        "Three-Point Volume Block",
                        dateOffset(-1),
                        LocalTime.of(17, 0),
                        LocalTime.of(18, 30),
                        "Riverside Fieldhouse",
                        "300 attempt target, camera on tripod at baseline.",
                        TrainingType.SHOOTING,
                        "38%+ from the arc across all racks.",
                        CalendarEventStatus.UPCOMING,
                        null));

        calendarEventRepository.save(
                new CalendarEvent(
                        "event-up-2",
                        owner,
                        "Off-Dribble Skills",
                        dateOffset(-3),
                        LocalTime.of(10, 0),
                        LocalTime.of(11, 15),
                        "North Gym",
                        null,
                        TrainingType.SKILLS,
                        null,
                        CalendarEventStatus.UPCOMING,
                        null));

        calendarEventRepository.save(
                new CalendarEvent(
                        "event-up-3",
                        owner,
                        "Conditioning + Free Throws",
                        dateOffset(-6),
                        LocalTime.of(7, 30),
                        LocalTime.of(8, 45),
                        "Performance Center",
                        null,
                        TrainingType.CONDITIONING,
                        "85% FT under fatigue.",
                        CalendarEventStatus.UPCOMING,
                        null));

        calendarEventRepository.save(
                new CalendarEvent(
                        "event-up-4",
                        owner,
                        "Live Scrimmage Capture",
                        dateOffset(-9),
                        LocalTime.of(18, 0),
                        LocalTime.of(20, 0),
                        "Riverside Fieldhouse",
                        null,
                        TrainingType.SCRIMMAGE,
                        null,
                        CalendarEventStatus.UPCOMING,
                        null));
    }

    private static LocalDate dateOffset(int daysAgo) {
        return NOW.minus(daysAgo, ChronoUnit.DAYS).atZone(ZoneOffset.UTC).toLocalDate();
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
