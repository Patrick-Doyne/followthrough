package com.followthrough.api.service;

/** Thrown when either subprocess step of CppVideoProcessor (the C++
 * detection binary, or the Node preparation script that makes the
 * thumbnail and playback copy) fails, times out, or can't be started --
 * caught by VideoProcessingRunner's existing catch (RuntimeException) and
 * routed to markFailed(). */
public class VideoProcessingException extends RuntimeException {

    public VideoProcessingException(String message) {
        super(message);
    }

    public VideoProcessingException(String message, Throwable cause) {
        super(message, cause);
    }
}
