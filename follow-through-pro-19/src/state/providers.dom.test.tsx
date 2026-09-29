// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandsProvider, useCommands } from "@/state/commands";
import { NotificationsProvider } from "@/state/notifications";
import { SettingsProvider } from "@/state/settings-provider";
import { UndoProvider } from "@/state/undo";

/**
 * Mounts the real provider stack.
 *
 * <p>Nothing had ever rendered these together. The order is documented as
 * load-bearing, several of them subscribe to media queries and storage,
 * and one of them keys the whole tree on a format signature — all things
 * that only fail at runtime.
 *
 * <p>Rendered under `StrictMode` deliberately. The app does not use it, but
 * its double-invoked effects are the cheapest way to surface a missing
 * cleanup or an effect that is not idempotent, and a provider that cannot
 * survive it is one bad refactor away from a real bug.
 */

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => "/live",
}));

vi.mock("@/state/auth", () => ({
  useAuth: () => ({
    identity: null,
    isAuthenticated: false,
    isReady: true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/components/command/CommandPalette", () => ({
  CommandPalette: () => null,
}));

beforeEach(() => {
  // jsdom has no matchMedia, and the settings provider reads it for the
  // theme and reduced-motion "system" choices.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(cleanup);

function Stack({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettingsProvider>
        <NotificationsProvider>
          <UndoProvider>
            <CommandsProvider>{children}</CommandsProvider>
          </UndoProvider>
        </NotificationsProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}

describe("provider stack", () => {
  it("mounts under StrictMode without throwing", () => {
    render(
      <StrictMode>
        <Stack>
          <p>mounted</p>
        </Stack>
      </StrictMode>,
    );
    expect(screen.getByText("mounted")).toBeTruthy();
  });

  it("applies the display settings to the document", () => {
    render(
      <Stack>
        <p>mounted</p>
      </Stack>,
    );
    const root = document.documentElement;
    // The provider owns these; if it stops writing them the boot script's
    // work is silently the only thing holding the theme up.
    expect(root.dataset["density"]).toBeTruthy();
    expect(root.dataset["motion"]).toBeTruthy();
    expect(root.dataset["contrast"]).toBeTruthy();
    expect(root.dataset["reading"]).toBeTruthy();
  });

  it("does not loop when a command is claimed and released", () => {
    // The registry sets state, so a component claiming a command on mount
    // must not cause a render that re-claims it. This is the shape of the
    // infinite loop found in the shot feed.
    let renders = 0;

    function Claimer() {
      const { registerCommand } = useCommands();
      renders += 1;
      useEffect(() => registerCommand("shots.markMade", () => {}), [registerCommand]);
      return null;
    }

    render(
      <Stack>
        <Claimer />
      </Stack>,
    );

    // One render, plus the one caused by the registry update. Anything
    // runaway shows up here as a large number rather than a hang.
    expect(renders).toBeLessThanOrEqual(4);
  });

  it("hides unclaimed commands so their keystrokes stay free", () => {
    let ids: string[] = [];

    function Probe() {
      const { commands } = useCommands();
      ids = commands.map((c) => c.id);
      return null;
    }

    render(
      <Stack>
        <Probe />
      </Stack>,
    );

    // Nothing claimed the correction commands, so "m" and "x" must remain
    // ordinary letters everywhere else in the app.
    expect(ids).not.toContain("shots.markMade");
    expect(ids).toContain("palette.open");
  });
});
