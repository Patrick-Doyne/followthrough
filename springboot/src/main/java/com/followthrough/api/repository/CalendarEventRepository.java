package com.followthrough.api.repository;

import com.followthrough.api.domain.CalendarEvent;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarEventRepository extends JpaRepository<CalendarEvent, String> {

    /** Used when no date range is given (e.g. the dashboard's Reminders
     * widget, which needs every event regardless of month). */
    List<CalendarEvent> findAllByUser_UserIdOrderByDateAsc(String userId);

    /** Inclusive on both ends -- backs the calendar page's sliding
     * previous/current/next-month window. A calendar view needs every
     * event in range, not an arbitrary page of them, so this is a
     * date-range filter rather than page/size pagination. */
    List<CalendarEvent> findByUser_UserIdAndDateBetweenOrderByDateAsc(
            String userId, LocalDate from, LocalDate to);

    /** Scoped existence check for ownership enforcement, same reasoning as
     * TrainingSessionRepository's equivalent. */
    Optional<CalendarEvent> findByEventIdAndUser_UserId(String eventId, String userId);

    /** Used when a session is deleted -- any event still pointing at it
     * needs its (optional) session link cleared first, not to be deleted
     * itself, since an event isn't owned by the session it's linked to. */
    List<CalendarEvent> findBySession_SessionId(String sessionId);
}
