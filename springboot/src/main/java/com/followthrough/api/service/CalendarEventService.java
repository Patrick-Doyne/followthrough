package com.followthrough.api.service;

import com.followthrough.api.domain.CalendarEvent;
import com.followthrough.api.domain.CalendarEventStatus;
import com.followthrough.api.domain.TrainingSession;
import com.followthrough.api.dto.calendar.CalendarEventRequest;
import com.followthrough.api.dto.calendar.CalendarEventResponse;
import com.followthrough.api.exception.ResourceNotFoundException;
import com.followthrough.api.repository.CalendarEventRepository;
import com.followthrough.api.repository.TrainingSessionRepository;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.security.CurrentUser;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * list() takes an optional date range rather than page/size: the calendar
 * page needs every event in its visible window (a sliding previous/current/
 * next-month range), not an arbitrary slice, and the dashboard's Reminders
 * widget needs every event regardless of month. Both are satisfied by "all
 * events, optionally restricted to a range" -- neither wants pagination.
 * Every query here is scoped to the caller's own account (see CurrentUser).
 */
@Service
@Transactional(readOnly = true)
public class CalendarEventService {

    private final CalendarEventRepository eventRepository;
    private final TrainingSessionRepository sessionRepository;
    private final UserRepository userRepository;
    private final CurrentUser currentUser;

    public CalendarEventService(
            CalendarEventRepository eventRepository,
            TrainingSessionRepository sessionRepository,
            UserRepository userRepository,
            CurrentUser currentUser) {
        this.eventRepository = eventRepository;
        this.sessionRepository = sessionRepository;
        this.userRepository = userRepository;
        this.currentUser = currentUser;
    }

    public List<CalendarEventResponse> list(LocalDate from, LocalDate to) {
        String userId = currentUser.userId();
        List<CalendarEvent> events =
                (from != null && to != null)
                        ? eventRepository.findByUser_UserIdAndDateBetweenOrderByDateAsc(userId, from, to)
                        : eventRepository.findAllByUser_UserIdOrderByDateAsc(userId);
        return events.stream().map(CalendarEventService::toResponse).toList();
    }

    @Transactional
    public CalendarEventResponse create(CalendarEventRequest request) {
        CalendarEvent event =
                new CalendarEvent(
                        UUID.randomUUID().toString(),
                        userRepository.getReferenceById(currentUser.userId()),
                        request.title(),
                        request.date(),
                        request.startTime(),
                        request.endTime(),
                        request.location(),
                        request.notes(),
                        request.trainingType(),
                        request.goals(),
                        request.status() != null ? request.status() : CalendarEventStatus.UPCOMING,
                        resolveSession(request.sessionId()));
        return toResponse(eventRepository.save(event));
    }

    @Transactional
    public CalendarEventResponse update(String eventId, CalendarEventRequest request) {
        CalendarEvent event = findEventOrThrow(eventId);
        event.setTitle(request.title());
        event.setDate(request.date());
        event.setStartTime(request.startTime());
        event.setEndTime(request.endTime());
        event.setLocation(request.location());
        event.setNotes(request.notes());
        event.setTrainingType(request.trainingType());
        event.setGoals(request.goals());
        event.setStatus(request.status() != null ? request.status() : event.getStatus());
        event.setSession(resolveSession(request.sessionId()));
        return toResponse(event);
    }

    @Transactional
    public void delete(String eventId) {
        findEventOrThrow(eventId);
        eventRepository.deleteById(eventId);
    }

    private CalendarEvent findEventOrThrow(String eventId) {
        return eventRepository
                .findByEventIdAndUser_UserId(eventId, currentUser.userId())
                .orElseThrow(() -> new ResourceNotFoundException("Event " + eventId + " not found"));
    }

    private TrainingSession resolveSession(String sessionId) {
        if (sessionId == null) {
            return null;
        }
        return sessionRepository
                .findBySessionIdAndUser_UserId(sessionId, currentUser.userId())
                .orElseThrow(
                        () -> new ResourceNotFoundException("Session " + sessionId + " not found"));
    }

    private static CalendarEventResponse toResponse(CalendarEvent event) {
        return new CalendarEventResponse(
                event.getEventId(),
                event.getTitle(),
                event.getDate(),
                event.getStartTime(),
                event.getEndTime(),
                event.getLocation(),
                event.getNotes(),
                event.getTrainingType(),
                event.getGoals(),
                event.getStatus(),
                event.getSession() != null ? event.getSession().getSessionId() : null);
    }
}
