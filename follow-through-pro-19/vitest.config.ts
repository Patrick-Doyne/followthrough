// Deliberately separate from vite.config.ts: that file is wrapped by
// @lovable.dev/vite-tanstack-config, which bundles TanStack Start/Nitro/
// Cloudflare plugins that have nothing to do with running unit tests and
// are fragile to configure around. The units under test here are plain
// TypeScript with no JSX/router/SSR dependency, so a minimal standalone
// config — just the same `@/*` path alias tsconfig.json defines — is all
// that's needed.
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The React plugin is needed only by the jsdom suites that render
  // components; it is harmless for the pure ones.
  plugins: [tsconfigPaths(), react()],
  test: {
    // Most units here are plain TypeScript and run fastest in node. The
    // exceptions are React components and hooks, which need a DOM: those
    // opt in per file with `@vitest-environment jsdom` at the top, so the
    // pure suites do not pay for jsdom on every run.
    environment: "node",
  },
});
