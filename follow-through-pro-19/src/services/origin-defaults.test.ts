// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://courts.example.test/live" }
import { beforeAll, describe, expect, it, vi } from "vitest";

// Served from anywhere but localhost (an EC2 instance behind a reverse proxy
// and a tunnel), the app must talk to its own origin: the API under its
// context path and the relay at /relay over wss. Nothing is baked in. The
// env overrides are cleared because a developer's .env.local sets one.
describe("addresses away from localhost", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_SIGNALING_RELAY_URL", "");
  });

  it("defaults the API to this origin's /api/v1", async () => {
    const { API_BASE_URL } = await import("@/services/http");
    expect(API_BASE_URL).toBe("https://courts.example.test/api/v1");
  });

  it("defaults the relay to wss on this origin at /relay", async () => {
    const { signalingConfig } = await import("@/config/streaming");
    expect(signalingConfig.relayUrl).toBe("wss://courts.example.test/relay");
  });
});
