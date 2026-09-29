package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class TelemetryJsonlParserTest {

    private final TelemetryJsonlParser parser = new TelemetryJsonlParser(new JsonMapper());

    @Test
    void readsFpsFromTheLeadingMetadataLineAndExcludesItFromTheMessageList() {
        var parsed =
                parser.parse(
                        List.of(
                                "{\"type\":\"metadata\",\"fps\":59.94,\"frame_width\":3840,\"frame_height\":2160}",
                                "{\"type\":\"frame\",\"frame_id\":0}"));

        assertThat(parsed.fps()).isEqualTo(59.94);
        assertThat(parsed.messages()).hasSize(1);
        assertThat(parsed.messages().get(0).path("type").asString()).isEqualTo("frame");
    }

    @Test
    void aggregatesMakesAndMissesFromTheFinalShotEventLine() {
        var parsed =
                parser.parse(
                        List.of(
                                "{\"type\":\"metadata\",\"fps\":30.0}",
                                "{\"type\":\"shot_event\",\"frame_id\":10,\"result\":\"make\",\"makes\":1,\"misses\":0}",
                                "{\"type\":\"shot_event\",\"frame_id\":20,\"result\":\"miss\",\"makes\":1,\"misses\":1}",
                                "{\"type\":\"shot_event\",\"frame_id\":30,\"result\":\"make\",\"makes\":2,\"misses\":1}"));

        assertThat(parsed.result().analyzedShots()).isEqualTo(3);
        assertThat(parsed.result().shootingPercentage()).isCloseTo(66.666, org.assertj.core.data.Offset.offset(0.01));
    }

    @Test
    void averagesShotMetricsOnlyFromFramesWhereAShotActuallyCompleted() {
        var parsed =
                parser.parse(
                        List.of(
                                "{\"type\":\"metadata\",\"fps\":30.0}",
                                // no shot metrics on this frame -- must be excluded from the average
                                "{\"type\":\"frame\",\"frame_id\":5,\"shot_distance_ft\":null,\"shot_duration\":null,\"time_to_apex\":null}",
                                "{\"type\":\"frame\",\"frame_id\":10,\"shot_distance_ft\":10.0,\"shot_duration\":1.0,\"time_to_apex\":0.4}",
                                "{\"type\":\"frame\",\"frame_id\":20,\"shot_distance_ft\":20.0,\"shot_duration\":2.0,\"time_to_apex\":0.6}"));

        assertThat(parsed.result().avgShotDistance()).isEqualTo(15.0);
        assertThat(parsed.result().avgShotDuration()).isEqualTo(1.5);
        assertThat(parsed.result().avgTimeToApex()).isEqualTo(0.5);
    }

    @Test
    void withNoShotsAtAllEverythingIsZeroWithoutDividingByZero() {
        var parsed = parser.parse(List.of("{\"type\":\"metadata\",\"fps\":30.0}"));

        assertThat(parsed.result().analyzedShots()).isZero();
        assertThat(parsed.result().shootingPercentage()).isZero();
        assertThat(parsed.result().avgShotDistance()).isZero();
        assertThat(parsed.result().avgShotDuration()).isZero();
        assertThat(parsed.result().avgTimeToApex()).isZero();
    }

    @Test
    void aFrameWithOnlySomeShotMetricsPresentIsNotTreatedAsACompletedShot() {
        var parsed =
                parser.parse(
                        List.of(
                                "{\"type\":\"metadata\",\"fps\":30.0}",
                                // distance present but duration/time_to_apex missing --
                                // must not count as a completed shot
                                "{\"type\":\"frame\",\"frame_id\":5,\"shot_distance_ft\":10.0}",
                                // distance+duration present but time_to_apex missing --
                                // also must not count
                                "{\"type\":\"frame\",\"frame_id\":7,\"shot_distance_ft\":10.0,\"shot_duration\":1.0}",
                                "{\"type\":\"frame\",\"frame_id\":10,\"shot_distance_ft\":20.0,\"shot_duration\":2.0,\"time_to_apex\":0.6}"));

        assertThat(parsed.result().avgShotDistance()).isEqualTo(20.0);
    }

    @Test
    void aMessageTypeThatIsNeitherFrameNorShotEventIsKeptButIgnoredForAggregation() {
        var parsed =
                parser.parse(
                        List.of(
                                "{\"type\":\"metadata\",\"fps\":30.0}",
                                "{\"type\":\"something_else\",\"frame_id\":1}"));

        assertThat(parsed.messages()).hasSize(1);
        assertThat(parsed.result().analyzedShots()).isZero();
    }

    @Test
    void ignoresBlankLines() {
        var parsed =
                parser.parse(
                        List.of(
                                "{\"type\":\"metadata\",\"fps\":30.0}",
                                "",
                                "   ",
                                "{\"type\":\"frame\",\"frame_id\":0}"));

        assertThat(parsed.messages()).hasSize(1);
    }
}
