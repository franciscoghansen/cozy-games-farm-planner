import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { calculateBom } from '../src/bom.ts'
import { layoutBom, defaultBomSettings, farmLayoutToCraftingTargets } from '../src/farm-bom.ts'
import { emptyCrafting } from '../src/crafting-plans.ts'
import { coverage, statistics } from '../src/coverage.ts'
import { gameFor, registerGame } from '../src/equipment.ts'
import { adaptGame, validateManifest, validatePackage } from '../src/game.ts'
import { countEquipment, newPlan } from '../src/model.ts'
import { optimize } from '../src/optimizer.ts'
import { deserialize, loadWorkspace, serialize } from '../src/storage.ts'
import { dbGet, dbGetAll, dbWrite, emptyState, openDatabase } from '../src/workspace-db.ts'
import type { GameState } from '../src/workspace-db.ts'

const definition = validatePackage(JSON.parse(readFileSync(new URL('./fixtures/meadow-test.game.json', import.meta.url), 'utf8')))
const game = adaptGame(definition)
registerGame(game, true)
const row = (result: ReturnType<typeof calculateBom>, id: string) => result.materials.find(row => row.id === id)!
const plan = () => newPlan(5, 5, 'Meadow')
const calculate = (counts: Record<string, number>, inventory = {}, selections = {}) => calculateBom({
  ...game, targets: Object.entries(counts).map(([itemId, quantity]) => ({ itemId, quantity })),
  inventory, options: { selections },
})

test('shared dependency demand is aggregated before batching and surplus is recorded', () => {
  const result = calculate({ orb: 1, tower: 1 })
  const bar = row(result, 'bar')
  assert.equal(bar.required, 5)
  assert.equal(bar.batches, 2)
  assert.equal(bar.produced, 6)
  assert.equal(row(result, 'ore').required, 6)
  assert.equal(result.surplus.get('bar'), 1)
  assert.equal(result.surplus.get('slag'), 2)
  assert.equal(result.operations, 5)
  assert.deepEqual(result.stations, ['kiln'])
  const order = result.steps.map(row => row.id)
  assert.ok(order.indexOf('bar') < order.indexOf('widget'))
  assert.ok(order.indexOf('widget') < order.indexOf('orb'))
  assert.ok(order.indexOf('bar') < order.indexOf('tower'))
})

test('intermediate stock is consumed once across all roots and raw stock is deducted', () => {
  const result = calculate({ orb: 1, tower: 1 }, { bar: 3, ore: 2 })
  assert.equal(row(result, 'bar').owned, 3)
  assert.equal(row(result, 'bar').batches, 1)
  assert.equal(row(result, 'ore').required, 3)
  assert.equal(row(result, 'ore').owned, 2)
  assert.equal(row(result, 'ore').remaining, 1)
  assert.equal(result.consumed.get('bar'), 3)
  assert.equal(result.feasible, false)
})

test('alternative recipes change the bill and allow batch surplus on custom targets', () => {
  const result = calculate({ bar: 7 }, {}, { bar: 'whittle' })
  assert.equal(result.steps[0].recipe?.id, 'whittle')
  assert.equal(row(result, 'bar').batches, 3)
  assert.equal(row(result, 'bar').produced, 9)
  assert.equal(result.surplus.get('bar'), 2)
  assert.equal(row(result, 'wood').remaining, 6)
  assert.equal(result.shopping.some(row => row.id === 'ore'), false)
})

test('unknown requirements remain real shortages and externally sourced items are identified', () => {
  const result = calculate({ unknown: 2, wood: 3 }, { unknown: 1 })
  assert.equal(row(result, 'unknown').unknown, true)
  assert.equal(row(result, 'unknown').remaining, 1)
  assert.equal(row(result, 'wood').unknown, false)
  assert.equal(result.operations, 0)
  assert.equal(result.feasible, false)
})

