package com.followthrough.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

/**
 * The relational stand-in for a future per-video NoSQL telemetry
 * document store (see TelemetryStore) -- one row per video, holding the
 * full ordered frame/shot_event stream as a single JSON array. Not
 * normalized into one row per message: a multi-minute clip at ~30fps is
 * thousands of messages, and a future NoSQL swap would naturally shape
 * one document per video anyway, so this stand-in is shaped the same way
 * now rather than needing to be remodeled later.
 */
@Entity
@Table(name = "video_telemetry_records")
public class VideoTelemetryRecord {

    @Id
    @Column(name = "video_id")
    private String videoId;

    @Column(nullable = false)
    private double fps;

    @Lob
    @Column(nullable = false)
    private String payloadJson;

    protected VideoTelemetryRecord() {
    }

    public VideoTelemetryRecord(String videoId, double fps, String payloadJson) {
        this.videoId = videoId;
        this.fps = fps;
        this.payloadJson = payloadJson;
    }

    public String getVideoId() {
        return videoId;
    }

    public double getFps() {
        return fps;
    }

    public String getPayloadJson() {
        return payloadJson;
    }
}
