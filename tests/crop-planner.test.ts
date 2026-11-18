import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { adaptGame, validatePackage, withBundledCrops } from '../src/game.ts'
import { registerGame } from '../src/equipment.ts'
import { newPlan, resize } from '../src/model.ts'
import { deserialize, serialize } from '../src/storage.ts'
import { exportBackup, parseBackup, restoreBackup } from '../src/backup.ts'
import { dbGet, dbWrite, emptyState, loadGameState, openDatabase } from '../src/workspace-db.ts'
import { calendarMath, planningWindow } from '../src/crops/calendar.ts'
import { simulateCrop } from '../src/crops/growth.ts'
import { calculateEconomics, isHarvest } from '../src/crops/economics.ts'
import { cropPlanner } from '../src/crops/optimizer.ts'
import { farmCropArea, placeCrops, plotKey, rectangle } from '../src/crops/crop-layout-adapter.ts'
import { seedProduction, seedShopping } from '../src/crops/seed-bom.ts'
import type { Calendar, Crop, CropPlan, CropSettings } from '../src/crops/types.ts'

const legacy = validatePackage(
  JSON.parse(readFileSync(new URL('./fixtures/meadow-test.game.json', import.meta.url), 'utf8')),
)
const calendar: Calendar = {
  schemaVersion: 1,
  contentVersion: 'fixture',
  hasSeasons: true,
  currency: 'marks',
  seasons: [
    { id: 'rain', name: 'Rain', days: 5 },
    { id: 'sun', name: 'Sun', days: 8 },
  ],
  growthStart: 'following-day',
  crossSeason: 'crop-specific',
  source: 'https://example.test/calendar',
  ranks: [
    { id: 'start', name: 'Start' },
    { id: 'expert', name: 'Expert' },
  ],
  environments: [
    { id: 'field', name: 'Field' },
    { id: 'water', name: 'Underwater' },
  ],
  qualities: [
    { id: 'base', name: 'Base' },
    { id: 'fine', name: 'Fine' },
  ],
}
const bean: Crop = {
  id: 'bean',
  itemId: 'bean',
  seedId: 'bean-seed',
  name: 'Bean',
  category: 'test',
  environment: 'field',
  footprint: { width: 1, height: 1 },
  seasons: ['rain', 'sun'],
  growth: 2,
  yield: 3,
  seedCost: 4,
  prices: { base: 5, fine: 7 },
  survivesSeasonChange: true,
  replant: true,
  status: 'verified',
  source: 'https://example.test/bean',
}
const berry: Crop = { ...bean, id: 'berry', name: 'Berry', regrowth: 2, replant: false }
const packageData = {
  ...legacy,
  items: [
    ...legacy.items,
    { id: 'bean', name: 'Bean', category: 'raw_resource', acquisition: [] },
    { id: 'bean-seed', name: 'Bean seeds', category: 'consumable', acquisition: [] },
  ],
  seasons: calendar,
  crops: { schemaVersion: 1, contentVersion: 'fixture', crops: [bean, berry] },
}
const pack = validatePackage(packageData)
const game = adaptGame(pack)
registerGame(game)
const settings: CropSettings = {
  date: { year: 1, season: 'rain', day: 1 },
  horizon: 'remaining',
  seasons: 2,
  tiles: 20,
  farm: false,
  manualWater: true,
  protectedOnly: false,
  budget: 10,
  quality: 'base',
  rank: 'start',
  unlocked: [],
  strategy: 'maximum',
  replant: false,
  modifier: '',
}
const dates = (crop: Crop, start = 0, end = 4, replant = false, definition = calendar) =>
  simulateCrop(definition, crop, { start, end, replant })
    .events.filter(isHarvest)
    .map((event) => event.day)

