import { boardLimit } from './game.ts'
import type { Game } from './game.ts'
import { quantityLimit } from './crafting-types.ts'
import { defaultBomSettings } from './farm-bom.ts'
import { itemId } from './model.ts'
import { validatePlan } from './storage.ts'
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
  return {
    workspace: { current: plan(farm.current), saved, active: saved.find(entry => entry.id === farm.active)?.id ?? null },
    materials: Object.fromEntries(Object.entries(entries(repair ? state.materials ?? {} : state.materials,
      'materials inventory', integer)).filter(([id]) => known(id, 'materials inventory'))),
    bom: settings(repair ? state.bom ?? defaultBomSettings : state.bom),
    ...((configurations || repair) && { configurations: configurations ?? [] }), ...(crafting && { crafting }), ...(preferences && { preferences }),
  }
}

