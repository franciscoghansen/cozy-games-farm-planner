import { gameFor } from './equipment.ts'
import { boardLimit, terrain } from './game.ts'
import type { Inventory } from './game.ts'
export type { Inventory } from './game.ts'

export type Terrain = typeof terrain[number]
export type Tile = string
export type Strategy = 'maximum' | 'low' | 'balanced' | 'rework' | 'cost' | 'materials'

export interface Plan {
  gameId: string
  name: string
  width: number
  height: number
  tiles: Tile[]
  progression: string
  unlocked: string[]
  limited: boolean
  inventory: Inventory
  strategy: Strategy
  target: number
}

export const maxSize = boardLimit
export const sizeOf = (value: number, fallback: number) => Number.isFinite(value)
  ? Math.min(maxSize, Math.max(1, Math.trunc(value))) : fallback

export const itemId = (tile: Tile) => typeof tile !== 'string' || (terrain as readonly string[]).includes(tile)
  ? undefined : tile.replace(/^!/, '')
export const usable = (tile: Tile) => tile === 'empty' || tile === 'crop'

export function newPlan(width: number, height: number, name = 'My farm', gameId?: string): Plan {
  const { game, placables } = gameFor(gameId)
  const first = game.progressions[0]
  return {
    gameId: game.id, name, width, height, tiles: Array<Tile>(width * height).fill('crop'),
    progression: first?.id ?? 'custom', unlocked: [...(first?.equipment ?? placables.map(item => item.id))],
    limited: false, inventory: Object.fromEntries(placables.map(item => [item.id, game.defaultInventory?.[item.id] ?? 0])),
    strategy: 'maximum', target: 100,
  }
}

export function unlockedItems(plan: Plan) {
  const { game, placables } = gameFor(plan.gameId)
  const unlocked = plan.progression === 'custom' ? plan.unlocked
    : game.progressions.find(level => level.id === plan.progression)?.equipment ?? []
  return placables.filter(item => unlocked.includes(item.id))
}

export function resize(plan: Plan, width: number, height: number) {
  const tiles = Array.from({ length: width * height }, (_, index): Tile => {
    const x = index % width
    const y = Math.floor(index / width)
    return x < plan.width && y < plan.height ? plan.tiles[y * plan.width + x] : 'crop'
  })
  return { ...plan, width, height, tiles }
}

export function countEquipment(plan: Plan): Inventory {
  const used: Inventory = Object.fromEntries(gameFor(plan.gameId).placables.map(item => [item.id, 0]))
  for (const tile of plan.tiles) {
    const id = itemId(tile)
    if (id && Object.hasOwn(used, id)) used[id]++
  }
  return used
}
