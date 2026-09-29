package com.followthrough.api.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI followThroughOpenApi() {
        return new OpenAPI()
                .info(
                        new Info()
                                .title("FollowThrough API")
                                .description("Sessions, videos, calendar, user profile and analytics.")
                                .version("v1"));
    }
}
