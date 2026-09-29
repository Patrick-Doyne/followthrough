package com.followthrough.api.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Java enum constants follow UPPER_SNAKE convention, but the frontend's wire
 * format uses camelCase literals (e.g. "shootingPercentage") — the
 * JsonValue/JsonCreator pair keeps the two in sync without leaking Java
 * naming into the API contract.
 */
public enum MetricKey {
    SHOOTING_PERCENTAGE("shootingPercentage"),
    SHOT_DISTANCE("shotDistance"),
    SHOT_DURATION("shotDuration"),
    TIME_TO_APEX("timeToApex"),
    SHOT_VOLUME("shotVolume"),
    MAKES("makes"),
    MISSES("misses");

    private final String wireValue;

    MetricKey(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static MetricKey fromWireValue(String value) {
        for (MetricKey key : values()) {
            if (key.wireValue.equals(value)) {
                return key;
            }
        }
        throw new IllegalArgumentException("Unknown metric key: " + value);
    }
}
