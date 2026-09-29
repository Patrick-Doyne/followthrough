package com.followthrough.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

class AsyncConfigTest {

    @Test
    void configuresAUsableThreadPoolWithTheExpectedSizingAndNamePrefix() throws Exception {
        Executor executor = new AsyncConfig().getAsyncExecutor();

        assertThat(executor).isInstanceOf(ThreadPoolTaskExecutor.class);
        ThreadPoolTaskExecutor pool = (ThreadPoolTaskExecutor) executor;
        assertThat(pool.getCorePoolSize()).isEqualTo(2);
        assertThat(pool.getMaxPoolSize()).isEqualTo(4);
        assertThat(pool.getQueueCapacity()).isEqualTo(50);
        assertThat(pool.getThreadNamePrefix()).isEqualTo("video-proc-");

        // Proves initialize() actually ran -- an uninitialized
        // ThreadPoolTaskExecutor rejects every submitted task.
        String threadName =
                CompletableFuture.supplyAsync(() -> Thread.currentThread().getName(), executor)
                        .get(2, TimeUnit.SECONDS);
        assertThat(threadName).startsWith("video-proc-");
    }
}
