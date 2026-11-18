import { gameFor, getLayoutV1Game } from './equipment.ts'
import { quantityLimit } from './game.ts'
import type { Game } from './game.ts'
import { maxSize } from './model.ts'
import type { Plan } from './model.ts'

// Preserve the original storage key so the first IndexedDB run can still migrate old workspaces.
const key = 'coral-island-farm-planner/v1'
const integer = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

export function validatePlots(value: unknown, game: Game, repair = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid crop plot assignments.')
  const known = new Set(game.crops?.crops.map((crop) => crop.id))
  return Object.fromEntries(
    Object.entries(value).filter(([key, id]) => {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= maxSize ** 2 || typeof id !== 'string') {
        throw new Error('Invalid crop plot coordinates or crop ID.')
      }
      if (known.has(id)) return true
      if (repair) return false
      throw new Error('Unknown crop in plot assignments: ' + id)
    }),
  ) as Record<string, string>
}

export function validatePlan(value: unknown, fallbackGame?: string, adapter?: Game): Plan {
  if (typeof value !== 'object' || !value) throw new Error('Expected a farm plan object.')
  const p = value as Record<string, unknown>
  if (p.gameId !== undefined && typeof p.gameId !== 'string') throw new Error('Invalid game ID.')
  const requestedGame = p.gameId ?? fallbackGame
  const game = adapter ?? gameFor(requestedGame)
  const gameId = game.game.id
  if ((requestedGame && gameId !== requestedGame) || (fallbackGame && gameId !== fallbackGame)) {
    throw new Error(
      'This layout belongs to ' + (p.gameId ?? game.game.name) + '. Switch games before importing it.',
    )
  }
  const isItem = (id: string) => game.placedItems.has(id)
  if (
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    p.name.length > 100 ||
    !integer(p.width, 1, maxSize) ||
    !integer(p.height, 1, maxSize)
  ) {
    throw new Error('Invalid farm name or dimensions.')
  }
  if (
    !Array.isArray(p.tiles) ||
    p.tiles.length !== Number(p.width) * Number(p.height) ||
    p.tiles.includes(undefined) ||
    !p.tiles.every(
      (tile) =>
        typeof tile === 'string' &&
        (['crop', 'empty', 'rock', 'path'].includes(tile) ||
          isItem(tile.startsWith('!') ? tile.slice(1) : tile)),
    )
  ) {
    throw new Error('Invalid farm tiles.')
  }
  const inventory = asRecord(p.inventory)
  if (
    !(p.progression === 'custom' || game.game.progressions.some((level) => level.id === p.progression)) ||
    !Array.isArray(p.unlocked) ||
    !p.unlocked.every((id) => typeof id === 'string' && isItem(id)) ||
    typeof p.limited !== 'boolean' ||
    !inventory ||
    Array.isArray(p.inventory) ||
    !Object.entries(inventory).every(([id, count]) => isItem(id) && integer(count, 0, quantityLimit)) ||
    !['maximum', 'low', 'balanced', 'rework', 'cost', 'materials'].includes(String(p.strategy)) ||
    !integer(p.target, 0, maxSize ** 2)
  ) {
    throw new Error('Invalid equipment inventory or optimizer settings.')
  }
  const cropPlots = p.cropPlots === undefined ? undefined : validatePlots(p.cropPlots, game)
  return {
    ...(cropPlots && { cropPlots }),
    gameId,
    name: p.name,
    width: p.width,
    height: p.height,
    tiles: p.tiles,
    progression: p.progression,
    unlocked: p.unlocked,
    limited: p.limited,
    inventory: Object.fromEntries(game.placables.map((item) => [item.id, inventory[item.id] ?? 0])),
    strategy: p.strategy,
    target: p.target,
  } as Plan
}

interface Saved {
  id: string
  plan: Plan
}
export interface Workspace {
  current: Plan
  active: string | null
  saved: Saved[]
}
export const serialize = (plan: Plan) => JSON.stringify({ version: 2, plan }, null, 2)

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

export function deserialize(text: string, gameId?: string) {
  const value = asRecord(JSON.parse(text))
  if (value?.version !== 1 && value?.version !== 2) throw new Error('Unsupported plan format.')
  const plan = asRecord(value.plan)
  if (value.version === 1 && !plan?.gameId) {
    const legacy = getLayoutV1Game()
    if (gameId && gameId !== legacy)
      throw new Error('Switch to the original game to import this legacy layout.')
    return validatePlan(value.plan, legacy)
  }
  if (!plan?.gameId) throw new Error('Layout is missing its game ID.')
  return validatePlan(value.plan, gameId)
}

export function loadWorkspace(storage: Pick<Storage, 'getItem'>, fallback: Plan): Workspace {
  try {
    const data = asRecord(JSON.parse(storage.getItem(key) || 'null'))
    if (!data) return { current: fallback, active: null, saved: [] }
    const saved: Saved[] = []
    if (Array.isArray(data.saved)) {
      for (const value of data.saved as readonly unknown[]) {
        const entry = asRecord(value)
        try {
          if (typeof entry?.id === 'string')
            saved.push({ id: entry.id, plan: validatePlan(entry.plan, fallback.gameId) })
        } catch {
          /* Preserve other plans if one entry is invalid. */
        }
      }
    }
    let current = fallback
    try {
      current = validatePlan(data.current, fallback.gameId)
    } catch {
      /* Open the default farm. */
    }
    const active = saved.find((entry) => entry.id === data.active)?.id ?? null
    return { current, active, saved }
  } catch {
    return { current: fallback, active: null, saved: [] }
  }
}

export function saveWorkspace(storage: Pick<Storage, 'setItem'>, workspace: Workspace) {
  storage.setItem(key, JSON.stringify(workspace))
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
