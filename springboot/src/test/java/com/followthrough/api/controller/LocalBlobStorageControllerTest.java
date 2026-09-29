package com.followthrough.api.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.HttpServletRequest;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.DelegatingServletInputStream;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

/** Points the local blob store at a target/ scratch directory instead of
 * the real local-video-storage/ used outside tests, so test runs never
 * leave files behind for a real dev session to trip over. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "followthrough.storage.local.directory=target/test-local-video-storage")
@Import(com.followthrough.api.config.MockMvcAuthConfig.class)
class LocalBlobStorageControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private LocalBlobStorageController controller;

    @Test
    void puttingBytesThenGettingTheSameKeyReturnsThemBackUnchanged() throws Exception {
        String key = "sessions/session-001/" + UUID.randomUUID() + ".webm";
        byte[] body = "fake recording bytes".getBytes(StandardCharsets.UTF_8);

        mockMvc.perform(put("/videos/local-blob/" + key).content(body))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/videos/local-blob/" + key))
                .andExpect(status().isOk())
                .andExpect(content().bytes(body));
    }

    @Test
    void gettingAKeyThatWasNeverUploadedReturnsNotFound() throws Exception {
        mockMvc.perform(get("/videos/local-blob/sessions/does-not-exist/" + UUID.randomUUID() + ".webm"))
                .andExpect(status().isNotFound());
    }

    @Test
    void pathTraversalInTheKeyIsRejected() throws Exception {
        mockMvc.perform(put("/videos/local-blob/../../../etc/passwd").content("nope".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isBadRequest());
    }

    /** Spring Security's default firewall now rejects a raw ".." in the URI
     * before the request even reaches this controller (confirmed by
     * pathTraversalInTheKeyIsRejected above still passing while this
     * exact branch showed 0 coverage) -- good defense in depth, but it
     * means resolve()'s own guard needs a direct call to stay exercised,
     * since HTTP alone can no longer reach it. */
    @Test
    void resolveRejectsAKeyThatResolvesOutsideTheStorageRoot() {
        assertThatThrownBy(() -> controller.resolve("../../../etc/passwd"))
                .isInstanceOf(ResponseStatusException.class)
                .hasFieldOrPropertyWithValue("statusCode", HttpStatus.BAD_REQUEST);
    }

    /** Reproduces a real bug found via manual curl testing: sending a PUT
     * with a form-urlencoded Content-Type (curl's own default for
     * --data-binary when no header is given -- a real browser's
     * fetch(url, {body: someBlob}) never does this) makes Spring's
     * FormContentFilter consume the body first, so the upload handler sees
     * nothing. This must fail loudly, not silently write an empty file. */
    @Test
    void aFormUrlEncodedContentTypeFailsLoudlyInsteadOfSilentlyWritingAnEmptyFile() throws Exception {
        String key = "sessions/session-001/" + UUID.randomUUID() + ".webm";
        byte[] body = "fake recording bytes".getBytes(StandardCharsets.UTF_8);

        mockMvc.perform(
                        put("/videos/local-blob/" + key)
                                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                                .content(body))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get("/videos/local-blob/" + key)).andExpect(status().isNotFound());
    }

    /** resolve() strips a leading "/" before resolving against the storage
     * root. Every real HTTP request supplies one (Spring's {*storageKey}
     * capture always includes it), so this exercises the other branch --
     * a key with no leading slash -- directly. */
    @Test
    void resolveHandlesAStorageKeyWithoutALeadingSlash() {
        Path resolved = controller.resolve("sessions/session-001/no-leading-slash.webm");

        assertThat(resolved.toString()).endsWith("sessions/session-001/no-leading-slash.webm");
    }

    /** A real servlet container can never actually deliver more bytes than
     * a declared Content-Length of 0, so this can only be exercised with a
     * mocked request -- it locks in that the truncation check is skipped
     * entirely (not merely "happens not to match") whenever no length was
     * declared, regardless of what ends up in the input stream. */
    @Test
    void contentLengthZeroSkipsTheTruncationCheckEvenIfBytesWereRead() throws Exception {
        String key = "sessions/session-001/" + UUID.randomUUID() + ".webm";
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getContentLengthLong()).thenReturn(0L);
        when(request.getInputStream())
                .thenReturn(
                        new DelegatingServletInputStream(
                                new ByteArrayInputStream("unexpected bytes".getBytes(StandardCharsets.UTF_8))));

        ResponseEntity<Void> response = controller.upload(key, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    /**
     * A recording has to go out as video, not as octet-stream.
     *
     * <p>Everything used to be served as octet-stream and mostly worked,
     * because browsers sniff media. It cost two real things: a byte-range
     * request (how seeking works) is on much firmer ground when the type
     * is honest, and an error on this route could not even be rendered --
     * the response was already pinned to octet-stream, so writing a
     * ProblemDetail threw and a clean 404 surfaced as a 500.
     */
    @Test
    void servesEachStoredBlobAsWhatItActuallyIs() {
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/rec.mp4"))
                .isEqualTo(MediaType.valueOf("video/mp4"));
        // MOV shares MP4's container family; video/mp4 is what browsers
        // accept for H.264 inside one.
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/rec.mov"))
                .isEqualTo(MediaType.valueOf("video/mp4"));
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/rec.webm"))
                .isEqualTo(MediaType.valueOf("video/webm"));
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/rec-thumbnail.jpg"))
                .isEqualTo(MediaType.IMAGE_JPEG);
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/REC.MP4"))
                .isEqualTo(MediaType.valueOf("video/mp4"));
    }

    @Test
    void claimsNothingAboutAnExtensionItDoesNotRecognise() {
        // Honest rather than helpful: guessing a video type for an unknown
        // file is how a browser ends up being told a recording is
        // something it is not.
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/rec.bin"))
                .isEqualTo(MediaType.APPLICATION_OCTET_STREAM);
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/rec"))
                .isEqualTo(MediaType.APPLICATION_OCTET_STREAM);
    }
}