test('crop files are optional and versioned, validate links and distinguish incomplete data', () => {
  assert.equal(legacy.crops, undefined)
  assert.equal(
    withBundledCrops(legacy, pack).items.some((item) => item.id === bean.seedId),
    true,
  )
  const withCrop = (crop: Crop) => ({ ...packageData, crops: { ...packageData.crops, crops: [crop] } })
  assert.throws(() => validatePackage(withCrop({ ...bean, seedId: 'missing' })), /unknown reference/)
  assert.throws(() => validatePackage(withCrop({ ...bean, growth: undefined })), /growth/)
  assert.throws(() => validatePackage(withCrop({ ...bean, prices: { fine: 7 } })), /missing base price/)
  assert.throws(
    () => validatePackage({ ...packageData, seasons: { ...calendar, schemaVersion: 2 } }),
    /version/,
  )
  const incomplete: Crop = { ...bean, growth: undefined, status: 'incomplete' }
  validatePackage(withCrop(incomplete))
  const catalog = [incomplete, { ...berry, environment: 'water' }]
  const planner = cropPlanner(calendar, catalog, settings, {})
  assert.deepEqual(planner.plan().allocations, [])
  assert.match(planner.comparisons[0].warnings.join(' '), /Growth or yield data/)
  assert.match(planner.comparisons[1].warnings.join(' '), /environment/)
})

test('game-specific periods round-trip across year transitions and full season starts at day 1', () => {
  const clock = calendarMath(calendar)
  assert.equal(clock.ordinal({ year: 1, season: 'sun', day: 8 }), 12)
  assert.deepEqual(clock.date(13), { year: 2, season: 'rain', day: 1 })
  assert.deepEqual(clock.date(18), { year: 2, season: 'sun', day: 1 })
  assert.throws(() => clock.ordinal({ year: 1, season: 'rain', day: 6 }), /Invalid/)
  const window = planningWindow(calendar, {
    ...settings,
    date: { year: 1, season: 'sun', day: 7 },
    horizon: 'multiple',
  })
  assert.deepEqual([window.start, window.end], [11, 17])
  assert.equal(
    planningWindow(calendar, { ...settings, date: { ...settings.date, day: 4 }, horizon: 'full' }).start,
    0,
  )
  const seasonless = { ...calendar, hasSeasons: false, seasons: [calendar.seasons[0]] }
  assert.deepEqual(dates({ ...berry, seasons: [] }, 4, 9, false, seasonless), [6, 8])
})

test('growth handles last-day harvest, regrowth, explicit replanting, and rollover', () => {
  assert.deepEqual(dates(bean), [2])
  assert.deepEqual(dates(bean, 2), [4])
  assert.deepEqual(dates(bean, 3), [])
  assert.deepEqual(dates(bean, 0, 4, true), [2, 4])
  assert.deepEqual(dates(bean, 0, 4, false, { ...calendar, growthStart: 'planting-day' }), [1])
  assert.deepEqual(dates(berry, 3, 9), [5, 7, 9])
  assert.deepEqual(dates(berry, 11, 17), [13, 15, 17])
  const seasonal = { ...berry, seasons: ['rain'], survivesSeasonChange: false }
  const result = simulateCrop(calendar, seasonal, { start: 0, end: 7, replant: false })
  assert.deepEqual(
    result.events.filter(isHarvest).map((event) => [event.day, event.quantity]),
    [
      [2, 3],
      [4, 3],
    ],
  )
  assert.deepEqual(result.events.at(-1), { day: 5, activity: 'expires', quantity: 1 })
  assert.equal(result.tileDays, 5)
})

