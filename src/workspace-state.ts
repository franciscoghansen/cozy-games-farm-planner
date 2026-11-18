import { boardLimit } from './game.ts'
import type { Game } from './game.ts'
import { quantityLimit } from './crafting-types.ts'
import { defaultBomSettings } from './farm-bom.ts'
import { itemId } from './model.ts'
import { validatePlan, validatePlots } from './storage.ts'
import { harvestActivities, strategies } from './crops/types.ts'
import type { CropPlan } from './crops/types.ts'
import { calendarMath, planningWindow } from './crops/calendar.ts'
import type { GameState } from './workspace-db.ts'

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ' + label + '.')
  return value as Record<string, unknown>
}
export function list(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error('Invalid ' + label + '.')
  if (value.length > 2_000) throw new Error('Too many entries in ' + label + '.')
  return value as unknown[]
}
export function text(value: unknown, label: string, empty = false) {
  if (typeof value !== 'string' || value.length > 1000 || (!empty && !value.trim())) throw new Error('Invalid ' + label + '.')
  return value
}
function integer(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > quantityLimit) {
    throw new Error('Invalid ' + label + '.')
  }
  return value
}
function bool(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error('Invalid ' + label + '.')
  return value
}
function oneOf<T extends string>(value: unknown, options: readonly T[], label: string) {
  if (!options.includes(value as T)) throw new Error('Invalid ' + label + '.')
  return value as T
}
export function unique<T>(rows: T[], key: (row: T) => string, label: string) {
  if (new Set(rows.map(key)).size !== rows.length) throw new Error('Duplicate ' + label + '.')
  return rows
}
function entries<T>(value: unknown, label: string, convert: (value: unknown, label: string) => T) {
  const pairs = Object.entries(record(value, label))
  if (pairs.length > 2_000) throw new Error('Too many entries in ' + label + '.')
  return Object.fromEntries(pairs.map(([key, value]) => [key, convert(value, label + ' ' + key)]))
}

