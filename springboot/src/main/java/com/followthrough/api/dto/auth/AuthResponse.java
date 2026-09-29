package com.followthrough.api.dto.auth;

import com.followthrough.api.dto.user.UserResponse;

public record AuthResponse(String token, UserResponse user) {
}
