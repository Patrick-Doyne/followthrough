package com.followthrough.api.controller;

import com.followthrough.api.dto.user.UserResponse;
import com.followthrough.api.dto.user.UserUpdateRequest;
import com.followthrough.api.service.UserService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/me")
    public UserResponse me() {
        return userService.getCurrentUser();
    }

    @PutMapping("/me")
    public UserResponse update(@RequestBody UserUpdateRequest request) {
        return userService.updateCurrentUser(request);
    }
}
