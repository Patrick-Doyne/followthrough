package com.followthrough.api.repository;

import com.followthrough.api.domain.VideoTelemetryRecord;
import org.springframework.data.jpa.repository.JpaRepository;

public interface VideoTelemetryRepository extends JpaRepository<VideoTelemetryRecord, String> {
}
