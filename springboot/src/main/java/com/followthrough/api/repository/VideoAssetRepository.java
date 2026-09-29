package com.followthrough.api.repository;

import com.followthrough.api.domain.VideoAsset;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** A VideoAsset has no owner column of its own -- ownership is transitive
 * via its session (session.user), so every scoped finder here traverses
 * that relationship rather than needing a direct user FK on this table. */
public interface VideoAssetRepository extends JpaRepository<VideoAsset, String> {

    /** Paginated: used by the GET /videos list endpoint. */
    Page<VideoAsset> findAllBySession_User_UserIdOrderByDateDesc(String userId, Pageable pageable);

    /** Unpaginated: a single session's videos are an inherently small,
     * bounded list, not worth paginating. Scoping by userId here too means
     * a session that exists but belongs to someone else yields an empty
     * list, matching the existing "unknown session" behavior exactly. */
    List<VideoAsset> findBySession_SessionIdAndSession_User_UserId(String sessionId, String userId);

    Optional<VideoAsset> findByVideoIdAndSession_User_UserId(String videoId, String userId);
}
