package com.followthrough.api.repository;

import com.followthrough.api.domain.User;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, String> {

    /** The login lookup -- email is the account identifier, not userId. */
    Optional<User> findByEmail(String email);

    /** Used by registration to reject a duplicate email before touching
     * anything else -- cheaper than findByEmail when we only need to know
     * whether a row exists. */
    boolean existsByEmail(String email);
}
