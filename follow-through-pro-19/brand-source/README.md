# Brand source

`followthrough-logo.png` is the logo exactly as supplied: 1080x607, glow
artwork on a solid black ground, no alpha.

Everything under `public/brand/`, and the favicons beside them, are
derived from it by `scripts/gen-brand-assets.ts`. Nothing here ships --
it is the input, kept in the repository so the derivation can be re-run
rather than being a one-off nobody can reproduce.

    npx vite-node scripts/gen-brand-assets.ts

Replacing the logo means replacing this file and re-running that.
