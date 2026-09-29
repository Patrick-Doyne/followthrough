package com.followthrough.api.repository;

import com.followthrough.api.domain.TrainingSession;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TrainingSessionRepository extends JpaRepository<TrainingSession, String> {

    List<TrainingSession> findAllByUser_UserIdOrderByDateDesc(String userId);

    List<TrainingSession> findAllByUser_UserIdOrderByDateAsc(String userId);

    /** Scoped lookup/existence check for ownership enforcement -- a session
     * that exists but belongs to someone else must look identical to a
     * session that doesn't exist at all (see the service layer's 404
     * handling). */
    Optional<TrainingSession> findBySessionIdAndUser_UserId(String sessionId, String userId);

    boolean existsBySessionIdAndUser_UserId(String sessionId, String userId);
}
