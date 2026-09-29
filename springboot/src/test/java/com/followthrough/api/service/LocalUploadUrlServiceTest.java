package com.followthrough.api.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * The stored key's extension is not cosmetic: LocalBlobStorageController
 * serves the file back as whatever that extension says, standing in for
 * the object metadata a real bucket would carry.
 */
class LocalUploadUrlServiceTest {

    private final LocalUploadUrlService service =
            new LocalUploadUrlService("http://localhost:8082/api/v1");

    @Test
    void storesEachUploadUnderAnExtensionMatchingItsContentType() {
        assertThat(service.generate("session-001", "video/mp4").storageKey()).endsWith(".mp4");
        assertThat(service.generate("session-001", "video/webm").storageKey()).endsWith(".webm");
        // What phones actually send. This used to fall through to the
        // default below, so a QuickTime recording was stored as ".webm" --
        // a name that contradicted the file's own contents.
        assertThat(service.generate("session-001", "video/quicktime").storageKey()).endsWith(".mov");
    }

    @Test
    void doesNotGuessAVideoExtensionForAContentTypeItDoesNotKnow() {
        // The old default was ".webm", which only ever worked because
        // browsers sniff media rather than trusting what they are told.
        for (String contentType : new String[] {"application/x-bogus", "", "video/x-unheard-of"}) {
            assertThat(service.generate("session-001", contentType).storageKey())
                    .as(contentType)
                    .endsWith(".bin");
        }
        assertThat(service.generate("session-001", null).storageKey()).endsWith(".bin");
    }

    @Test
    void isNotConfusedByTheCasingAClientHappensToUse() {
        assertThat(service.generate("session-001", "VIDEO/MP4").storageKey()).endsWith(".mp4");
    }

    @Test
    void keepsTheSessionInTheKeySoUploadsLandBesideEachOther() {
        assertThat(service.generate("session-001", "video/mp4").storageKey())
                .startsWith("sessions/session-001/");
    }
}
