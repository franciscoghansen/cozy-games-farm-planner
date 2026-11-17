import { gameFor } from './equipment.ts'
import { newPlan } from './model.ts'

export type PresetId = string

export function preset(id: PresetId, gameId?: string) {
  const game = gameFor(gameId)
  const entry = game.presets.find(entry => entry.id === id)
  if (!entry) throw new Error('Unknown preset: ' + id)
  const plan = newPlan(entry.width, entry.height, entry.name, game.game.id)
  if (entry.progression) {
    plan.progression = entry.progression
    plan.unlocked = [...game.game.progressions.find(level => level.id === entry.progression)!.equipment]
  }
  if (entry.fill) plan.tiles.fill(entry.fill)
  for (const { x, y, tile } of entry.placements) plan.tiles[y * entry.width + x] = tile
  return plan
}

export function defaultPlan(gameId?: string) {
  const adapter = gameFor(gameId)
  const id = adapter.game.defaultPreset
  return id ? preset(id, adapter.game.id) : newPlan(15, 15, undefined, adapter.game.id)
}
