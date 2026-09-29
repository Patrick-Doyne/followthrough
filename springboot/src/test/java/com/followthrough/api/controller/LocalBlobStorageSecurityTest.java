package com.followthrough.api.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Deliberately does NOT import MockMvcAuthConfig (unlike every other
 * controller test) -- that config attaches a default Authorization header
 * to every request, which would mask exactly what this needs to prove: a
 * real browser loading a &lt;video src=...&gt; can't attach a bearer
 * token, so the GET side of local-blob storage has to work with no auth
 * header at all (mirroring how a real presigned S3 URL needs none either
 * -- its signature IS the auth). The PUT side must stay authenticated.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "followthrough.storage.local.directory=target/test-local-video-storage-security")
class LocalBlobStorageSecurityTest {

    @Autowired private MockMvc mockMvc;

    @Value("${followthrough.storage.local.directory}")
    private String storageDirectory;

    @Test
    void gettingAnExistingFileWithNoAuthHeaderAtAllStillWorks() throws Exception {
        String key = "sessions/session-001/" + UUID.randomUUID() + ".webm";
        byte[] body = "fake recording bytes".getBytes(StandardCharsets.UTF_8);
        Path file = Path.of(storageDirectory).resolve(key);
        Files.createDirectories(file.getParent());
        Files.write(file, body);

        mockMvc.perform(get("/videos/local-blob/" + key))
                .andExpect(status().isOk())
                .andExpect(content().bytes(body));
    }

    @Test
    void puttingWithNoAuthHeaderAtAllIsRejected() throws Exception {
        String key = "sessions/session-001/" + UUID.randomUUID() + ".webm";

        mockMvc.perform(put("/videos/local-blob/" + key).content("nope".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isForbidden());
    }
}
