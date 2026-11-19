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
import java.nio.file.Files;
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
    void readsTheContainerOffAFileWhoseExtensionSaysNothing() throws Exception {
        Path dir = Files.createTempDirectory("ft-blob");
        Path mp4 = dir.resolve("rec.bin");
        Files.write(mp4, new byte[] {0, 0, 0, 0x20, 'f', 't', 'y', 'p', 'i', 's', 'o', '5', 0, 0});
        Path webm = dir.resolve("rec2.bin");
        Files.write(webm, new byte[] {(byte) 0x1a, 0x45, (byte) 0xdf, (byte) 0xa3, 0, 0, 0, 0});
        Path other = dir.resolve("rec3.bin");
        Files.write(other, new byte[] {1, 2, 3});

        assertThat(LocalBlobStorageController.sniffMediaType(mp4)).isEqualTo(MediaType.valueOf("video/mp4"));
        assertThat(LocalBlobStorageController.sniffMediaType(webm)).isEqualTo(MediaType.valueOf("video/webm"));
        assertThat(LocalBlobStorageController.sniffMediaType(other)).isEqualTo(MediaType.APPLICATION_OCTET_STREAM);
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

    @Test
    void anExtensionlessDownloadIsServedAsTheContainerItActuallyIs() throws Exception {
        String key = "sessions/" + UUID.randomUUID() + "/recording.bin";
        byte[] mp4Head = {0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'};
        mockMvc.perform(put("/videos/local-blob/" + key).content(mp4Head))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/videos/local-blob/" + key))
                .andExpect(status().isOk())
                .andExpect(content().contentType("video/mp4"));
    }

    @Test
    void sniffingStopsAtTheFirstByteThatDoesNotMatch(@org.junit.jupiter.api.io.TempDir Path dir) throws Exception {
        byte[][] notMp4 = {
            {0, 0, 0, 0, 'x', 't', 'y', 'p'},
            {0, 0, 0, 0, 'f', 'x', 'y', 'p'},
            {0, 0, 0, 0, 'f', 't', 'x', 'p'},
            {0, 0, 0, 0, 'f', 't', 'y', 'x'},
            {0x1a, 0x00, 0x00, 0x00},
            {0x1a, 0x45, 0x00, 0x00},
            {0x1a, 0x45, (byte) 0xdf, 0x00},
            {0x1a, 0x45},
        };
        for (int i = 0; i < notMp4.length; i++) {
            Path file = dir.resolve("blob-" + i);
            Files.write(file, notMp4[i]);
            assertThat(LocalBlobStorageController.sniffMediaType(file)).as("case %d", i).isEqualTo(MediaType.APPLICATION_OCTET_STREAM);
        }
    }

    @Test
    void aFileThatCannotBeReadIsServedAsBytes(@org.junit.jupiter.api.io.TempDir Path dir) {
        // A directory opens but cannot be read as a stream.
        assertThat(LocalBlobStorageController.sniffMediaType(dir)).isEqualTo(MediaType.APPLICATION_OCTET_STREAM);
    }

    @Test
    void servesTheRemainingVideoAndImageExtensions() {
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/rec.m4v")).isEqualTo(MediaType.valueOf("video/mp4"));
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/thumb.jpeg")).isEqualTo(MediaType.IMAGE_JPEG);
        assertThat(LocalBlobStorageController.mediaTypeFor("sessions/s/thumb.png")).isEqualTo(MediaType.IMAGE_PNG);
    }
}
