import { readdir, readFile } from 'node:fs/promises'
import { loadBundledGames } from '../src/bundled-games.ts'

const root = new URL('../public/games/', import.meta.url)

const { manifest, packages } = await loadBundledGames(async (file) => {
  try {
    const data: unknown = JSON.parse(await readFile(new URL(file, root), 'utf8'))
    return data
  } catch (error) {
    throw new Error(`public/games/${file}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
})

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isDirectory() && !manifest.games.includes(entry.name)) {
    throw new Error(`public/games/${entry.name}: package directory is missing from manifest.json`)
  }
}

for (const pack of packages) console.log(`Validated public/games/${pack.game.id}`)