test('scratch ignores stock while upgrades reuse relocated equipment without refunds', () => {
  const base = plan()
  base.tiles[0] = '!orb'
  base.tiles[2] = 'deluxe'
  const target = plan()
  target.tiles[10] = 'orb'
  target.tiles[12] = 'orb'
  target.tiles[14] = 'tower'
  const stock = { tower: 1, bar: 3 }
  const scratch = layoutBom(game, target, stock, defaultBomSettings, base)
  assert.equal(scratch.roots.find(row => row.id === 'orb')!.remaining, 2)
  assert.equal(row(scratch, 'ore').required, 9)
  const upgrade = layoutBom(game, target, stock, { ...defaultBomSettings, mode: 'upgrade' }, base)
  assert.deepEqual(farmLayoutToCraftingTargets(target, base), [{ itemId: 'orb', quantity: 1 }, { itemId: 'tower', quantity: 1 }])
  assert.deepEqual(upgrade.roots.find(row => row.id === 'orb'), { id: 'orb', required: 2, reusable: 1, owned: 0, remaining: 1 })
  assert.equal(upgrade.roots.find(row => row.id === 'tower')!.owned, 1)
  assert.equal(upgrade.operations, 2)
  assert.equal(upgrade.consumed.get('bar'), 3)
  assert.equal(upgrade.shopping.length, 0)
  assert.equal(upgrade.feasible, true)
  assert.equal(upgrade.surplus.has('deluxe'), false)
})

test('standalone targets and the farm adapter return the same calculation for identical inputs', () => {
  const target = plan()
  target.tiles[0] = '!orb'
  target.tiles[1] = 'tower'
  const inventory = { bar: 1, wood: 2 }
  const selections = { bar: 'whittle' }
  const standalone = calculateBom({ ...game, targets: farmLayoutToCraftingTargets(target), inventory, options: { selections } })
  const { roots, ...farmResult } = layoutBom(game, target, inventory, { ...defaultBomSettings, mode: 'inventory', selections })
  assert.deepEqual(roots.map(({ reusable, ...root }) => { assert.equal(reusable, 0); return root }), standalone.roots)
  const { roots: _targets, ...standaloneResult } = standalone
  assert.deepEqual(farmResult, standaloneResult)
})

test('game JSON validates references, cycles, duplicate IDs, coverage and versions', () => {
  assert.deepEqual(validatePackage(JSON.parse(JSON.stringify(definition))), definition)
  assert.throws(() => validateManifest({ schemaVersion: 2 }), /unsupported schema/)
  assert.throws(() => validatePackage({ ...definition, game: { ...definition.game, schemaVersion: 2 } }), /unsupported schema/)
  assert.throws(() => validatePackage({ ...definition, items: [...definition.items, definition.items[0]] }), /duplicate ID/)
  assert.throws(() => validatePackage({ ...definition, recipes: [...definition.recipes, definition.recipes[0]] }), /duplicate ID/)
  const bad = structuredClone(definition)
  bad.recipes[0].ingredients[0].itemId = 'missing'
  assert.throws(() => validatePackage(bad), /unknown reference missing/)
  bad.recipes[0].ingredients[0].itemId = 'orb'
  assert.throws(() => validatePackage(bad), /circular recipe dependencies/)
  assert.throws(() => calculateBom({ ...bad, targets: [{ itemId: 'orb', quantity: 1 }] }), /circular recipe dependencies/)
  bad.recipes[0].ingredients[0].quantity = 0
  assert.throws(() => validatePackage(bad), /expected an integer/)
  const badShape = structuredClone(definition)
  Object.assign(badShape.equipment[0], { shape: 'octagon' })
  assert.throws(() => validatePackage(badShape), /square, circle/)
})

test('circular coverage excludes diagonals and water-only games use their own coverage goal', () => {
  const onlyWater = adaptGame(validatePackage({ ...definition, game: { ...definition.game, id: 'water-only', requiredCoverage: ['water'] } }))
  registerGame(onlyWater)
  const layout = newPlan(5, 5, 'Water only', 'water-only')
  layout.tiles[12] = 'orb'
  const water = coverage(layout).water
  assert.equal(water[11], 1)
  assert.equal(water[6], 0)
  assert.equal(water[12], 0)
  assert.equal(statistics(layout).full, 4)
  assert.equal(statistics(layout).protected, 0)
  assert.ok(optimize(layout).full > 4)
})