test('economics distinguishes seed costs, future purchases, yields, and fixed quality', () => {
  const simulate = (crop: Crop) => simulateCrop(calendar, crop, { start: 0, end: 4, replant: true })
  const input = { inventory: { 'bean-seed': 1 }, start: 0, budget: 4, quality: 'fine' }
  const result = calculateEconomics(calendar, [{ crop: bean, quantity: 2, ...simulate(bean) }], input)
  assert.deepEqual(
    [result.initial, result.future, result.harvests, result.production, result.gross, result.net],
    [4, 8, 2, 12, 84, 72],
  )
  assert.deepEqual([result.perTile, result.perTileDay, result.perSeed], [36, 7.2, 18])
  assert.equal(result.affordable, true)
  assert.equal(result.remainingBudget, 0)
  assert.deepEqual(result.seeds[0], {
    itemId: bean.seedId,
    required: 4,
    owned: 1,
    purchased: 3,
    cost: 12,
    future: 8,
    unavailable: 0,
  })
  const recurring = calculateEconomics(calendar, [{ crop: berry, quantity: 2, ...simulate(berry) }], input)
  assert.deepEqual([recurring.initial, recurring.future, recurring.gross], [4, 0, 84])
  const modified = { ...bean, modifiers: [{ id: 'compost', name: 'Compost', cost: 2, daysSaved: 1 }] }
  const growth = simulateCrop(calendar, modified, { start: 0, end: 1, replant: false, modifier: 'compost' })
  const withExpense = calculateEconomics(calendar, [{ crop: modified, quantity: 1, ...growth }], {
    ...input,
    modifier: 'compost',
  })
  assert.deepEqual([growth.events.at(-1)?.day, withExpense.initial, withExpense.expenses], [1, 2, 2])
})

test('optimizer enforces budgets, locked seed sales, and shared stock across crops', () => {
  const locked = { ...berry, rank: 'expert' }
  const planner = cropPlanner(
    calendar,
    [bean, locked],
    { ...settings, tiles: 3, budget: 4 },
    { [bean.seedId]: 1 },
  )
  const plan = planner.plan([
    { cropId: locked.id, quantity: 3 },
    { cropId: bean.id, quantity: 3 },
  ])
  assert.deepEqual(plan.allocations, [
    { cropId: locked.id, quantity: 1 },
    { cropId: bean.id, quantity: 1 },
  ])
  assert.equal(plan.seeds[0].owned, 1)
  assert.equal(plan.seeds[0].purchased, 1)
  assert.equal(plan.tiles, 2)
  assert.equal(plan.initial, 4)
  assert.deepEqual(cropPlanner(calendar, [locked], settings, {}).plan().allocations, [])
  assert.equal(cropPlanner(calendar, [locked], { ...settings, unlocked: [locked.id] }, {}).plan().tiles, 2)
  assert.equal(cropPlanner(calendar, [bean], { ...settings, tiles: 1 }, {}).plan().tiles, 1)
  const seasonalSale = { ...bean, saleSeasons: ['rain'] }
  const offSale = { ...settings, date: { ...settings.date, season: 'sun' } }
  assert.equal(cropPlanner(calendar, [seasonalSale], offSale, {}).plan().tiles, 0)
  assert.equal(cropPlanner(calendar, [seasonalSale], offSale, { [bean.seedId]: 2 }).plan().tiles, 2)
})

test('recommendations use profitable owned seeds without expanding into loss-making purchases', () => {
  const costly = { ...bean, seedCost: 20 }
  const planner = cropPlanner(
    calendar,
    [costly],
    { ...settings, budget: 100, tiles: 10 },
    { [bean.seedId]: 2 },
  )
  assert.equal(planner.comparisons[0].quantity, 7)
  assert.equal(planner.plan().tiles, 2)
  assert.equal(planner.plan().net, 30)
  assert.equal(planner.plan([{ cropId: bean.id, quantity: 6 }]).tiles, 6)
})

