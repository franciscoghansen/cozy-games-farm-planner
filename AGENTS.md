# Agent guide

## Development

- Use Node.js 22.16+ in the 22.x series or Node.js 24+. Run `npm ci` when dependencies need installing.
- Run `npm test` for the Node test suite and `npm run build` for the TypeScript check and Vite production build.
- Start a local preview with `npm run dev -- --host 127.0.0.1` or use `npm run start:local` for the same setup path as the community launchers.
- Reuse the existing local URL during UI previews when possible. IndexedDB workspaces are scoped to the browser and origin, including the port.

## Architecture

- `src/bom.ts` and `src/crafting-types.ts` are the standalone crafting domain. Keep them independent of React, game definitions, layouts, and persistence.
- `src/farm-bom.ts` adapts layouts and reusable equipment to crafting requests. `src/optimizer.ts` uses that adapter and runs in a Web Worker. The farm Materials screen and standalone Crafting Planner share `src/BomView.tsx`.
- Bundled game content lives in `public/games/`. Use the manifest and schema documented in the README. Keep item and recipe IDs stable for saved layouts and recipe selections, and cite sources for new game data.
- Personal workspaces and game overrides live in IndexedDB. Preserve layout import compatibility and workspace backup validation when changing those formats. Use fictional data in tests and screenshots that will be shared.

## Distribution and repository safety

- The three platform launchers delegate to `scripts/start-local.mjs`. Preserve loopback binding, quoted paths, and lockfile-based installs. Report which operating systems you actually tested.
- GitHub Pages derives its Vite base from the workflow. Resolve runtime game JSON through `import.meta.env.BASE_URL` and keep view links working on refresh beneath a repository subpath. For subpath checks, build with `npm run build -- --base=/pages-check/`.
- Use `CONTRIBUTING.md` for contribution and game-package guidance. Keep credentials, personal backups, build output, and dependencies out of version control.
- Respect branch rules and the user's preview, commit, and publication instructions. A local preview needs no GitHub Actions run. Leave the software license decision to the repository owner.