test('materials optimizer reserves shared resources across watering and protection', () => {
  const target = plan()
  target.strategy = 'materials'
  target.tiles[0] = 'rock'
  target.tiles[1] = 'path'
  const result = optimize(target, undefined, { inventory: { ore: 6 } })
  const used = countEquipment(result.plan)
  assert.ok(result.full > 0)
  assert.equal(result.plan.tiles[0], 'rock')
  assert.equal(result.plan.tiles[1], 'path')
  assert.equal(used.deluxe, 0)
  assert.equal(result.crafting?.feasible, true)
  assert.equal(result.crafting?.consumed.get('ore'), 6)
  const strict = optimize(target, undefined, { inventory: { ore: 3 } })
  assert.equal(strict.full, 0)
  assert.equal(strict.crafting?.feasible, true)
})

test('resource-cost optimizer can choose cheaper stock for the same crop target', () => {
  const target = plan()
  target.tiles[6] = 'deluxe'
  target.tiles[12] = 'tower'
  target.strategy = 'cost'
  target.target = 1
  const result = optimize(target)
  assert.equal(result.shortfall, 0)
  assert.equal(countEquipment(result.plan).deluxe, 0)
  assert.ok(countEquipment(result.plan).orb > 0)
})

test('IndexedDB stores layouts, inventory, overrides, BOM settings and selected game independently', async () => {
  const copy = { ...definition, game: { ...definition.game, id: 'other-farm', name: 'Other Farm' } }
  registerGame(adaptGame(copy))
  const db = await openDatabase(new IDBFactory())
  const first = emptyState(game.game.id), other = emptyState(copy.game.id)
  first.workspace.current.tiles[2] = 'orb'
  first.workspace.current.tiles[3] = '!tower'
  first.workspace.saved.push({ id: 'farm-a', plan: first.workspace.current })
  first.materials.ore = 32
  first.bom = { ...defaultBomSettings, mode: 'custom', targetId: 'bar', quantity: 4, selections: { bar: 'whittle' } }
  first.configurations = [{ id: 'config-a', name: 'Wood route', settings: first.bom }]
  first.preferences = { manualLock: true, overlays: { combined: true, water: false, guard: false, equipment: false, coords: true } }
  other.materials.ore = 1
  first.crafting = emptyCrafting()
  first.crafting.draft = { targets: [{ itemId: 'bar', quantity: 7 }], useInventory: true, selections: { bar: 'whittle' } }
  first.crafting.saved = [{ id: 'craft-a', name: 'Seven bars', draft: first.crafting.draft }]
  other.crafting = emptyCrafting()
  other.crafting.draft.targets.push({ itemId: 'tower', quantity: 2 })
  await dbWrite(db, 'states', game.game.id, first)
  await dbWrite(db, 'states', copy.game.id, other)
  await dbWrite(db, 'games', copy.game.id, copy)
  await dbWrite(db, 'settings', 'selected', copy.game.id)
  assert.deepEqual(await dbGet<GameState>(db, 'states', game.game.id), first)
  assert.deepEqual(await dbGet<GameState>(db, 'states', copy.game.id), other)
  assert.deepEqual(await dbGetAll(db, 'games'), [copy])
  assert.equal(await dbGet(db, 'settings', 'selected'), copy.game.id)
  assert.equal(gameFor(copy.game.id).game.name, 'Other Farm')
  assert.throws(() => deserialize(serialize(first.workspace.current), copy.game.id), /Switch games/)
  const { gameId, ...legacy } = first.workspace.current
  const migrated = loadWorkspace({ getItem: () => JSON.stringify({ current: legacy, active: null, saved: [] }) }, first.workspace.current)
  assert.deepEqual(migrated.current, first.workspace.current)
  db.close()
})
