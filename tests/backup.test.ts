import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { backupSizeLimit, exportBackup, parseBackup, restoreBackup } from '../src/backup.ts'
import { registerGame } from '../src/equipment.ts'
import { adaptGame, validatePackage } from '../src/game.ts'
import { bootstrap, dbGet, dbWrite, emptyState, loadGameState, openDatabase } from '../src/workspace-db.ts'
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


test('backup rejects unknown inventory, BOM targets, crafting targets, and recipe choices', () => {
  const bundled = new Map([[gameId, pack]])
  const makeBackup = () => ({ format: 'cozy-games-farm-planner', version: 1, activeGame: gameId,
    games: [], states: [emptyState(gameId)] })
  const mutations: [string, (state: GameState) => void][] = [
    ['materials inventory', state => { state.materials.retired = 3 }],
    ['BOM target', state => { state.bom = { ...state.bom, targetId: 'retired' } }],
    ['crafting targets', state => { state.crafting = { active: '', saved: [],
      draft: { targets: [{ itemId: 'retired', quantity: 1 }], useInventory: false, selections: {} } } }],
    ['recipe choices', state => { state.bom = { ...state.bom, selections: { retired: 'smelt' } } }],
    ['Unknown recipe choice', state => { state.bom = { ...state.bom, selections: { bar: 'make_orb' } } }],
    ['Unknown recipe choice', state => { state.bom = { ...state.bom, selections: { bar: 'retired' } } }],
  ]
  for (const [error, mutate] of mutations) {
    const backup = makeBackup()
    mutate(backup.states[0])
    assert.throws(() => parseBackup(JSON.stringify(backup), bundled), new RegExp(error))
  }
  assert.throws(() => parseBackup(' '.repeat(backupSizeLimit + 1), bundled), /exceeds 32 MiB/)
  const backup = makeBackup()
  backup.states[0].workspace.saved = Array(2_001).fill({ id: 'layout', plan: backup.states[0].workspace.current })
  assert.throws(() => parseBackup(JSON.stringify(backup), bundled), /Too many entries in saved layouts/)
})

test('load migrates legacy defaults and repairs stale catalog IDs in stored states', async () => {
  const db = await openDatabase(new IDBFactory())
  const { workspace } = emptyState(gameId)
  const { gameId: _legacy, ...current } = workspace.current
  await dbWrite(db, 'states', gameId, { workspace: { ...workspace, current } })
  const legacy = await loadGameState(db, gameId)
  assert.equal(legacy.state.workspace.current.gameId, gameId)
  assert.deepEqual(legacy.state.materials, {})
  assert.deepEqual(legacy.state.configurations, [])
  assert.deepEqual(legacy.state.bom, emptyState(gameId).bom)

  const state = emptyState(gameId)
  state.workspace.current.tiles[0] = '!retired'
  state.workspace.current.inventory.retired = 3
  state.workspace.current.unlocked.push('retired')
  state.materials = { retired: 2, ore: 4 }
  state.bom = { ...state.bom, targetId: 'retired', selections: { bar: 'smelt', orb: 'smelt' } }
  state.crafting = { active: '', saved: [], draft: { targets: [{ itemId: 'retired', quantity: 2 }, { itemId: 'orb', quantity: 1 }],
    useInventory: true, selections: { retired: 'make_orb' } } }
  await dbWrite(db, 'states', gameId, state)
  const repaired = await loadGameState(db, gameId)
  assert.equal(repaired.repaired, true)
  assert.equal(repaired.state.workspace.current.tiles[0], 'crop')
  assert.equal(repaired.state.workspace.current.inventory.retired, undefined)
  assert.ok(!repaired.state.workspace.current.unlocked.includes('retired'))
  assert.deepEqual(repaired.state.materials, { ore: 4 })
  assert.equal(repaired.state.bom.targetId, '')
  assert.deepEqual(repaired.state.bom.selections, { bar: 'smelt' })
  assert.deepEqual(repaired.state.crafting?.draft.targets, [{ itemId: 'orb', quantity: 1 }])
  assert.deepEqual(repaired.state.crafting?.draft.selections, {})
  db.close()
})

const fixtureJson = async (path: string) => path === 'manifest.json'
  ? { schemaVersion: 1, games: [gameId], defaultGame: gameId }
  : pack[path.split('/')[1].replace('.json', '') as keyof typeof pack]

test('bootstrap skips broken overrides and preserves unrecoverable state for export', async () => {
  const db = await openDatabase(new IDBFactory())
  const malformed = { workspace: { current: { tiles: null } } }
  await dbWrite(db, 'games', gameId, { game: { id: gameId } })
  await dbWrite(db, 'states', gameId, malformed)
  const session = await bootstrap(async () => db, fixtureJson)
  assert.deepEqual(session.invalidOverrides, [gameId])
  assert.deepEqual(session.games.get(gameId), pack)
  assert.deepEqual(session.state, emptyState(gameId))
  assert.deepEqual(session.recovery, { state: malformed })
  await dbWrite(db, 'states', gameId, session.state)
  assert.deepEqual((await loadGameState(db, gameId)).recovery, session.recovery)
  db.close()
})

test('bootstrap opens with exportable in-memory state when IndexedDB rejects', async () => {
  const session = await bootstrap(async () => { throw new Error('Storage blocked') }, fixtureJson)
  assert.ok(session.db instanceof Map)
  session.state.materials.ore = 5
  await dbWrite(session.db, 'states', gameId, session.state)
  assert.equal(parseBackup(await exportBackup(session.db, gameId), session.bundled).states[0].materials.ore, 5)
})
