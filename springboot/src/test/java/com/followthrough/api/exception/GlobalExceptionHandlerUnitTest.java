package com.followthrough.api.exception;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import jakarta.validation.ConstraintViolationException;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Plain unit tests (no Spring context) for the two GlobalExceptionHandler
 * branches nothing in real usage naturally triggers: a field error with no
 * default message (real Bean Validation annotations always supply one, so
 * this can only be constructed directly), and ConstraintViolationException
 * (thrown by method-level @Validated parameters, which nothing in this API
 * currently uses on a real endpoint).
 */
class GlobalExceptionHandlerUnitTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void aFieldErrorWithNoDefaultMessageFallsBackToGenericText() {
        FieldError fieldErrorWithNoMessage = new FieldError("target", "someField", null);
        BindingResult bindingResult = mock(BindingResult.class);
        when(bindingResult.getFieldErrors()).thenReturn(List.of(fieldErrorWithNoMessage));
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        when(ex.getBindingResult()).thenReturn(bindingResult);

        ProblemDetail result = handler.handleValidation(ex);

        @SuppressWarnings("unchecked")
        var fieldErrors = (java.util.Map<String, String>) result.getProperties().get("fieldErrors");
        assertThat(fieldErrors).containsEntry("someField", "invalid value");
    }

    @Test
    void aConstraintViolationBecomesA400WithItsMessage() {
        ConstraintViolationException ex =
                new ConstraintViolationException("must not be blank", Set.of());

        ProblemDetail result = handler.handleConstraintViolation(ex);

        assertThat(result.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertThat(result.getDetail()).isEqualTo("must not be blank");
    }

    @Test
    void aRequestForAnUnmappedRouteBecomesA404InsteadOfFallingThroughToTheGeneric500() {
        NoResourceFoundException ex =
                new NoResourceFoundException(HttpMethod.GET, "sessions/x/shots", "No static resource");

        ProblemDetail result = handler.handleNoResourceFound(ex);

        assertThat(result.getStatus()).isEqualTo(HttpStatus.NOT_FOUND.value());
        assertThat(result.getDetail()).isEqualTo("No such endpoint");
    }
}