export function validateState(value: unknown, game: Game, repair = false): GameState {
  const known = (id: string, label: string) => {
    if (game.catalog.has(id)) return true
    if (repair) return false
    throw new Error('Unknown item in ' + label + ': ' + id + '.')
  }
  const selections = (value: unknown) => Object.fromEntries(Object.entries(entries(value, 'recipe choices', text))
    .filter(([id, recipe]) => {
      if (known(id, 'recipe choices') && game.recipes.some(entry => entry.output.itemId === id && entry.id === recipe)) return true
      if (repair) return false
      throw new Error('Unknown recipe choice for ' + id + ': ' + recipe + '.')
    }))
  const state = record(value, 'game workspace')
  const farm = record(state.workspace, 'farm workspace')
  const plan = (value: unknown) => {
    if (!repair) return validatePlan(value, game.game.id, game)
    const entry = record(value, 'farm plan')
    return validatePlan({ ...entry,
      ...(entry.cropPlots !== undefined && { cropPlots: validatePlots(entry.cropPlots, game, true) }),
      progression: game.game.progressions.some(level => level.id === entry.progression) ? entry.progression : 'custom',
      tiles: Array.isArray(entry.tiles) && entry.tiles.length <= boardLimit ** 2
        ? entry.tiles.map(tile => typeof tile === 'string' && itemId(tile) !== undefined && !game.placedItems.has(itemId(tile)!) ? 'crop' : tile)
        : entry.tiles,
      unlocked: list(entry.unlocked, 'unlocked equipment').filter(id => typeof id === 'string' && game.placedItems.has(id)),
      inventory: Object.fromEntries(Object.entries(record(entry.inventory, 'inventory')).filter(([id]) => game.placedItems.has(id))),
    }, game.game.id, game)
  }
  const saved = unique(list(farm.saved, 'saved layouts').map(value => {
    const entry = record(value, 'saved layout')
    return { id: text(entry.id, 'saved layout ID'), plan: plan(entry.plan) }
  }), entry => entry.id, 'saved layout ID')
  const settings = (value: unknown) => {
    const bom = record(value, 'BOM settings')
    const targetId = text(bom.targetId, 'BOM target ID', true)
    return {
      mode: oneOf(bom.mode, ['scratch', 'inventory', 'upgrade', 'custom'] as const, 'BOM mode'),
      base: oneOf(bom.base, ['previous', 'saved', 'snapshot'] as const, 'BOM baseline type'),
      baseId: text(bom.baseId, 'baseline ID', true),
      targetId: !targetId || known(targetId, 'BOM target') ? targetId : '',
      quantity: integer(bom.quantity, 'BOM target quantity'),
      selections: selections(bom.selections),
      ...(bom.snapshot !== undefined ? { snapshot: plan(bom.snapshot) } : {}),
    }
  }
  const configurations = state.configurations === undefined ? undefined
    : unique(list(state.configurations, 'BOM configurations').map(value => {
      const entry = record(value, 'BOM configuration')
      return { id: text(entry.id, 'BOM configuration ID'), name: text(entry.name, 'BOM name'), settings: settings(entry.settings) }
    }), entry => entry.id, 'BOM configuration ID')
  const draft = (value: unknown) => {
    const entry = record(value, 'crafting draft')
    return {
      targets: unique(list(entry.targets, 'crafting targets').map(value => {
        const target = record(value, 'crafting target')
        return { itemId: text(target.itemId, 'crafting item ID'), quantity: integer(target.quantity, 'crafting quantity') }
      }), entry => entry.itemId, 'crafting target').filter(target => known(target.itemId, 'crafting targets')),
      useInventory: bool(entry.useInventory, 'inventory setting'),
      selections: selections(entry.selections),
    }
  }
  let crafting: GameState['crafting']
  if (state.crafting !== undefined) {
    const entry = record(state.crafting, 'crafting workspace')
    const saved = unique(list(entry.saved, 'saved crafting plans').map(value => {
      const plan = record(value, 'saved crafting plan')
      return { id: text(plan.id, 'crafting plan ID'), name: text(plan.name, 'crafting plan name'), draft: draft(plan.draft) }
    }), plan => plan.id, 'crafting plan ID')
    const active = text(entry.active, 'active crafting plan', true)
    crafting = { draft: draft(entry.draft), saved, active: saved.some(plan => plan.id === active) ? active : '' }
  }
  let preferences: GameState['preferences']
  if (state.preferences !== undefined) {
    const entry = record(state.preferences, 'preferences')
    const overlays = record(entry.overlays, 'coverage overlays')
    preferences = { manualLock: bool(entry.manualLock, 'manual lock preference'), overlays: {
      combined: bool(overlays.combined, 'combined overlay'), water: bool(overlays.water, 'water overlay'),
      guard: bool(overlays.guard, 'protection overlay'), equipment: bool(overlays.equipment, 'equipment overlay'),
      coords: bool(overlays.coords, 'coordinate overlay'),
    } }
  }
  const crops = state.crops === undefined ? undefined : unique(list(state.crops, 'saved crop plans').map(value =>
    validateCropPlan(value, game, repair)), plan => plan.id, 'crop plan ID')
  return {
    ...(crops && { crops }),
    workspace: { current: plan(farm.current), saved, active: saved.find(entry => entry.id === farm.active)?.id ?? null },
    materials: Object.fromEntries(Object.entries(entries(repair ? state.materials ?? {} : state.materials,
      'materials inventory', integer)).filter(([id]) => known(id, 'materials inventory'))),
    bom: settings(repair ? state.bom ?? defaultBomSettings : state.bom),
    ...((configurations || repair) && { configurations: configurations ?? [] }), ...(crafting && { crafting }), ...(preferences && { preferences }),
  }
}

