import { coverage } from '../coverage.ts'
import { boardLimit } from '../game.ts'
import type { Plan } from '../model.ts'
import type { Allocation, Crop, CropSettings, PlotAssignments } from './types.ts'

// Coordinate keys retain their meaning through farm resizes and intervening equipment edits.
export const plotKey = (index: number, width: number) =>
  (index % width) + Math.floor(index / width) * boardLimit
export function farmCropArea(plan: Plan, settings: Pick<CropSettings, 'manualWater' | 'protectedOnly'>) {
  const { water, guard } = coverage(plan)
  const available = new Uint8Array(plan.tiles.length)
  let plantable = 0,
    watered = 0,
    protectedTiles = 0,
    eligible = 0
  plan.tiles.forEach((tile, index) => {
    if (tile !== 'crop') return
    plantable++
    if (water[index]) watered++
    if (guard[index]) protectedTiles++
    if (
      (settings.protectedOnly && water[index] && guard[index]) ||
      (!settings.protectedOnly && (settings.manualWater || water[index]))
    ) {
      eligible++
      available[index] = 1
    }
  })
  return { available, eligible, plantable, watered, protectedTiles }
}

export function placeCrops(
  plan: Plan,
  available: Uint8Array,
  crops: ReadonlyMap<string, Crop>,
  allocations: Allocation[],
) {
  const occupied = available.slice()
  const plots: PlotAssignments = { ...plan.cropPlots }
  // Keep assignments outside the selected area and prioritize existing matching positions within it.
  const previous = plan.cropPlots
  const matches = new Map<string, number[]>()
  for (let i = 0; i < occupied.length; i++) {
    if (!occupied[i]) continue
    const key = plotKey(i, plan.width)
    const id = previous?.[key]
    if (id) {
      const positions = matches.get(id) ?? []
      positions.push(i)
      matches.set(id, positions)
    }
    delete plots[key]
  }
  const sorted = allocations
    .map((row) => ({ ...row, crop: crops.get(row.cropId)! }))
    .sort(
      (a, b) =>
        b.crop.footprint.width * b.crop.footprint.height - a.crop.footprint.width * a.crop.footprint.height,
    )
  let freeCursor = 0
  for (const { cropId, quantity, crop } of sorted) {
    const { width, height } = crop.footprint
    let count = 0
    function place(start: number) {
      const x = start % plan.width,
        y = Math.floor(start / plan.width)
      if (x + width > plan.width || y + height > plan.height) return
      for (let dy = 0; dy < height; dy++)
        for (let dx = 0; dx < width; dx++) {
          if (!occupied[start + dy * plan.width + dx]) return
        }
      for (let dy = 0; dy < height; dy++)
        for (let dx = 0; dx < width; dx++) {
          const index = start + dy * plan.width + dx
          occupied[index] = 0
          plots[plotKey(index, plan.width)] = cropId
        }
      count++
    }
    for (const start of matches.get(cropId) ?? []) {
      if (count === quantity) break
      place(start)
    }
    for (
      let start = width * height === 1 ? freeCursor : 0;
      start < occupied.length && count < quantity;
      start++
    ) {
      place(start)
      if (width * height === 1) freeCursor = start + 1
    }
    if (count < quantity) return undefined
  }
  return plots
}

export function rectangle(plan: Plan, start: number, end: number) {
  const left = Math.min(start % plan.width, end % plan.width)
  const right = Math.max(start % plan.width, end % plan.width)
  const top = Math.min(Math.floor(start / plan.width), Math.floor(end / plan.width))
  const bottom = Math.max(Math.floor(start / plan.width), Math.floor(end / plan.width))
  const indices: number[] = []
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) indices.push(y * plan.width + x)
  return indices
}
