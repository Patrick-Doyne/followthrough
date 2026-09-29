package com.followthrough.api.controller;

import com.followthrough.api.dto.calendar.CalendarEventRequest;
import com.followthrough.api.dto.calendar.CalendarEventResponse;
import com.followthrough.api.service.CalendarEventService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/calendar/events")
public class CalendarEventController {

    private final CalendarEventService eventService;

    public CalendarEventController(CalendarEventService eventService) {
        this.eventService = eventService;
    }

    /** Omit both params for every event (e.g. the dashboard's Reminders
     * widget); pass both to scope to a range (e.g. the calendar page's
     * sliding previous/current/next-month window). */
    @GetMapping
    public List<CalendarEventResponse> list(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return eventService.list(from, to);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarEventResponse create(@Valid @RequestBody CalendarEventRequest request) {
        return eventService.create(request);
    }

    @PutMapping("/{eventId}")
    public CalendarEventResponse update(
            @PathVariable String eventId, @Valid @RequestBody CalendarEventRequest request) {
        return eventService.update(eventId, request);
    }

    @DeleteMapping("/{eventId}")
    public ResponseEntity<Void> delete(@PathVariable String eventId) {
        eventService.delete(eventId);
        return ResponseEntity.noContent().build();
    }
}
