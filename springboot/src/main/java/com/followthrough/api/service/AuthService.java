package com.followthrough.api.service;

import com.followthrough.api.domain.ChartType;
import com.followthrough.api.domain.MetricKey;
import com.followthrough.api.domain.NotificationPreferences;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.Units;
import com.followthrough.api.domain.UsageStats;
import com.followthrough.api.domain.User;
import com.followthrough.api.domain.UserPreferences;
import com.followthrough.api.dto.auth.AuthResponse;
import com.followthrough.api.dto.auth.LoginRequest;
import com.followthrough.api.dto.auth.RegisterRequest;
import com.followthrough.api.exception.EmailAlreadyExistsException;
import com.followthrough.api.exception.InvalidCredentialsException;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.security.JwtService;
import java.util.List;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Separate from UserService on purpose: this is "how an account comes into
 * existence and how it proves who it is," not "how a signed-in account
 * manages its own profile" -- the two only share the User entity and the
 * response mapping (UserService.toResponse).
 */
@Service
@Transactional(readOnly = true)
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(
            UserRepository userRepository, PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.email())) {
            throw new EmailAlreadyExistsException(
                    "An account with email " + request.email() + " already exists");
        }

        User user =
                new User(
                        UUID.randomUUID().toString(),
                        request.name(),
                        request.email(),
                        passwordEncoder.encode(request.password()),
                        null,
                        null,
                        null,
                        SubscriptionTier.FREE,
                        new UsageStats(0, 5, 0.0, 5.0, 0, 60),
                        new UserPreferences(
                                60,
                                List.of(),
                                Units.IMPERIAL,
                                MetricKey.SHOOTING_PERCENTAGE,
                                ChartType.LINE,
                                true,
                                false,
                                new NotificationPreferences(true, true, true, true)));

        User saved = userRepository.save(user);
        return new AuthResponse(jwtService.issueToken(saved.getUserId()), UserService.toResponse(saved));
    }

    public AuthResponse login(LoginRequest request) {
        User user =
                userRepository
                        .findByEmail(request.email())
                        .orElseThrow(() -> new InvalidCredentialsException("Invalid email or password"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new InvalidCredentialsException("Invalid email or password");
        }

        return new AuthResponse(jwtService.issueToken(user.getUserId()), UserService.toResponse(user));
    }
}
