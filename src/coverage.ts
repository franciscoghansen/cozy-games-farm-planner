import { gameFor } from './equipment.ts'
import { countEquipment, itemId, usable } from './model.ts'
import type { Shape } from './game.ts'
import type { Plan } from './model.ts'

export function visitCoverage(
  width: number,
  height: number,
  center: number,
  radius: number,
  visit: (index: number) => void,
  shape: Shape = 'square',
) {
  const cx = center % width
  const cy = Math.floor(center / width)
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) {
    const extent = shape === 'circle' ? Math.floor(Math.sqrt(radius ** 2 - (y - cy) ** 2)) : radius
    for (let x = Math.max(0, cx - extent); x <= Math.min(width - 1, cx + extent); x++) {
      const index = y * width + x
      if (index !== center) visit(index)
    }
  }
}

export function coverage(plan: Plan) {
  const water = new Uint16Array(plan.tiles.length)
  const guard = new Uint16Array(plan.tiles.length)
  const items = gameFor(plan.gameId).placedItems
  plan.tiles.forEach((tile, center) => {
    const item = items.get(itemId(tile) ?? '')
    if (!item) return
    const { kind, radius, shape } = item
    const counts = kind === 'water' ? water : guard
    visitCoverage(plan.width, plan.height, center, radius, (index) => counts[index]++, shape)
  })
  return { water, guard }
}

export function statistics(plan: Plan, { water, guard } = coverage(plan)) {
  const adapter = gameFor(plan.gameId)
  const required = adapter.game.requiredCoverage ?? ['water', 'guard']
  const needsWater = required.includes('water')
  const needsGuard = required.includes('guard')
  const stats = {
    total: plan.tiles.length,
    farmland: 0,
    crops: 0,
    watered: 0,
    protected: 0,
    full: 0,
    waterOnly: 0,
    guardOnly: 0,
    neither: 0,
    overlap: 0,
    wasted: 0,
    empty: 0,
  }
  plan.tiles.forEach((tile, i) => {
    const w = water[i]
    const g = guard[i]
    if (usable(tile)) stats.farmland++
    if (tile !== 'crop') {
      stats.wasted += w + g
      if (tile === 'empty') stats.empty++
      return
    }
    stats.crops++
    stats.watered += Number(w > 0)
    stats.protected += Number(g > 0)
    if ((!needsWater || w) && (!needsGuard || g)) stats.full++
    else if (w) stats.waterOnly++
    else if (g) stats.guardOnly++
    else stats.neither++
    stats.overlap += Math.max(0, w - 1) + Math.max(0, g - 1)
  })
  const used = countEquipment(plan)
  let sprinklers = 0,
    scarecrows = 0
  for (const item of adapter.placables) {
    if (item.kind === 'water') sprinklers += used[item.id]
    else scarecrows += used[item.id]
  }
  return {
    ...stats,
    used,
    sprinklers,
    scarecrows,
    efficiency: stats.farmland ? (100 * stats.full) / stats.farmland : 0,
    perSprinkler: sprinklers ? stats.full / sprinklers : 0,
    perEquipment: sprinklers + scarecrows ? stats.full / (sprinklers + scarecrows) : 0,
  }
}

export interface Overlays {
  combined: boolean
  water: boolean
  guard: boolean
  equipment: boolean
  coords: boolean
}
