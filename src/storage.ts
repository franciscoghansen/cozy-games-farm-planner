import { gameFor, getLayoutV1Game, isItem } from './equipment.ts'
import { quantityLimit } from './game.ts'
import { maxSize } from './model.ts'
import type { Plan } from './model.ts'

const key = 'coral-island-farm-planner/v1'
const integer = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

export function validatePlan(value: unknown, fallbackGame?: string): Plan {
  if (typeof value !== 'object' || !value) throw new Error('Expected a farm plan object.')
  const p = value as Record<string, unknown>
  if (p.gameId !== undefined && typeof p.gameId !== 'string') throw new Error('Invalid game ID.')
  const game = gameFor((p.gameId as string | undefined) ?? fallbackGame)
  const gameId = game.game.id
  if (fallbackGame && gameId !== fallbackGame) throw new Error('This layout belongs to ' + game.game.name + '. Switch games before importing it.')
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 ||
    !integer(p.width, 1, maxSize) || !integer(p.height, 1, maxSize)) {
    throw new Error('Invalid farm name or dimensions.')
  }
  if (!Array.isArray(p.tiles) || p.tiles.length !== Number(p.width) * Number(p.height) ||
    !p.tiles.every(tile => typeof tile === 'string' &&
      (['crop', 'empty', 'rock', 'path'].includes(tile) || isItem(tile.startsWith('!') ? tile.slice(1) : tile, gameId)))) {
    throw new Error('Invalid farm tiles.')
  }
  if (!(p.progression === 'custom' || game.game.progressions.some(level => level.id === p.progression)) ||
    !Array.isArray(p.unlocked) || !p.unlocked.every(id => typeof id === 'string' && isItem(id, gameId)) ||
    typeof p.limited !== 'boolean' || !p.inventory || typeof p.inventory !== 'object' || Array.isArray(p.inventory) ||
    !Object.entries(p.inventory).every(([id, count]) => isItem(id, gameId) && integer(count, 0, quantityLimit)) ||
    !['maximum', 'low', 'balanced', 'rework', 'cost', 'materials'].includes(String(p.strategy)) ||
    !integer(p.target, 0, maxSize ** 2)) {
    throw new Error('Invalid equipment inventory or optimizer settings.')
  }
  return {
    gameId, name: p.name, width: p.width, height: p.height, tiles: p.tiles, progression: p.progression,
    unlocked: p.unlocked, limited: p.limited, inventory: Object.fromEntries(game.placables.map(item =>
      [item.id, (p.inventory as Record<string, unknown>)[item.id] ?? 0])), strategy: p.strategy, target: p.target,
  } as Plan
}

interface Saved { id: string; plan: Plan }
export interface Workspace { current: Plan; active: string | null; saved: Saved[] }
export const serialize = (plan: Plan) => JSON.stringify({ version: 2, plan }, null, 2)

export function deserialize(text: string, gameId?: string) {
  const value = JSON.parse(text)
  if (![1, 2].includes(value?.version)) throw new Error('Unsupported plan format.')
  if (value.version === 1 && !value.plan?.gameId) {
    const legacy = getLayoutV1Game()
    if (gameId && gameId !== legacy) throw new Error('Switch to the original game to import this legacy layout.')
    return validatePlan(value.plan, legacy)
  }
  if (!value.plan?.gameId) throw new Error('Layout is missing its game ID.')
  return validatePlan(value.plan, gameId)
}

export function loadWorkspace(storage: Pick<Storage, 'getItem'>, fallback: Plan): Workspace {
  try {
    const data = JSON.parse(storage.getItem(key) || 'null')
    if (!data) return { current: fallback, active: null, saved: [] }
    const saved: Saved[] = []
    if (Array.isArray(data.saved)) {
      for (const entry of data.saved) {
        try {
          if (typeof entry.id === 'string') saved.push({ id: entry.id, plan: validatePlan(entry.plan, fallback.gameId) })
        } catch { /* Preserve other plans if one entry is invalid. */ }
      }
    }
    let current = fallback
    try { current = validatePlan(data.current, fallback.gameId) } catch { /* Open the default farm. */ }
    return { current, active: saved.some(entry => entry.id === data.active) ? data.active : null, saved }
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
