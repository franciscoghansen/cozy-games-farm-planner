# Contributing

Use [GitHub Issues](https://github.com/franciscoghansen/cozy-games-farm-planner/issues) for reproducible bugs and feature ideas. For changes, fork the repository, create a branch from the default branch, and open a pull request that explains the behavior and how you tested it.

## Development

1. Install a supported [Node.js LTS release](https://nodejs.org/en/download).
2. Clone your fork and run `npm ci`.
3. Run `npm run dev` and open the local URL it prints.
4. Before submitting, run `npm test` and `npm run build`. For distribution changes, include the OS and launcher you tested, plus a build served at a repository subpath.

Keep credentials, environment files, browser exports, and personal workspace backups out of commits and issues. Use a small fictional layout or recipe catalog when sharing an example.

## Game definitions

1. Read the [game package schema](README.md#add-a-game-without-changing-application-code).
2. Create a unique lowercase game ID and add its JSON directory under `public/games/`. Add that ID to `public/games/manifest.json`.
3. Include sources and game versions where possible. Record conflicting recipe data and omit quantities you cannot verify.
4. Check placement, coverage, inventory isolation, and the BOM in a local preview. Add focused fixture cases when the game introduces data the current tests do not cover.
5. Submit the JSON and a summary of the sources. Game names and assets belong to their respective owners. Include game artwork or other copyrighted files only when their license or permission allows redistribution.

## Licensing

The repository owner has yet to approve a software license. MIT is a suggested permissive license for the original application code. Any approval and license text should come from the owner. Game data, names, and third-party materials keep their respective terms.
