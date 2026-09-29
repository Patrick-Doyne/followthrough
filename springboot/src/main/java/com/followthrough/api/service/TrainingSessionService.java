package com.followthrough.api.service;

import com.followthrough.api.domain.CalendarEvent;
import com.followthrough.api.domain.ProcessingStatus;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.dto.session.TrainingSessionRequest;
import com.followthrough.api.dto.session.TrainingSessionResponse;
import com.followthrough.api.exception.ResourceNotFoundException;
import com.followthrough.api.repository.CalendarEventRepository;
import com.followthrough.api.repository.TrainingSessionRepository;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.repository.VideoAssetRepository;
import com.followthrough.api.security.CurrentUser;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Deliberately unpaginated: every current consumer (the dashboard, the
 * analytics session-filter picker, session comparison) needs the complete
 * session list to work correctly, not one page of it. Only /videos is
 * paginated, because only the video library grows without bound (see
 * videosService in the frontend's services/followthrough.ts).
 * Every query here is scoped to the caller's own account (see CurrentUser)
 * -- a session id that exists but belongs to someone else looks identical
 * to one that doesn't exist at all.
 */
@Service
@Transactional(readOnly = true)
public class TrainingSessionService {

    private final TrainingSessionRepository sessionRepository;
    private final VideoAssetRepository videoRepository;
    private final CalendarEventRepository calendarEventRepository;
    private final UserRepository userRepository;
    private final CurrentUser currentUser;

    public TrainingSessionService(
            TrainingSessionRepository sessionRepository,
            VideoAssetRepository videoRepository,
            CalendarEventRepository calendarEventRepository,
            UserRepository userRepository,
            CurrentUser currentUser) {
        this.sessionRepository = sessionRepository;
        this.videoRepository = videoRepository;
        this.calendarEventRepository = calendarEventRepository;
        this.userRepository = userRepository;
        this.currentUser = currentUser;
    }

    public List<TrainingSessionResponse> list() {
        return sessionRepository.findAllByUser_UserIdOrderByDateDesc(currentUser.userId()).stream()
                .map(TrainingSessionService::toResponse)
                .toList();
    }

    public TrainingSessionResponse get(String sessionId) {
        return toResponse(findSessionOrThrow(sessionId));
    }

    /** Starts at all-zero stats and QUEUED status -- a session only ever
     * gets real numbers from live telemetry ingestion or offline video
     * processing, never from this request body directly. */
    @Transactional
    public TrainingSessionResponse create(TrainingSessionRequest request) {
        TrainingSession session =
                new TrainingSession(
                        UUID.randomUUID().toString(),
                        userRepository.getReferenceById(currentUser.userId()),
                        request.name(),
                        request.date(),
                        request.durationMinutes(),
                        0,
                        0,
                        0.0,
                        0.0,
                        0.0,
                        0.0,
                        ProcessingStatus.QUEUED,
                        request.location(),
                        request.trainingType());
        return toResponse(sessionRepository.save(session));
    }

    /** Only touches the fields TrainingSessionRequest carries -- shots,
     * makes, and the averages are left exactly as the pipeline last set
     * them. */
    @Transactional
    public TrainingSessionResponse update(String sessionId, TrainingSessionRequest request) {
        TrainingSession session = findSessionOrThrow(sessionId);
        session.setName(request.name());
        session.setDate(request.date());
        session.setDurationMinutes(request.durationMinutes());
        session.setLocation(request.location());
        session.setTrainingType(request.trainingType());
        return toResponse(session);
    }

    /** A session's videos belong to it (required FK) and are deleted with
     * it; a calendar event's link to it is optional, so those events lose
     * the link rather than being deleted themselves. */
    @Transactional
    public void delete(String sessionId) {
        TrainingSession session = findSessionOrThrow(sessionId);

        List<CalendarEvent> linkedEvents = calendarEventRepository.findBySession_SessionId(sessionId);
        linkedEvents.forEach(event -> event.setSession(null));

        videoRepository
                .findBySession_SessionIdAndSession_User_UserId(sessionId, currentUser.userId())
                .forEach(videoRepository::delete);

        sessionRepository.delete(session);
    }

    TrainingSession findSessionOrThrow(String sessionId) {
        return sessionRepository
                .findBySessionIdAndUser_UserId(sessionId, currentUser.userId())
                .orElseThrow(
                        () -> new ResourceNotFoundException("Session " + sessionId + " not found"));
    }

    static TrainingSessionResponse toResponse(TrainingSession session) {
        return new TrainingSessionResponse(
                session.getSessionId(),
                session.getName(),
                session.getDate(),
                session.getDurationMinutes(),
                session.getShots(),
                session.getMakes(),
                session.getShootingPercentage(),
                session.getAvgShotDistance(),
                session.getAvgShotDuration(),
                session.getAvgTimeToApex(),
                session.getStatus(),
                session.getLocation(),
                session.getTrainingType());
    }
}