test('farm adapter preserves equipment and avoids overlapping or fragmented footprints', () => {
  const farm = newPlan(4, 3, 'Fixture plot', game.game.id)
  farm.tiles[5] = '!orb'
  farm.tiles[6] = 'path'
  const eligible = farmCropArea(farm, { manualWater: true, protectedOnly: false })
  assert.equal(eligible.eligible, 10)
  assert.ok(farmCropArea(farm, { manualWater: false, protectedOnly: false }).eligible < 10)
  const broad = { ...berry, footprint: { width: 2, height: 2 } }
  const crops = new Map([
    [bean.id, bean],
    [broad.id, broad],
  ])
  const request = [{ cropId: broad.id, quantity: 1 }]
  assert.equal(placeCrops(farm, eligible.available, crops, request), undefined)
  farm.tiles[5] = 'crop'
  const updated = farmCropArea(farm, { manualWater: true, protectedOnly: false })
  const plots = placeCrops(farm, updated.available, crops, [...request, { cropId: bean.id, quantity: 7 }])!
  assert.equal(Object.values(plots).filter((id) => id === broad.id).length, 4)
  assert.equal(Object.keys(plots).length, 11)
  assert.equal(plots[plotKey(6, farm.width)], undefined)
  assert.equal(farm.tiles[6], 'path')
  assert.deepEqual(rectangle(farm, 1, 6), [1, 2, 5, 6])
  assert.deepEqual(resize({ ...farm, cropPlots: plots }, 5, 3).cropPlots, plots)
})

test('seed shopping and existing BOM share booked inventory without mutating it', () => {
  const stock = { [bean.seedId]: 1, ore: 3 }
  const plan = cropPlanner(calendar, [bean], settings, stock).plan()
  assert.equal(seedShopping(game, plan)[0].required, 3)
  const target = { itemId: bean.seedId, quantity: 3 }
  const synth = adaptGame(
    validatePackage({
      ...pack,
      recipes: [
        ...pack.recipes,
        {
          id: 'produce-bean-seed',
          output: { itemId: bean.seedId, quantity: 1 },
          ingredients: [{ itemId: 'ore', quantity: 1 }],
        },
      ],
    }),
  )
  assert.equal(seedShopping(synth, plan)[0].acquisition, 'Purchase · Production recipe available')
  const bill = seedProduction(synth, [target], stock)
  assert.equal(bill.operations, 2)
  assert.deepEqual(stock, { [bean.seedId]: 1, ore: 3 })
})

test('crop annotations, saved schedules and checklist survive backup restore and stay game-scoped', async () => {
  const db = await openDatabase(new IDBFactory())
  const otherDb = await openDatabase(new IDBFactory())
  const state = emptyState(game.game.id)
  const farm = state.workspace.current
  const projection = cropPlanner(calendar, [bean], settings, {}).plan()
  farm.cropPlots = { 0: bean.id }
  assert.deepEqual(deserialize(serialize(farm)).cropPlots, farm.cropPlots)
  const snapshot: CropPlan = {
    version: 1,
    name: 'Fixture plan',
    id: 'plan',
    gameId: game.game.id,
    settings,
    allocations: projection.allocations,
    plots: farm.cropPlots,
    schedule: projection.events,
    completed: [projection.events[0].key],
    pricing: {
      contentVersion: 'fixture',
      currency: 'marks',
      crops: [{ cropId: bean.id, seedCost: 4, salePrice: 5, includedExpense: 0 }],
    },
  }
  state.crops = [snapshot]
  await dbWrite(db, 'states', game.game.id, state)
  await dbWrite(db, 'games', game.game.id, pack)
  const second = adaptGame(validatePackage({ ...legacy, game: { ...legacy.game, id: 'other-game' } }))
  registerGame(second)
  assert.equal((await loadGameState(db, second.game.id)).state.crops, undefined)
  const backup = parseBackup(await exportBackup(db, game.game.id), new Map())
  await restoreBackup(otherDb, backup)
  assert.deepEqual((await loadGameState(otherDb, game.game.id)).state.crops, [snapshot])
  assert.deepEqual(await dbGet(otherDb, 'states', game.game.id), state)
  const invalid = structuredClone(state)
  invalid.crops![0].schedule[0].day = 5000
  await dbWrite(db, 'states', game.game.id, invalid)
  const invalidFile = await exportBackup(db, game.game.id)
  assert.throws(() => parseBackup(invalidFile, new Map()), /outside the planning window/)
  db.close()
  otherDb.close()
})
