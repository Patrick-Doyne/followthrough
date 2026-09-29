package com.followthrough.api.service;

import com.followthrough.api.domain.NotificationPreferences;
import com.followthrough.api.domain.User;
import com.followthrough.api.domain.UserPreferences;
import com.followthrough.api.dto.user.NotificationPreferencesResponse;
import com.followthrough.api.dto.user.NotificationPreferencesUpdateRequest;
import com.followthrough.api.dto.user.UsageResponse;
import com.followthrough.api.dto.user.UserPreferencesResponse;
import com.followthrough.api.dto.user.UserPreferencesUpdateRequest;
import com.followthrough.api.dto.user.UserResponse;
import com.followthrough.api.dto.user.UserUpdateRequest;
import com.followthrough.api.exception.ResourceNotFoundException;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * "Current user" is resolved from the authenticated request (see
 * CurrentUser/JwtAuthenticationFilter), not from any request parameter --
 * every endpoint here only ever acts on the caller's own account.
 */
@Service
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final CurrentUser currentUser;

    public UserService(UserRepository userRepository, CurrentUser currentUser) {
        this.userRepository = userRepository;
        this.currentUser = currentUser;
    }

    public UserResponse getCurrentUser() {
        return toResponse(findCurrentUser());
    }

    @Transactional
    public UserResponse updateCurrentUser(UserUpdateRequest request) {
        User user = findCurrentUser();

        if (request.name() != null) {
            user.setName(request.name());
        }
        if (request.position() != null) {
            user.setPosition(request.position());
        }
        if (request.team() != null) {
            user.setTeam(request.team());
        }
        if (request.avatarInitials() != null) {
            user.setAvatarInitials(request.avatarInitials());
        }
        if (request.tier() != null) {
            user.setTier(request.tier());
        }
        if (request.preferences() != null) {
            user.setPreferences(mergePreferences(user.getPreferences(), request.preferences()));
        }

        return toResponse(user);
    }

    private User findCurrentUser() {
        return userRepository
                .findById(currentUser.userId())
                .orElseThrow(() -> new ResourceNotFoundException("No user has been seeded yet"));
    }

    private UserPreferences mergePreferences(
            UserPreferences existing, UserPreferencesUpdateRequest patch) {
        return new UserPreferences(
                patch.defaultSessionDuration() != null
                        ? patch.defaultSessionDuration()
                        : existing.getDefaultSessionDuration(),
                patch.preferredTrainingTypes() != null
                        ? patch.preferredTrainingTypes()
                        : existing.getPreferredTrainingTypes(),
                patch.units() != null ? patch.units() : existing.getUnits(),
                patch.defaultMetric() != null ? patch.defaultMetric() : existing.getDefaultMetric(),
                patch.defaultChartType() != null
                        ? patch.defaultChartType()
                        : existing.getDefaultChartType(),
                patch.showTrendlines() != null ? patch.showTrendlines() : existing.isShowTrendlines(),
                patch.denseTables() != null ? patch.denseTables() : existing.isDenseTables(),
                patch.notifications() != null
                        ? mergeNotifications(existing.getNotifications(), patch.notifications())
                        : existing.getNotifications(),
                patch.usabilitySettings() != null
                        ? patch.usabilitySettings()
                        : existing.getUsabilitySettings());
    }

    private NotificationPreferences mergeNotifications(
            NotificationPreferences existing, NotificationPreferencesUpdateRequest patch) {
        return new NotificationPreferences(
                patch.trainingReminders() != null
                        ? patch.trainingReminders()
                        : existing.isTrainingReminders(),
                patch.sessionCompletion() != null
                        ? patch.sessionCompletion()
                        : existing.isSessionCompletion(),
                patch.weeklyDigest() != null ? patch.weeklyDigest() : existing.isWeeklyDigest(),
                patch.missedSession() != null ? patch.missedSession() : existing.isMissedSession());
    }

    /** Package-private (not private) so AuthService can reuse it when
     * building the response to a fresh register()/login() call, rather than
     * duplicating this mapping. */
    static UserResponse toResponse(User user) {
        UserPreferences prefs = user.getPreferences();
        NotificationPreferences notifications = prefs.getNotifications();

        return new UserResponse(
                user.getUserId(),
                user.getName(),
                user.getEmail(),
                user.getPosition(),
                user.getTeam(),
                user.getAvatarInitials(),
                user.getTier(),
                new UsageResponse(
                        user.getUsage().getVideosProcessed(),
                        user.getUsage().getVideoLimit(),
                        user.getUsage().getStorageUsedGb(),
                        user.getUsage().getStorageLimitGb(),
                        user.getUsage().getLiveMinutesUsed(),
                        user.getUsage().getLiveMinutesLimit()),
                new UserPreferencesResponse(
                        prefs.getDefaultSessionDuration(),
                        prefs.getPreferredTrainingTypes(),
                        prefs.getUnits(),
                        prefs.getDefaultMetric(),
                        prefs.getDefaultChartType(),
                        prefs.isShowTrendlines(),
                        prefs.isDenseTables(),
                        new NotificationPreferencesResponse(
                                notifications.isTrainingReminders(),
                                notifications.isSessionCompletion(),
                                notifications.isWeeklyDigest(),
                                notifications.isMissedSession()),
                        prefs.getUsabilitySettings()));
    }
}
