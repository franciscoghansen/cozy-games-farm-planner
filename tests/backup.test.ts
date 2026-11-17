import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { exportBackup, parseBackup, restoreBackup } from '../src/backup.ts'
import { registerGame } from '../src/equipment.ts'
import { adaptGame, validatePackage } from '../src/game.ts'
import { dbGet, dbWrite, emptyState, openDatabase } from '../src/workspace-db.ts'
import type { GameState } from '../src/workspace-db.ts'

const pack = validatePackage(JSON.parse(readFileSync(new URL('./fixtures/meadow-test.game.json', import.meta.url), 'utf8')))
const gameId = pack.game.id
registerGame(adaptGame(pack))

test('workspace backup moves layouts, materials, crafting plans, and custom games between databases', async () => {
  const source = await openDatabase(new IDBFactory())
  const destination = await openDatabase(new IDBFactory())
  const state = emptyState(gameId)
  state.workspace.current.tiles[0] = '!orb'
  state.workspace.saved.push({ id: 'saved', plan: state.workspace.current })
  state.workspace.active = 'saved'
  state.materials.ore = 12
  state.bom = { ...state.bom, mode: 'upgrade', snapshot: state.workspace.current }
  state.crafting = { active: 'project', draft: { targets: [{ itemId: 'orb', quantity: 3 }], useInventory: true, selections: {} }, saved: [] }
  state.crafting.saved.push({ id: 'project', name: 'Build orbs', draft: state.crafting.draft })
  await dbWrite(source, 'states', gameId, state)
  await dbWrite(source, 'games', gameId, pack)
  await dbWrite(destination, 'states', 'unrelated', { keep: true })

  const file = await exportBackup(source, gameId)
  const backup = parseBackup(file, new Map())
  await restoreBackup(destination, backup)

  assert.deepEqual(await dbGet<GameState>(destination, 'states', gameId), state)
  assert.deepEqual(await dbGet(destination, 'games', gameId), pack)
  assert.equal(await dbGet(destination, 'settings', 'selected'), gameId)
  assert.deepEqual(await dbGet(destination, 'states', 'unrelated'), { keep: true })
  source.close()
  destination.close()
})

test('backup validation rejects bad tiles, versions and quantities before restoration', async () => {
  const db = await openDatabase(new IDBFactory())
  const state = emptyState(gameId)
  await dbWrite(db, 'states', gameId, state)
  const file = await exportBackup(db, gameId)
  const bundled = new Map([[gameId, pack]])
  const backup = JSON.parse(file)
  assert.deepEqual(parseBackup(file, bundled).states, [state])
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, version: 99 }), bundled), /supported Farm Planner backup/)
  backup.states[0].materials.ore = -1
  assert.throws(() => parseBackup(JSON.stringify(backup), bundled), /materials inventory/)
  backup.states[0].materials.ore = 1
  backup.states[0].workspace.current.tiles[0] = 'not-installed'
  assert.throws(() => parseBackup(JSON.stringify(backup), bundled), /Invalid farm tiles/)
  assert.deepEqual(await dbGet(db, 'states', gameId), state)
  db.close()
})
