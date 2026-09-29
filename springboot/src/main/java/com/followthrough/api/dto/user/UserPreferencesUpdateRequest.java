package com.followthrough.api.dto.user;

import com.followthrough.api.domain.ChartType;
import com.followthrough.api.domain.MetricKey;
import com.followthrough.api.domain.TrainingType;
import com.followthrough.api.domain.Units;
import java.util.List;

public record UserPreferencesUpdateRequest(
        Integer defaultSessionDuration,
        List<TrainingType> preferredTrainingTypes,
        Units units,
        MetricKey defaultMetric,
        ChartType defaultChartType,
        Boolean showTrendlines,
        Boolean denseTables,
        NotificationPreferencesUpdateRequest notifications,
        String usabilitySettings) {
}
