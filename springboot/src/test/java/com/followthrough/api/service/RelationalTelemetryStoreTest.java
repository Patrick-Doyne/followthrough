package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.followthrough.api.repository.VideoTelemetryRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** @DataJpaTest for the real repository round-trip (save/load through
 * real H2 + Hibernate, not a mock) -- see RepositoryIntegrationTest for
 * why this slice is used elsewhere in this suite. */
@DataJpaTest
class RelationalTelemetryStoreTest {

    @Autowired private VideoTelemetryRepository repository;

    @Test
    void savingThenLoadingReturnsTheSameFpsAndMessages() {
        RelationalTelemetryStore store = new RelationalTelemetryStore(repository, new JsonMapper());
        JsonMapper mapper = new JsonMapper();
        JsonNode frame = mapper.readTree("{\"type\":\"frame\",\"frame_id\":0}");
        JsonNode shotEvent = mapper.readTree("{\"type\":\"shot_event\",\"frame_id\":30,\"makes\":1,\"misses\":0}");

        store.save("video-001", 59.94, List.of(frame, shotEvent));

        Optional<TelemetryStore.TelemetryBundle> loaded = store.load("video-001");

        assertThat(loaded).isPresent();
        assertThat(loaded.get().fps()).isEqualTo(59.94);
        assertThat(loaded.get().messages()).hasSize(2);
        assertThat(loaded.get().messages().get(0).path("type").asString()).isEqualTo("frame");
        assertThat(loaded.get().messages().get(1).path("type").asString()).isEqualTo("shot_event");
        assertThat(repository.findById("video-001").orElseThrow().getVideoId()).isEqualTo("video-001");
    }

    @Test
    void loadingAnUnknownVideoIdReturnsEmpty() {
        RelationalTelemetryStore store = new RelationalTelemetryStore(repository, new JsonMapper());

        assertThat(store.load("does-not-exist")).isEmpty();
    }

    @Test
    void savingAgainForTheSameVideoIdReplacesThePreviousPayload() {
        RelationalTelemetryStore store = new RelationalTelemetryStore(repository, new JsonMapper());
        JsonMapper mapper = new JsonMapper();
        store.save("video-001", 30.0, List.of(mapper.readTree("{\"type\":\"frame\",\"frame_id\":0}")));

        store.save("video-001", 60.0, List.of());

        TelemetryStore.TelemetryBundle loaded = store.load("video-001").orElseThrow();
        assertThat(loaded.fps()).isEqualTo(60.0);
        assertThat(loaded.messages()).isEmpty();
    }
}
