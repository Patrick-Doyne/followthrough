package com.followthrough.api.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class MetricKeyTest {

    @Test
    void everyConstantRoundTripsThroughItsWireValue() {
        for (MetricKey key : MetricKey.values()) {
            assertThat(MetricKey.fromWireValue(key.wireValue())).isEqualTo(key);
        }
    }

    @Test
    void anUnrecognisedWireValueThrows() {
        assertThatThrownBy(() -> MetricKey.fromWireValue("not-a-real-metric"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not-a-real-metric");
    }
}
