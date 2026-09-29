package com.followthrough.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.OpenAPI;
import org.junit.jupiter.api.Test;

class OpenApiConfigTest {

    @Test
    void theOpenApiBeanHasTheExpectedTitleAndVersion() {
        OpenAPI api = new OpenApiConfig().followThroughOpenApi();

        assertThat(api).isNotNull();
        assertThat(api.getInfo().getTitle()).isEqualTo("FollowThrough API");
        assertThat(api.getInfo().getVersion()).isEqualTo("v1");
    }
}
