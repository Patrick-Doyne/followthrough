package com.followthrough.api.domain;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embeddable;
import jakarta.persistence.Embedded;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import java.util.ArrayList;
import java.util.List;

@Embeddable
public class UserPreferences {

    private int defaultSessionDuration;

    @ElementCollection(fetch = jakarta.persistence.FetchType.EAGER)
    @CollectionTable(
            name = "user_preferred_training_types",
            joinColumns = @JoinColumn(name = "user_id"))
    @Enumerated(EnumType.STRING)
    private List<TrainingType> preferredTrainingTypes = new ArrayList<>();

    @Enumerated(EnumType.STRING)
    private Units units;

    @Enumerated(EnumType.STRING)
    private MetricKey defaultMetric;

    @Enumerated(EnumType.STRING)
    private ChartType defaultChartType;

    private boolean showTrendlines;
    private boolean denseTables;

    @Embedded
    private NotificationPreferences notifications;

    /**
     * The client's usability settings document, stored verbatim as JSON.
     *
     * <p>Deliberately opaque to the server. The web client already owns
     * this schema, its version number and its migrations (see
     * state/settings.ts), so mirroring roughly thirty display preferences
     * into columns would duplicate all of that and turn every new setting
     * into a backend change plus a schema migration. What the server needs
     * to do -- hand the same document back on another device -- needs no
     * understanding of its contents.
     *
     * <p>Null for an account that has never saved any; clients treat that
     * as "use local settings".
     *
     * <p>Stored as a large object rather than a sized VARCHAR. The limit
     * used to be 8192 characters, which a real document had already
     * outgrown: choosing any non-default accent makes the client resolve
     * and persist all four palettes alongside the three colours that
     * generated them, and that document measures about 8.5KB. Every save
     * from such an account failed with a 500, so the theme lived in the
     * browser's local storage and silently never followed the account to
     * another device.
     *
     * <p>A sized limit is the wrong shape for this field anyway. The
     * server does not know what is in the document -- that is the whole
     * point of the paragraph above -- so it cannot know what a sensible
     * bound would be, and any number picked here is one the client can
     * outgrow again without the server noticing until a user hits it.
     */
    @Lob
    @Column(columnDefinition = "CLOB")
    private String usabilitySettings;

    protected UserPreferences() {
    }

    public UserPreferences(
            int defaultSessionDuration,
            List<TrainingType> preferredTrainingTypes,
            Units units,
            MetricKey defaultMetric,
            ChartType defaultChartType,
            boolean showTrendlines,
            boolean denseTables,
            NotificationPreferences notifications) {
        this(
                defaultSessionDuration,
                preferredTrainingTypes,
                units,
                defaultMetric,
                defaultChartType,
                showTrendlines,
                denseTables,
                notifications,
                null);
    }

    public UserPreferences(
            int defaultSessionDuration,
            List<TrainingType> preferredTrainingTypes,
            Units units,
            MetricKey defaultMetric,
            ChartType defaultChartType,
            boolean showTrendlines,
            boolean denseTables,
            NotificationPreferences notifications,
            String usabilitySettings) {
        this.defaultSessionDuration = defaultSessionDuration;
        this.preferredTrainingTypes = new ArrayList<>(preferredTrainingTypes);
        this.units = units;
        this.defaultMetric = defaultMetric;
        this.defaultChartType = defaultChartType;
        this.showTrendlines = showTrendlines;
        this.denseTables = denseTables;
        this.notifications = notifications;
        this.usabilitySettings = usabilitySettings;
    }

    public int getDefaultSessionDuration() {
        return defaultSessionDuration;
    }

    public void setDefaultSessionDuration(int defaultSessionDuration) {
        this.defaultSessionDuration = defaultSessionDuration;
    }

    public List<TrainingType> getPreferredTrainingTypes() {
        return preferredTrainingTypes;
    }

    public void setPreferredTrainingTypes(List<TrainingType> preferredTrainingTypes) {
        this.preferredTrainingTypes = new ArrayList<>(preferredTrainingTypes);
    }

    public Units getUnits() {
        return units;
    }

    public void setUnits(Units units) {
        this.units = units;
    }

    public MetricKey getDefaultMetric() {
        return defaultMetric;
    }

    public void setDefaultMetric(MetricKey defaultMetric) {
        this.defaultMetric = defaultMetric;
    }

    public ChartType getDefaultChartType() {
        return defaultChartType;
    }

    public void setDefaultChartType(ChartType defaultChartType) {
        this.defaultChartType = defaultChartType;
    }

    public boolean isShowTrendlines() {
        return showTrendlines;
    }

    public void setShowTrendlines(boolean showTrendlines) {
        this.showTrendlines = showTrendlines;
    }

    public boolean isDenseTables() {
        return denseTables;
    }

    public void setDenseTables(boolean denseTables) {
        this.denseTables = denseTables;
    }

    public NotificationPreferences getNotifications() {
        return notifications;
    }

    public void setNotifications(NotificationPreferences notifications) {
        this.notifications = notifications;
    }

    public String getUsabilitySettings() {
        return usabilitySettings;
    }

    public void setUsabilitySettings(String usabilitySettings) {
        this.usabilitySettings = usabilitySettings;
    }
}
