package com.followthrough.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * A real, stable String business key (not an internal auto-increment PK)
 * since that's what the frontend's API contract already expects. `email` is
 * the login identifier; `passwordHash` is a bcrypt hash (see
 * AuthService/SecurityConfig's PasswordEncoder bean) and is never exposed
 * through UserResponse.
 */
@Entity
@Table(name = "users")
public class User {

    @Id
    @Column(name = "user_id")
    private String userId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String passwordHash;

    private String position;
    private String team;
    private String avatarInitials;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SubscriptionTier tier;

    @Embedded
    private UsageStats usage;

    @Embedded
    private UserPreferences preferences;

    protected User() {
    }

    public User(
            String userId,
            String name,
            String email,
            String passwordHash,
            String position,
            String team,
            String avatarInitials,
            SubscriptionTier tier,
            UsageStats usage,
            UserPreferences preferences) {
        this.userId = userId;
        this.name = name;
        this.email = email;
        this.passwordHash = passwordHash;
        this.position = position;
        this.team = team;
        this.avatarInitials = avatarInitials;
        this.tier = tier;
        this.usage = usage;
        this.preferences = preferences;
    }

    public String getUserId() {
        return userId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getPosition() {
        return position;
    }

    public void setPosition(String position) {
        this.position = position;
    }

    public String getTeam() {
        return team;
    }

    public void setTeam(String team) {
        this.team = team;
    }

    public String getAvatarInitials() {
        return avatarInitials;
    }

    public void setAvatarInitials(String avatarInitials) {
        this.avatarInitials = avatarInitials;
    }

    public SubscriptionTier getTier() {
        return tier;
    }

    public void setTier(SubscriptionTier tier) {
        this.tier = tier;
    }

    public UsageStats getUsage() {
        return usage;
    }

    public void setUsage(UsageStats usage) {
        this.usage = usage;
    }

    public UserPreferences getPreferences() {
        return preferences;
    }

    public void setPreferences(UserPreferences preferences) {
        this.preferences = preferences;
    }
}
