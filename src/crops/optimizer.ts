import { planningWindow } from './calendar.ts'
import { calculateEconomics, footprint, isHarvest, priceFor, seedOnSale } from './economics.ts'
import { simulateCrop } from './growth.ts'
import type { Projection } from './economics.ts'
import type { Allocation, Calendar, Crop, CropSettings } from './types.ts'

export function cropUnlocked(calendar: Calendar, crop: Crop, settings: CropSettings) {
  if (settings.unlocked.includes(crop.id)) return true
  const rank = (id: string) => calendar.ranks.findIndex((entry) => entry.id === id)
  return !crop.unlock && (!crop.rank || rank(settings.rank) >= rank(crop.rank))
}

export function cropPlanner(
  calendar: Calendar,
  crops: readonly Crop[],
  settings: CropSettings,
  inventory: Readonly<Record<string, number>>,
  fits?: (rows: Allocation[]) => boolean,
) {
  const window = planningWindow(calendar, settings)
  const input = { ...settings, start: window.start, inventory }
  const finance = (rows: Projection[]) => calculateEconomics(calendar, rows, input)
  const candidates = crops.map((crop) => {
    const unlocked = cropUnlocked(calendar, crop, settings)
    let owned = inventory[crop.seedId] ?? 0
    const growth = simulateCrop(calendar, crop, {
      ...window,
      replant: settings.replant && settings.strategy !== 'low-maintenance',
      modifier: settings.modifier,
      canPlant: (day) => {
        if (owned > 0) {
          owned--
          return true
        }
        return unlocked && seedOnSale(calendar, crop, day)
      },
    })
    const row = { crop, quantity: 1, canBuy: unlocked, ...growth }
    const first = growth.events.find(isHarvest)?.day
    const unit = finance([row])
    const eligible =
      crop.status === 'verified' &&
      crop.seedCost !== undefined &&
      priceFor(crop, settings.quality) !== undefined &&
      first !== undefined &&
      unit.complete
    const warnings = [...growth.warnings]
    // Owned seeds may be planted before the shop unlocks, within the owned quantity.
    if (!unlocked) warnings.push('Seeds are locked for purchase at the selected progression.')
    if (!seedOnSale(calendar, crop, window.start)) warnings.push('Seeds are off sale on the starting date.')
    if (
      crop.status === 'incomplete' ||
      crop.seedCost === undefined ||
      priceFor(crop, settings.quality) === undefined
    ) {
      warnings.push(crop.note ?? 'Seed or selected-quality pricing data is incomplete.')
    }
    if (first !== undefined && !unit.complete) warnings.push('Some scheduled seeds are unavailable.')
    return { row, crop, first, unit, eligible, unlocked, warnings }
  })
  const byId = new Map(candidates.map((candidate) => [candidate.crop.id, candidate]))
  type Candidate = (typeof candidates)[number]

  function capacity(candidate: Candidate, rows: Projection[], maximum: number, used: number) {
    const { row, crop, eligible } = candidate
    if (!eligible) return 0
    let high = Math.min(maximum, Math.floor((settings.tiles - used) / footprint(crop)))
    let low = 0
    while (low < high) {
      const quantity = Math.ceil((low + high) / 2)
      const next = [...rows, { ...row, quantity }]
      const result = finance(next)
      if (
        result.complete &&
        result.affordable &&
        (!fits || fits(next.map((entry) => ({ cropId: entry.crop.id, quantity: entry.quantity }))))
      )
        low = quantity
      else high = quantity - 1
    }
    return low
  }

  function profitableQuantity(row: Projection, rows: Projection[], maximum: number) {
    const net = (quantity: number) => finance(quantity ? [...rows, { ...row, quantity }] : rows).net
    let low = 0,
      high = maximum
    while (low < high) {
      const quantity = Math.ceil((low + high) / 2)
      if (net(quantity) > net(quantity - 1)) low = quantity
      else high = quantity - 1
    }
    return low
  }

  const comparisons = candidates.map((candidate) => {
    const quantity = capacity(candidate, [], settings.tiles, 0)
    const projectedQuantity = profitableQuantity(candidate.row, [], quantity)
    return {
      ...candidate,
      quantity,
      area: finance(quantity ? [{ ...candidate.row, quantity }] : []),
      recommendationNet: projectedQuantity
        ? finance([{ ...candidate.row, quantity: projectedQuantity }]).net
        : 0,
    }
  })
  function plan(requested?: Allocation[]) {
    const order = comparisons
      .filter((entry) => entry.eligible && entry.unit.net > 0)
      .sort((a, b) => {
        const score = (entry: typeof a) => {
          const { unit, first, recommendationNet } = entry
          switch (settings.strategy) {
            case 'low-budget':
              return unit.net / Math.max(1, unit.initial)
            case 'fast':
              return window.start - first!
            case 'low-maintenance':
              return unit.perTile / unit.planted
            case 'balanced':
              return unit.perTileDay / (Math.max(1, unit.initial) ** 0.5 * unit.planted ** 0.5)
            default:
              return recommendationNet
          }
        }
        return (
          score(b) - score(a) ||
          b.recommendationNet - a.recommendationNet ||
          a.crop.id.localeCompare(b.crop.id)
        )
      })
    const requests = requested ?? order.map(({ crop }) => ({ cropId: crop.id, quantity: settings.tiles }))
    const rows: Projection[] = []
    const reduced: Allocation[] = []
    let used = 0
    for (const allocation of requests) {
      const candidate = byId.get(allocation.cropId)
      if (!candidate || rows.some((row) => row.crop.id === allocation.cropId)) continue
      const maximum = capacity(candidate, rows, allocation.quantity, used)
      const quantity = requested ? maximum : profitableQuantity(candidate.row, rows, maximum)
      if (quantity) {
        rows.push({ ...candidate.row, quantity })
        used += quantity * footprint(candidate.crop)
      }
      if (requested && quantity < allocation.quantity)
        reduced.push({ ...allocation, quantity: allocation.quantity - quantity })
    }
    return {
      allocations: rows.map((row) => ({ cropId: row.crop.id, quantity: row.quantity })),
      reduced,
      ...finance(rows),
    }
  }
  return { window, comparisons, plan }
}
