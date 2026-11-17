# Cozy Games Farm Planner

A browser-based farm layout editor and crafting calculator built with React, TypeScript, and Vite. Design a farm, calculate crop coverage, optimize equipment placement, or plan the materials for any item in a loaded game catalog. Coral Island is included, and you can import other game packages.

## Play Online

[Open Cozy Games Farm Planner](https://franciscoghansen.github.io/cozy-games-farm-planner/) once the repository owner enables GitHub Pages and the first deployment succeeds. The site runs in your browser without an account or install.

## Run Locally

Download **Code → Download ZIP** from the [GitHub repository](https://github.com/franciscoghansen/cozy-games-farm-planner) and extract it. Install [Node.js LTS](https://nodejs.org/en/download) if needed. The launcher supports Node.js 22.16+ in the 22.x series and Node.js 24+. Node.js includes npm.

| System | Start the planner |
| --- | --- |
| Windows 10/11 | Open the extracted folder and double-click **start.bat**. |
| macOS | Double-click **start.command**. If it lacks permission, open Terminal in the folder and run `chmod +x start.command` first. You can also run `sh ./start.sh` from Terminal. |
| Linux | Open a terminal in the extracted folder and run `chmod +x start.sh` if needed, then run `./start.sh`. |

The first launch installs dependencies from the included lockfile and needs internet access. Later launches reuse the installation until dependencies or the Node.js runtime change. The launcher prints the local address and opens your default browser. Keep the terminal open while you play and press Ctrl+C to stop the server.

### Update and troubleshoot

- **Updating a ZIP download.** Stop the server, download and extract the new ZIP, and launch from the new folder. Use the same browser and printed address to reopen your workspace. With a Git checkout, run `git pull` and relaunch.
- **Node.js or npm is missing.** Install [Node.js LTS](https://nodejs.org/en/download), open a new terminal window, and check `node --version` and `npm --version`. If Finder cannot find a Node.js installation managed by your shell, run `sh ./start.sh` in your usual terminal.
- **The dependency install fails.** Confirm the ZIP was extracted in full and the computer can reach the npm registry. Fix the first npm error shown, then rerun the launcher.
- **The browser does not open or the page looks empty.** Copy the exact URL printed in the terminal and keep that terminal open. A second run may pick a different port, which has its own browser workspace.
- **The app cannot open its database.** Use a regular browser window with site storage enabled. Close other planner tabs if the app reports a database upgrade is blocked.

## Developer setup

### Clone and start

```sh
git clone https://github.com/franciscoghansen/cozy-games-farm-planner.git
cd cozy-games-farm-planner
node --version
npm --version
npm run start:local
```

The developer launcher uses the same startup script. Set `FARM_PLANNER_NO_BROWSER=1` to skip the browser handoff in a headless session. For the conventional development workflow, run `npm ci` and then `npm run dev`. Append `#crafting` to the printed URL to open the Crafting Planner directly.

### Test and preview the production build

```sh
npm test
npm run build
npm run preview
```

`npm test` runs the Node test suite. `npm run build` first checks TypeScript and then writes the static bundle to `dist/`. Open the address printed by `npm run preview` to inspect the built app. A static web server can also serve `dist/`, including its `games/` directory. If you see a game-data loading error after opening `index.html` from disk, use the development or preview server so the browser can fetch the bundled JSON over HTTP.

## Quick start

### Design and optimize a farm

1. Select **Coral Island** in the header, then choose a **Layout preset** in **Farm setup**. **Efficient Starter** is a compact example with 20 fully watered and protected crop tiles. Enter your own width and height and click **Apply** for a custom board.
2. Pick a sprinkler or scarecrow in **Placement tools**, then click or drag across the grid. Use **Obstacle** and **Path** for tiles the optimizer must preserve. Enable **Lock newly placed equipment** or use **Toggle lock** to protect specific placements.
3. Turn on the **Combined**, **Water**, or **Protection** overlay to inspect coverage. Scroll to zoom and use **Pan** or Space + drag to move the board. Hover over equipment to highlight its range.
4. Choose a **Farming progression** and set owned quantities in **Equipment inventory**. To include specific shop, festival, merit, or DLC equipment, choose **Custom equipment** and check the items you have unlocked.
5. Choose a strategy under **Layout optimizer** and select **Optimize layout**. See **Farm statistics** for covered tiles, efficiency, and equipment usage. Use **Undo** to restore the previous arrangement.
6. Open **Layouts** to save, duplicate, or reopen a named layout. Use **Export → Download JSON** for a portable layout backup or **Download PNG** for a picture of the board.

### Plan an upgrade with existing equipment

1. Open **Materials**, select **Upgrade existing layout**, and click **Capture current layout** before changing the board. A named saved layout can also serve as the baseline.
2. Enter spare equipment and material stock, then edit the layout. Alternatively, choose **Upgrade layout** in the optimizer to capture the current board automatically before optimizing.
3. Return to **Materials** and review the **Equipment requirements** table. It separates reusable placements, owned spares, and items still needed. Use **Shopping list** for shortages and **Checklist** for crafting order.

### Calculate and save a crafting plan

1. Open **Crafting Planner**. Search by item name or ID, select an item, enter a quantity, and choose **Add target**. Repeat to combine several items in one calculation.
2. Open **Owned stock** to enter raw materials, intermediates, and spare equipment. Toggle **Apply owned inventory** to compare your current shortages with the full recipe cost.
3. Open **Recipe alternatives** where available. View the **Shopping list**, **Aggregated materials**, **Dependency tree**, or **Checklist**.
4. Open **Saved crafting plans**, enter a name, and select **Save crafting plan**. Use **Load crafting plan** to reopen one. The calculation uses your current stock when you reload a saved plan.

### Browser storage and backups

Layouts, crafting plans, stock, and custom game data stay in IndexedDB on your device. The hosted and local copies use separate browser origins. Different browsers, profiles, hostnames, and ports have separate storage. Clearing site data removes the records for that origin.

1. Choose **Export → Download workspace backup** to save all layouts, stock, crafting plans, preferences, and custom games in one JSON file.
2. Open the destination copy of the planner, close its other planner tabs, then choose **Export → Restore workspace backup** and select the file. Confirm to replace the data for games in the backup. Other games stay in place.
3. To move one layout, choose **Export → Download JSON**, select the matching game in the destination, and use **Export → Import JSON**. To move a game definition alone, use **Game data → Export game** and **Import game**.

Keep backups somewhere private. Moving data between devices or between local and hosted copies requires an export and restore.

## Enable GitHub Pages

GitHub Free requires a public repository for Pages. GitHub Pro, Team, and Enterprise also support Pages from private repositories. Check the intended site visibility before enabling deployment. [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to the default branch or open **Actions → Deploy GitHub Pages → Run workflow** on that branch.
4. Once the workflow succeeds, open the URL shown on the deployment. It installs dependencies, runs tests, checks TypeScript, and publishes `dist/`. The repository path comes from Pages configuration. The Crafting Planner uses a URL fragment so refreshing it requests the same HTML page.

See [GitHub's Pages setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for repository settings and permissions.

### Launch and deployment checks

- On macOS, open `start.command` from Finder in a freshly extracted folder. Confirm the default browser opens, then run it again and check that dependencies are reused.
- On Linux, run `./start.sh` in a freshly extracted folder on a desktop with a default browser. Confirm the browser opens or the launcher prints an address you can open yourself.
- After the first Pages deployment, visit the URL in the deployment log, open and refresh `#crafting`, and test game JSON import and workspace backup restore with sample data.

## Feedback and contributions

Report bugs and request features through [GitHub Issues](https://github.com/franciscoghansen/cozy-games-farm-planner/issues/new/choose). See [CONTRIBUTING.md](CONTRIBUTING.md) for test steps and how to submit a game definition. The suggested license for the original application code is MIT, pending owner approval. Game names and assets belong to their respective owners.

## Layout and materials reference

- The header game selector loads that game's layouts, inventory, presets, recipe choices and preferences. Layouts supports named saves, duplication and reset. JSON exports identify their game. Old layout exports remain readable, and the original browser autosave and named layouts are copied from localStorage on first launch in the same browser origin.
- Paint or erase tiles, choose equipment from available progression levels, and lock placements you want to keep. Use the wheel or zoom buttons to zoom, the Pan tool or Space + drag to move, and Ctrl/Cmd+Z to undo. Export PNG renders the full board using the active overlays. Boards support dimensions up to 200 × 200.
- Open **Materials** for the live shopping list, aggregated materials, expandable dependency tree or ordered crafting checklist. Build from scratch ignores stock. Inventory mode deducts owned items. Upgrade mode reuses placements from a captured or named layout, even if relocated. Capture the baseline before making changes, or use **Upgrade layout** to capture it automatically. Custom mode calculates requirements for one item and quantity. Name and save configurations to recall modes, baselines and recipe choices.
- Open **Crafting Planner** in the header or visit `/#crafting` to search the catalog and plan several items together. Toggle **Apply owned inventory** to calculate with or without current stock. The workspace keeps an autosaved draft and named saves per game. Named saves store target quantities, recipe choices, and whether to use inventory. Reloading a plan uses the current stock.
- Enter **spare, unplaced** equipment as stock when using upgrade or materials optimization. The layout baseline supplies equipment already on the board. This avoids counting the same items as both owned and reusable. Raw and intermediate stock goes under **Owned stock**. Mark an outstanding resource as collected in a stock-aware mode to update its inventory. Calculating or optimizing a plan leaves stock quantities available for future calculations.
- Known recipes expand to leaf materials. Shared demand is aggregated before using intermediate inventory and rounding batches. Surplus main output and byproducts are reported separately. Byproducts are treated as surplus for a future job, so the checklist can run in ingredient dependency order without assuming a byproduct is already available. Unknown quantities are called out, and purchases and other external acquisitions appear as outstanding items.
- **Game data** searches the catalog, shows recipes and dependency trees, edits item JSON, adds or overrides recipes, and handles package import and export. Importing a new ID adds a game to the selector. Importing an installed ID creates a local override. Reset restores the bundled data when existing plans still validate against it. Use a separate ID to maintain an alternative package alongside the original.

## Optimizer

The Web Worker tries deterministic greedy candidates, followed by pruning. The search preserves obstacles, paths, and locked equipment and reports the best result it found.

| Strategy | Objective |
| --- | --- |
| Maximum production | Favor crop count, then fewer pieces of equipment. |
| Low resources | Find a layout with fewer pieces that meets the target. Otherwise report the crop shortfall. |
| Balanced | Trade crop coverage against equipment count, overlap and wasted applications. |
| Minimal rework | Favor crop gains with fewer moves, removals and additions. |
| Minimize raw resource cost | Prefer layouts meeting the crop target, then fewer unresolved units and fewer known leaf-material units. Compares raw quantities without market-price weights, using selected recipes and build-from-scratch costs. |
| Use available materials | Try placements using reusable equipment, spare equipment and shared material stock. Revalidate the full proposed layout against one BOM, and show its crafting steps and stock allocation. This strategy uses a shared material budget in place of the equipment-only limit. |

The search is approximate. It does not prove that a missed target is impossible. The materials search assumes access to indicated stations and unlocked recipes. Recipe unlocks and processing times are displayed as metadata. Equipment unlocks are enforced by the selected progression or custom equipment choices. Unknown and external materials require stock on hand in the materials search.

## Reuse the BOM engine

Import `calculateBom` from `src/bom.ts` and pass item and recipe arrays from any catalog. `src/crafting-types.ts` defines the generic inputs. The calculation runs without game packages or application initialization.

```ts
const result = calculateBom({
  items,
  recipes,
  targets: [{ itemId: 'radio', quantity: 2 }, { itemId: 'antenna', quantity: 1 }],
  inventory: { copper: 12, wire: 3 },
  options: { selections: { wire: 'draw_wire' } },
})

result.rawMaterials
result.intermediates
result.steps
result.consumed
result.deficits
result.surplus
result.unresolved
result.warnings
```

The example uses fictional item and recipe IDs. The calculator rejects invalid references, quantities, and circular dependencies in the selected recipes. Use `prepareBom` to reuse the same catalog and recipe choices across many requests. The farm adapter in `src/farm-bom.ts` counts placements and deducts reusable equipment before calling the calculator. Both planner views render the result through `src/BomView.tsx`.

## Add a game without changing application code

Either import a single package through **Game data**, or add a directory under `public/games/<id>/` and append the ID to `public/games/manifest.json`. The manifest uses schema version 1 and has `games` (an array of directory IDs), `defaultGame`, and optional `layoutV1Game` for interpreting legacy layout files. The package files combine into this import/export shape.

```json
{
  "game": { "schemaVersion": 1, "contentVersion": "1.0.0", "id": "my-game", "name": "My Game",
    "requiredCoverage": ["water"], "progressions": [],
    "acquisitionMethods": {"gathering": "Gathering"}, "stations": [] },
  "items": [{"id": "water_pump", "name": "Water Pump", "category": "equipment", "acquisition": []}],
  "equipment": [{"itemId": "water_pump", "kind": "water", "radius": 2, "shape": "circle", "label": "WP"}],
  "recipes": [],
  "presets": []
}
```

The example is fictional. Each top-level value lives in its own file for bundled games.

| File | Fields |
| --- | --- |
| `game.json` | `schemaVersion: 1`, `contentVersion`, `id`, `name`, `acquisitionMethods` (ID-to-label map), `stations` (`id`, `name`), `progressions` (`id`, `name`, `equipment` ID array). Optional `description`, `requiredCoverage` (defaults to water and guard, can be empty), `defaultInventory` (equipment ID-to-count map), and `defaultPreset` (preset ID). With no progressions all equipment starts available in Custom. |
| `items.json` | Array of `id`, `name`, `category`, and `acquisition` (method IDs). Categories are `raw_resource`, `refined_material`, `crafted_component`, `equipment`, `consumable`, and `miscellaneous`. Optional `description`, `icon` (short text or null), `craftable`, `purchasable`, `unlock`, `stationId`, and `recipeNote` for incomplete data. |
| `equipment.json` | Array of `itemId` (an equipment-category item), `kind` (`water` or `guard`), `shape` (`square` or `circle`), `radius` (positive integer), and optional `label`. Squares use Chebyshev distance and circles use Euclidean distance. Both clip at board edges and exclude the item center. |
| `recipes.json` | Array of `id`, `output` and `ingredients`. Each quantity entry is `{ "itemId": "...", "quantity": 1 }` with a positive integer. Optional `name`, `stationId`, `unlock`, `alternativeIds`, `byproducts` (quantity entries), `seconds` (per batch), and `source`. Recipes sharing an output are alternatives. The first is the default, and optional `alternativeIds` must reference recipes for the same output. An empty ingredient list is valid only when the known recipe produces an item without consumable input. |
| `presets.json` | Array of `id`, `name`, `width`, `height`, and `placements` (`x`, `y`, `tile`). Coordinates start at zero. Optional `fill` (`crop`, the default, or `empty`) and `progression` (level ID). Tile values are `crop`, `empty`, `rock`, `path`, an equipment ID, or `!<id>` for locked equipment. |

IDs use lowercase letters, digits, underscores and hyphens, start with a letter or digit, and have a maximum length of 64. Tile and editor tool names are reserved for equipment IDs. The validator rejects unsupported versions, duplicate IDs or placements, invalid shapes and quantities, missing references, and cycles in the recipe ingredient graph across possible alternatives. The fictional [Meadow Test package](tests/fixtures/meadow-test.game.json) provides a more complete import example. It is used by tests and does not ship in the game selector.

## Coral Island data

All six original equipment tiers and preset layouts retain their planner IDs and coverage. Efficient Starter, Expanded Early Game, Mid Game, and Late Game produce 20, 184, 96, and 320 fully covered crops. Minimal Resources reaches seven because covering all eight neighbors of Sprinkler I with a Makeshift Scarecrow requires placing the scarecrow on one of those neighbors.

The scarecrow catalog follows the [requested Fandom list](https://coralisland.fandom.com/wiki/Scarecrow#List) and also includes the separately documented [Scrap Scarecrow](https://coralisland.fandom.com/wiki/Scrap_scarecrow). The bundled catalog includes recipes, unlocks, and coverage for all 25 entries. For Ondel-Ondel Pretty, the list specifies one Cotton Cloth and the [crafting table](https://coralisland.fandom.com/wiki/Crafting#Farming) specifies ten. The Materials panel offers both amounts, with the scarecrow list as the default. In the planner, use **Farming progression → Custom equipment** to enable shop, festival, merit and DLC scarecrows as you unlock them. **Game data** and custom crafting targets show all entries.

The sprinkler formulas were cross-checked against the [Coral Island crafting table](https://coralisland.wiki/wiki/Crafting) and the [community crafting reference](https://coralisland.fandom.com/wiki/Crafting). The [Recycling Machine reference](https://www.coralisland.wiki/wiki/Resource_Equipment) documents the alternative Scrap inputs. Batteries are listed as externally acquired.
