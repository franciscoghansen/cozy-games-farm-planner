# Contributing

Use [GitHub Issues](https://github.com/franciscoghansen/cozy-games-farm-planner/issues) for reproducible bugs and feature ideas. For changes, fork the repository, create a branch from the default branch, and open a pull request that explains the behavior and how you tested it.

## Development

1. Install a supported [Node.js LTS release](https://nodejs.org/en/download).
2. Clone your fork and run `npm ci`.
3. Run `npm run dev` and open the local URL it prints.
4. Before submitting, run `npm run check` and `npm run test:e2e`. For distribution changes, include the OS and launcher you tested, plus a build served at a repository subpath.

Keep credentials, environment files, browser exports, and personal workspace backups out of commits and issues. Use a small fictional layout or recipe catalog when sharing an example.

## Local checks

| Command                  | What it checks                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `npm run check`          | Formatting, lint, type checking, bundled game data, and Node tests with coverage    |
| `npm run typecheck`      | Strict TypeScript in the application, Node tests, E2E tests, and tool configuration |
| `npm run lint`           | Type-aware ESLint, React and Hooks rules, and domain import boundaries              |
| `npm run lint:dead-code` | Informational Knip report for unused files, exports, and dependencies               |
| `npm run format`         | Applies Prettier to source, tests, configuration, Markdown, and game data           |
| `npm run format:check`   | Reports formatting drift without writing files                                      |
| `npm test`               | Deterministic Node unit and integration tests, including fake IndexedDB             |
| `npm run test:coverage`  | Node tests with line and branch floors, JSON summary, and LCOV in `coverage/`       |
| `npm run validate:data`  | Loads every manifest package through the same validators as the app                 |
| `npm run build`          | Type-checks and builds production assets with Vite                                  |
| `npm run test:e2e`       | Chromium smoke tests and axe scans against a production build at `/pages-check/`    |

Install the test browser once with `npx --no-install playwright install --only-shell chromium`. On Linux, add `--with-deps` if browser system dependencies are missing. Playwright manages a loopback preview on port 4183 and creates fresh browser contexts. The HTML report is in `playwright-report/`. CI uploads it with failure screenshots and traces. Axe blocks serious and critical findings in the farm, layout dialog, crafting, and crop views. It logs lower-severity findings and attaches their selectors to the HTML report. Canvas pixels and grid interaction semantics still need manual keyboard and screen-reader review.

### Coverage and lint baselines

The original 81 Node tests measured 96.32% line and 88.96% branch coverage with Node's native reporter on loaded modules. The initial c8 measurement below used the same 81 tests after the Prettier baseline and bundled-loader extraction. GitHub runs the same local coverage gate and summarizes the results by area.

| Area                      | c8 lines | c8 branches | Line floor | Branch floor |
| ------------------------- | -------: | ----------: | ---------: | -----------: |
| Overall domain            |   96.49% |      88.29% |        96% |          88% |
| BOM and crafting          |   97.93% |      91.73% |        97% |          91% |
| Seasonal crops            |   97.34% |      90.26% |        97% |          90% |
| Farm layout and optimizer |   99.83% |      93.20% |        99% |          93% |
| Persistence and backups   |   91.62% |      83.28% |        91% |          83% |

c8 includes every domain `.ts` module, including modules the tests never load. This report excludes type declarations, React `.tsx` views and entry points, the browser analytics bootstrap, and the worker entry point. The optimizer itself is covered. Playwright checks UI behavior separately and does not collect source coverage. The floors apply to modules in aggregate. Changed-line coverage is not gated because the current V8 report also marks some non-executable TypeScript and structural lines.

Raise the floors in `scripts/check-coverage.mjs` when sustained gains make the next whole percentage attainable. Keep the existing floors when adding or moving executable code. ESLint's `eslint-suppressions.json` records existing debt per file and rule, primarily non-null assertions and React dependency/lifecycle findings. New files and any increase for a file/rule pair fail lint. After fixing debt, run `npm run lint -- --prune-suppressions` and commit the reduced counts. Review changed lines in files with existing suppressions because replacing one finding with another of the same rule can leave the count unchanged. [ESLint bulk suppressions](https://eslint.org/docs/latest/use/suppressions)

## GitHub pull request gates

The **Pull request CI** workflow runs on pull requests to `main`. Its four status check names are `quality`, `tests`, `e2e`, and `dependency-review`. Dependency Review blocks new high and critical advisories and reports lower severity in the Actions summary. CodeQL runs separately for JavaScript and TypeScript on `main` pushes, pull requests, and a weekly schedule. The deployment workflow continues to publish Pages from the default branch.

### Enable merge protection

1. Push the CI branch and open a pull request targeting `main`. Let all four **Pull request CI** jobs run successfully so GitHub can offer the checks in the ruleset picker.
2. In the repository, open **Settings → Rulesets** under **Code, planning, and automation**. Edit the existing active branch ruleset named **default**. If it has been removed, use **New ruleset → New branch ruleset** and set **Enforcement status** to **Active**. Leave the **Bypass list** empty.
3. Under **Target branches**, add the default branch or include exactly `main`.
4. Keep **Restrict deletions**, **Block force pushes**, and **Require a pull request before merging** enabled. Set **Required approvals** to **0** for solo maintenance.
5. Enable **Require status checks to pass** and **Require branches to be up to date before merging**. Add `quality`, `tests`, `e2e`, and `dependency-review`; select **GitHub Actions** as the expected source where offered. Save the ruleset and verify the PR merge box lists all four checks. [GitHub ruleset reference](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

### Enable repository security features

In **Settings → Advanced Security** under **Security and quality**, enable **Dependency graph**, **Dependabot alerts**, and **Dependabot security updates**. The checked-in Dependabot file schedules weekly npm and Actions version updates once it reaches the default branch. Dependency Review requires the graph to be on. [GitHub Dependabot setup](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/dependabot-quickstart)

The checked-in workflow uses CodeQL advanced setup. If **CodeQL analysis** shows active default setup, use its menu to **Switch to advanced**, and enable the checked-in **CodeQL** workflow from **Actions** if necessary. Confirm that **Security and quality → Code scanning** receives results from a successful default-branch run. Once CodeQL is reliable, use the ruleset's **Require code scanning results** rule and choose CodeQL with the desired severity threshold. Keep CodeQL optional during rollout. [GitHub CodeQL advanced setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning)

## Game definitions

1. Read the [game package schema](README.md#add-a-game-without-changing-application-code).
2. Create a unique lowercase game ID and add its JSON directory under `public/games/`. Add that ID to `public/games/manifest.json`.
3. Include sources and game versions where possible. Record conflicting recipe data and omit quantities you cannot verify.
4. Check placement, coverage, inventory isolation, and the BOM in a local preview. Add focused fixture cases when the game introduces data the current tests do not cover.
5. Submit the JSON and a summary of the sources. Game names and assets belong to their respective owners. Include game artwork or other copyrighted files only when their license or permission allows redistribution.

## Licensing

The project's original code and documentation are licensed under the [MIT License](LICENSE). Submit original code and documentation contributions under MIT. For third-party material, preserve applicable notices and document the source and redistribution terms.
