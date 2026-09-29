package com.followthrough.api.domain;

import jakarta.persistence.Embeddable;

@Embeddable
public class NotificationPreferences {

    private boolean trainingReminders;
    private boolean sessionCompletion;
    private boolean weeklyDigest;
    private boolean missedSession;

    protected NotificationPreferences() {
    }

    public NotificationPreferences(
            boolean trainingReminders,
            boolean sessionCompletion,
            boolean weeklyDigest,
            boolean missedSession) {
        this.trainingReminders = trainingReminders;
        this.sessionCompletion = sessionCompletion;
        this.weeklyDigest = weeklyDigest;
        this.missedSession = missedSession;
    }

    public boolean isTrainingReminders() {
        return trainingReminders;
    }

    public void setTrainingReminders(boolean trainingReminders) {
        this.trainingReminders = trainingReminders;
    }

    public boolean isSessionCompletion() {
        return sessionCompletion;
    }

    public void setSessionCompletion(boolean sessionCompletion) {
        this.sessionCompletion = sessionCompletion;
    }

    public boolean isWeeklyDigest() {
        return weeklyDigest;
    }

    public void setWeeklyDigest(boolean weeklyDigest) {
        this.weeklyDigest = weeklyDigest;
    }

    public boolean isMissedSession() {
        return missedSession;
    }

    public void setMissedSession(boolean missedSession) {
        this.missedSession = missedSession;
    }
}
