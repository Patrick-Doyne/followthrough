package com.followthrough.api.service;

import com.followthrough.api.domain.VideoTelemetryRecord;
import com.followthrough.api.repository.VideoTelemetryRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** See TelemetryStore's own doc comment for why this is a relational
 * stand-in rather than the eventual real store. */
@Service
public class RelationalTelemetryStore implements TelemetryStore {

    private final VideoTelemetryRepository repository;
    private final ObjectMapper objectMapper;

    public RelationalTelemetryStore(VideoTelemetryRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public void save(String videoId, double fps, List<JsonNode> messages) {
        String payloadJson = objectMapper.writeValueAsString(messages);
        repository.save(new VideoTelemetryRecord(videoId, fps, payloadJson));
    }

    @Override
    @Transactional
    public void delete(String videoId) {
        repository.deleteById(videoId);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<TelemetryBundle> load(String videoId) {
        return repository.findById(videoId).map(this::toBundle);
    }

    private TelemetryBundle toBundle(VideoTelemetryRecord record) {
        JsonNode array = objectMapper.readTree(record.getPayloadJson());
        List<JsonNode> messages = new ArrayList<>();
        array.forEach(messages::add);
        return new TelemetryBundle(record.getFps(), messages);
    }
}
