package com.followthrough.api.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Deletes from the on-disk stand-in the rest of the local storage
 * services write to. Replace alongside them when a real bucket exists. */
@Service
public class LocalVideoFileStore implements VideoFileStore {

    private static final Logger log = LoggerFactory.getLogger(LocalVideoFileStore.class);

    private final Path storageRoot;

    public LocalVideoFileStore(@Value("${followthrough.storage.local.directory}") String directory) {
        this.storageRoot = Path.of(directory).toAbsolutePath().normalize();
    }

    @Override
    public boolean delete(String storageKey) {
        if (storageKey == null || storageKey.isBlank()) {
            return false;
        }
        Path target = storageRoot.resolve(storageKey).normalize();
        // A key is attacker-influenced in the sense that it is stored data:
        // refuse anything that climbs out of the storage root rather than
        // trusting it, exactly as the blob controller does on the way in.
        if (!target.startsWith(storageRoot)) {
            log.warn("Refusing to delete outside the storage root: {}", storageKey);
            return false;
        }
        try {
            return Files.deleteIfExists(target);
        } catch (IOException e) {
            // Best effort by design. The row is going either way; a file
            // left behind is wasted disk, not a broken library, and
            // failing the request would leave the two inconsistent in the
            // direction that is harder to recover from.
            log.warn("Could not delete {}", storageKey, e);
            return false;
        }
    }
}
