import { adaptGame, validatePackage } from './game.ts'
import type { Game, GamePackage } from './game.ts'
import { quantityLimit } from './crafting-types.ts'
import { validatePlan } from './storage.ts'
import type { GameState } from './workspace-db.ts'
import { dbGet } from './workspace-db.ts'

const format = 'cozy-games-farm-planner'
const stores = ['states', 'games', 'settings']

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ' + label + '.')
  return value as Record<string, unknown>
}
function list(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error('Invalid ' + label + '.')
  return value as unknown[]
}
function text(value: unknown, label: string, empty = false) {
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
function unique<T>(rows: T[], key: (row: T) => string, label: string) {
  if (new Set(rows.map(key)).size !== rows.length) throw new Error('Duplicate ' + label + '.')
  return rows
}
function entries<T>(value: unknown, label: string, convert: (value: unknown, label: string) => T) {
  return Object.fromEntries(Object.entries(record(value, label)).map(([key, value]) => [key, convert(value, label + ' ' + key)]))
}

function validateState(value: unknown, game: Game): GameState {
  const state = record(value, 'game workspace')
  const farm = record(state.workspace, 'farm workspace')
  const plan = (value: unknown) => validatePlan(value, game.game.id, game)
  const saved = unique(list(farm.saved, 'saved layouts').map(value => {
    const entry = record(value, 'saved layout')
    return { id: text(entry.id, 'saved layout ID'), plan: plan(entry.plan) }
  }), entry => entry.id, 'saved layout ID')
  const settings = (value: unknown) => {
    const bom = record(value, 'BOM settings')
    return {
      mode: oneOf(bom.mode, ['scratch', 'inventory', 'upgrade', 'custom'] as const, 'BOM mode'),
      base: oneOf(bom.base, ['previous', 'saved', 'snapshot'] as const, 'BOM baseline type'),
      baseId: text(bom.baseId, 'baseline ID', true),
      targetId: text(bom.targetId, 'BOM target ID', true),
      quantity: integer(bom.quantity, 'BOM target quantity'),
      selections: entries(bom.selections, 'recipe choices', text),
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
      }), entry => entry.itemId, 'crafting target'),
      useInventory: bool(entry.useInventory, 'inventory setting'),
      selections: entries(entry.selections, 'recipe choices', text),
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
    materials: entries(state.materials, 'materials inventory', integer), bom: settings(state.bom),
    ...(configurations && { configurations }), ...(crafting && { crafting }), ...(preferences && { preferences }),
  }
}

export async function exportBackup(db: IDBDatabase, activeGame: string) {
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction(stores, 'readonly')
    const states = tx.objectStore('states').getAll()
    const games = tx.objectStore('games').getAll()
    tx.oncomplete = () => resolve(JSON.stringify({
      format, version: 1, activeGame, states: states.result, games: games.result,
    }, null, 2))
    tx.onabort = () => reject(tx.error)
  })
}

export function parseBackup(source: string, bundled: ReadonlyMap<string, GamePackage>) {
  const backup = record(JSON.parse(source), 'workspace backup')
  if (backup.format !== format || backup.version !== 1) throw new Error('Choose a supported Farm Planner backup file.')
  const games = unique(list(backup.games, 'custom games').map(validatePackage), pack => pack.game.id, 'game ID')
  const definitions = new Map(bundled)
  for (const pack of games) definitions.set(pack.game.id, pack)
  const activeGame = text(backup.activeGame, 'selected game ID')
  if (!definitions.has(activeGame)) throw new Error('The selected game is missing from this backup.')
  const states = unique(list(backup.states, 'game workspaces').map(value => {
    const state = record(value, 'game workspace')
    const plan = record(record(state.workspace, 'workspace').current, 'current layout')
    const id = text(plan.gameId, 'game ID')
    const pack = definitions.get(id)
    if (!pack) throw new Error('No definition is available for game ' + id + '.')
    return validateState(value, adaptGame(pack))
  }), state => state.workspace.current.gameId, 'game workspace')
  return { states, games, activeGame }
}

export async function restoreBackup(db: IDBDatabase, backup: ReturnType<typeof parseBackup>) {
  const restored = new Set(backup.states.map(state => state.workspace.current.gameId))
  const overrides = new Set(backup.games.map(pack => pack.game.id))
  for (const pack of backup.games) {
    if (restored.has(pack.game.id)) continue
    const existing = await dbGet<GameState>(db, 'states', pack.game.id)
    if (existing) validateState(existing, adaptGame(pack))
  }
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite')
    const games = tx.objectStore('games')
    const states = tx.objectStore('states')
    for (const state of backup.states) {
      const id = state.workspace.current.gameId
      states.put(state, id)
      if (!overrides.has(id)) games.delete(id)
    }
    for (const pack of backup.games) games.put(pack, pack.game.id)
    tx.objectStore('settings').put(backup.activeGame, 'selected')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
}
