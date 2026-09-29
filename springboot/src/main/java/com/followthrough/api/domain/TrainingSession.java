package com.followthrough.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * Session-level aggregate stats only (shots/makes counts, averages) — never
 * individual shot records. Per-shot telemetry is intentionally kept out of
 * this relational store; it is produced by the live pipeline and will be
 * queried from a non-relational store later.
 */
@Entity
@Table(name = "training_sessions")
public class TrainingSession {

    @Id
    @Column(name = "session_id")
    private String sessionId;

    /** Every session belongs to exactly one account -- see
     * TrainingSessionRepository's user-scoped finders. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Instant date;

    private int durationMinutes;
    private int shots;
    private int makes;
    private double shootingPercentage;
    private double avgShotDistance;
    private double avgShotDuration;
    private double avgTimeToApex;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProcessingStatus status;

    private String location;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TrainingType trainingType;

    protected TrainingSession() {
    }

    public TrainingSession(
            String sessionId,
            User user,
            String name,
            Instant date,
            int durationMinutes,
            int shots,
            int makes,
            double shootingPercentage,
            double avgShotDistance,
            double avgShotDuration,
            double avgTimeToApex,
            ProcessingStatus status,
            String location,
            TrainingType trainingType) {
        this.sessionId = sessionId;
        this.user = user;
        this.name = name;
        this.date = date;
        this.durationMinutes = durationMinutes;
        this.shots = shots;
        this.makes = makes;
        this.shootingPercentage = shootingPercentage;
        this.avgShotDistance = avgShotDistance;
        this.avgShotDuration = avgShotDuration;
        this.avgTimeToApex = avgTimeToApex;
        this.status = status;
        this.location = location;
        this.trainingType = trainingType;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }

    public String getSessionId() {
        return sessionId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Instant getDate() {
        return date;
    }

    public void setDate(Instant date) {
        this.date = date;
    }

    public int getDurationMinutes() {
        return durationMinutes;
    }

    public void setDurationMinutes(int durationMinutes) {
        this.durationMinutes = durationMinutes;
    }

    public int getShots() {
        return shots;
    }

    public void setShots(int shots) {
        this.shots = shots;
    }

    public int getMakes() {
        return makes;
    }

    public void setMakes(int makes) {
        this.makes = makes;
    }

    public double getShootingPercentage() {
        return shootingPercentage;
    }

    public void setShootingPercentage(double shootingPercentage) {
        this.shootingPercentage = shootingPercentage;
    }

    public double getAvgShotDistance() {
        return avgShotDistance;
    }

    public void setAvgShotDistance(double avgShotDistance) {
        this.avgShotDistance = avgShotDistance;
    }

    public double getAvgShotDuration() {
        return avgShotDuration;
    }

    public void setAvgShotDuration(double avgShotDuration) {
        this.avgShotDuration = avgShotDuration;
    }

    public double getAvgTimeToApex() {
        return avgTimeToApex;
    }

    public void setAvgTimeToApex(double avgTimeToApex) {
        this.avgTimeToApex = avgTimeToApex;
    }

    public ProcessingStatus getStatus() {
        return status;
    }

    public void setStatus(ProcessingStatus status) {
        this.status = status;
    }

    public String getLocation() {
        return location;
    }

    public void setLocation(String location) {
        this.location = location;
    }

    public TrainingType getTrainingType() {
        return trainingType;
    }

    public void setTrainingType(TrainingType trainingType) {
        this.trainingType = trainingType;
    }
}
