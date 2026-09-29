package com.followthrough.api.exception;

/** Deliberately used for both "no account with that email" and "wrong
 * password" -- the response must not reveal which one it was. */
public class InvalidCredentialsException extends RuntimeException {

    public InvalidCredentialsException(String message) {
        super(message);
    }
}
