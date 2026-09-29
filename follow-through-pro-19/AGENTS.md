# Notes for agents working in this directory

This is the FollowThrough web app (React 19, TypeScript, TanStack Start). It
was scaffolded with Lovable in August 2026 and has been developed in this
repository since; there is no longer a connected Lovable project, so nothing
here syncs anywhere.

- Read `README.md` here and `../ARCHITECTURE.md` before changing data flow.
- Components never call `fetch`; go through `src/services/`.
- Keep `npx tsc --noEmit`, `npm run lint` and `npm test` clean.
- The overlay renderer (`src/lib/overlay-renderer.ts`) is shared by the live
  and playback surfaces; animation is driven by telemetry `frame_id`, never
  wall-clock time.
