import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadBundledGames } from '../src/bundled-games.ts'
import { validatePackage } from '../src/game.ts'

const fixture = validatePackage(
  JSON.parse(readFileSync(new URL('./fixtures/meadow-test.game.json', import.meta.url), 'utf8')),
)
const id = fixture.game.id

function source(changes: Readonly<Record<string, unknown>> = {}) {
  const files: Record<string, unknown> = {
    'manifest.json': { schemaVersion: 1, defaultGame: id, games: [id] },
    ...Object.fromEntries(Object.entries(fixture).map(([key, value]) => [`${id}/${key}.json`, value])),
    ...changes,
  }

  return (path: string) => {
    if (!Object.hasOwn(files, path)) return Promise.reject(new Error(`Missing ${path}`))
    return Promise.resolve(files[path])
  }
}

void test('the bundled loader reads manifest packages and reports their game ID on validation errors', async () => {
  const { packages } = await loadBundledGames(source())
  assert.deepEqual(packages, [fixture])

  await assert.rejects(
    loadBundledGames(source({ [`${id}/game.json`]: { ...fixture.game, schemaVersion: 2 } })),
    { message: `${id}: game.schemaVersion: unsupported schema version` },
  )
  await assert.rejects(
    loadBundledGames(source({ [`${id}/game.json`]: { ...fixture.game, id: 'wrong-game' } })),
    { message: `Game ID does not match its manifest directory: ${id}` },
  )
})

void test('the bundled loader requires crop files when the game enables crop data', async () => {
  await assert.rejects(
    loadBundledGames(source({ [`${id}/game.json`]: { ...fixture.game, cropData: true } })),
    { message: `Missing ${id}/seasons.json` },
  )
})
