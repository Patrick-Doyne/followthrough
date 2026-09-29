package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.followthrough.api.domain.NotificationPreferences;
import com.followthrough.api.domain.SubscriptionTier;
import com.followthrough.api.domain.User;
import com.followthrough.api.domain.UsageStats;
import com.followthrough.api.domain.UserPreferences;
import com.followthrough.api.dto.auth.AuthResponse;
import com.followthrough.api.dto.auth.LoginRequest;
import com.followthrough.api.dto.auth.RegisterRequest;
import com.followthrough.api.exception.EmailAlreadyExistsException;
import com.followthrough.api.exception.InvalidCredentialsException;
import com.followthrough.api.repository.UserRepository;
import com.followthrough.api.security.JwtService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock private UserRepository userRepository;
    @Mock private PasswordEncoder passwordEncoder;
    @Mock private JwtService jwtService;

    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(userRepository, passwordEncoder, jwtService);
    }

    @Test
    void registerCreatesANewAccountWithAHashedPasswordAndIssuesAToken() {
        when(userRepository.existsByEmail("new@followthrough.app")).thenReturn(false);
        when(passwordEncoder.encode("a-real-password")).thenReturn("hashed-value");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(jwtService.issueToken(any())).thenReturn("a.jwt.token");

        AuthResponse response =
                authService.register(new RegisterRequest("New Player", "new@followthrough.app", "a-real-password"));

        assertThat(response.token()).isEqualTo("a.jwt.token");
        assertThat(response.user().name()).isEqualTo("New Player");
        assertThat(response.user().email()).isEqualTo("new@followthrough.app");
        assertThat(response.user().tier()).isEqualTo(SubscriptionTier.FREE);

        ArgumentCaptor<User> savedUser = ArgumentCaptor.forClass(User.class);
        org.mockito.Mockito.verify(userRepository).save(savedUser.capture());
        assertThat(savedUser.getValue().getPasswordHash()).isEqualTo("hashed-value");
    }

    @Test
    void registerWithAnAlreadyRegisteredEmailIsRejected() {
        when(userRepository.existsByEmail("taken@followthrough.app")).thenReturn(true);

        assertThatThrownBy(
                        () ->
                                authService.register(
                                        new RegisterRequest("Someone", "taken@followthrough.app", "a-real-password")))
                .isInstanceOf(EmailAlreadyExistsException.class)
                .hasMessageContaining("taken@followthrough.app");
    }

    @Test
    void loginWithCorrectCredentialsIssuesAToken() {
        User user = seededUser();
        when(userRepository.findByEmail("player@followthrough.app")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("correct-password", "hashed-value")).thenReturn(true);
        when(jwtService.issueToken("user-001")).thenReturn("a.jwt.token");

        AuthResponse response = authService.login(new LoginRequest("player@followthrough.app", "correct-password"));

        assertThat(response.token()).isEqualTo("a.jwt.token");
        assertThat(response.user().userId()).isEqualTo("user-001");
    }

    @Test
    void loginWithAnUnknownEmailIsRejectedWithoutRevealingWhichPartWasWrong() {
        when(userRepository.findByEmail("nobody@followthrough.app")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(new LoginRequest("nobody@followthrough.app", "anything")))
                .isInstanceOf(InvalidCredentialsException.class)
                .hasMessage("Invalid email or password");
    }

    @Test
    void loginWithTheWrongPasswordIsRejectedWithTheSameGenericMessage() {
        User user = seededUser();
        when(userRepository.findByEmail("player@followthrough.app")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("wrong-password", "hashed-value")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(new LoginRequest("player@followthrough.app", "wrong-password")))
                .isInstanceOf(InvalidCredentialsException.class)
                .hasMessage("Invalid email or password");
    }

    private static User seededUser() {
        return new User(
                "user-001",
                "Existing Player",
                "player@followthrough.app",
                "hashed-value",
                null,
                null,
                null,
                SubscriptionTier.FREE,
                new UsageStats(0, 5, 0, 5, 0, 60),
                new UserPreferences(
                        60, List.of(), null, null, null, true, false,
                        new NotificationPreferences(true, true, true, true)));
    }
}