export function validateCropPlan(value: unknown, game: Game, repair = false): CropPlan {
  const entry = record(value, 'crop plan')
  if (entry.version !== 1 || entry.gameId !== game.game.id) {
    throw new Error('Unsupported crop plan format or game. Select the game the plan belongs to.')
  }
  const calendar = game.seasons
  const known = new Set(game.crops?.crops.map(crop => crop.id))
  const settings = record(entry.settings, 'crop planner settings')
  const date = record(settings.date, 'planting date')
  const rank = text(settings.rank, 'town rank', true)
  const quality = text(settings.quality, 'selling quality')
  const modifier = text(settings.modifier, 'growth modifier', true)
  const validDate = {
    year: integer(date.year, 'year'), season: text(date.season, 'season'), day: integer(date.day, 'day'),
  }
  if (calendar) {
    calendarMath(calendar).ordinal(validDate)
    if (calendar.ranks.length && !calendar.ranks.some(entry => entry.id === rank)) throw new Error('Unknown rank in crop plan.')
    if (!calendar.qualities.some(entry => entry.id === quality)) throw new Error('Unknown quality in crop plan.')
  } else if (!repair) throw new Error('This game has no installed crop calendar.')
  function keep(cropId: string) {
    if (known.has(cropId)) return true
    if (repair) return false
    throw new Error('Unknown crop in crop plan: ' + cropId)
  }
  const allocations = unique(list(entry.allocations, 'crop allocations').map(value => {
    const row = record(value, 'crop allocation')
    const quantity = integer(row.quantity, 'plant count')
    if (quantity > boardLimit ** 2) throw new Error('Crop allocation exceeds the maximum board size.')
    return { cropId: text(row.cropId, 'crop ID'), quantity }
  }), row => row.cropId, 'crop allocation').filter(row => keep(row.cropId))
  const tiles = integer(settings.tiles, 'crop tiles'), seasons = integer(settings.seasons, 'season count')
  const horizon = oneOf(settings.horizon, ['remaining', 'full', 'multiple'], 'planning horizon')
  if (tiles > boardLimit ** 2 || seasons < 1 || seasons > 8 || validDate.year < 1 || validDate.year > 9999) {
    throw new Error('Crop plan exceeds the supported range.')
  }
  const window = calendar && planningWindow(calendar, { date: validDate, seasons, horizon })
  const rawSchedule = entry.schedule
  if (!Array.isArray(rawSchedule) || rawSchedule.length > 100_000) throw new Error('Invalid crop schedule.')
  const schedule = unique(rawSchedule.map(value => {
    const row = record(value, 'crop event')
    const day = integer(row.day, 'event day')
    if (window && (day < window.start || day > window.end)) throw new Error('Crop event is outside the planning window.')
    const cropId = text(row.cropId, 'event crop')
    const activity = oneOf(row.activity, harvestActivities, 'crop activity')
    const revenue = row.revenue
    if (typeof revenue !== 'number' || !Number.isSafeInteger(revenue) || revenue < 0) throw new Error('Invalid crop event revenue.')
    return { day, cropId, activity, revenue, quantity: integer(row.quantity, 'event quantity'),
      key: [cropId, day, activity].join(':') }
  }), row => row.key, 'scheduled crop event').filter(row => keep(row.cropId)).sort((a, b) => a.day - b.day)
  const keys = new Set(schedule.map(event => event.key))
  const rawCompleted = entry.completed
  if (!Array.isArray(rawCompleted) || rawCompleted.length > 100_000) throw new Error('Invalid crop completion checklist.')
  const completed = [...new Set(rawCompleted.map(value => text(value, 'event key')).filter(key => keys.has(key)))]
  const rawPricing = entry.pricing === undefined ? undefined : record(entry.pricing, 'crop pricing snapshot')
  const pricing = rawPricing && {
    contentVersion: text(rawPricing.contentVersion, 'crop catalog version'),
    currency: text(rawPricing.currency, 'saved currency'),
    crops: unique(list(rawPricing.crops, 'saved crop prices').map(value => {
      const row = record(value, 'crop prices')
      return {
        cropId: text(row.cropId, 'price crop ID'), seedCost: integer(row.seedCost, 'seed cost'),
        salePrice: integer(row.salePrice, 'sale price'), includedExpense: integer(row.includedExpense, 'included expense'),
      }
    }), row => row.cropId, 'crop price').filter(row => keep(row.cropId)),
  }
  return {
    ...(pricing && { pricing }),
    version: 1, gameId: game.game.id, id: text(entry.id, 'crop plan ID'), name: text(entry.name, 'crop plan name'),
    allocations, plots: validatePlots(entry.plots, game, repair), schedule, completed,
    settings: {
      date: validDate, horizon,
      seasons, tiles, rank, quality, modifier, budget: integer(settings.budget, 'starting budget'),
      farm: bool(settings.farm, 'farm availability'), manualWater: bool(settings.manualWater, 'manual watering'),
      protectedOnly: bool(settings.protectedOnly, 'protection filter'), replant: bool(settings.replant, 'replanting'),
      strategy: oneOf(settings.strategy, strategies, 'crop strategy'),
      unlocked: [...new Set(list(settings.unlocked, 'seed unlocks').map(value => text(value, 'seed unlock')).filter(keep))],
    },
  }
}
