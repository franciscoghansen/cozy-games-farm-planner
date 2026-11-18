import { calendarMath } from './calendar.ts'
import type { Calendar, Crop, GrowthEvent, ScheduleEvent } from './types.ts'

export interface Projection {
  crop: Crop
  quantity: number
  events: GrowthEvent[]
  tileDays: number
  canBuy?: boolean
}
export const isHarvest = (event: GrowthEvent) => event.activity === 'harvest' || event.activity === 'regrowth'
export const isPlanting = (event: GrowthEvent) => event.activity === 'plant' || event.activity === 'replant'
export const footprint = (crop: Crop) => crop.footprint.width * crop.footprint.height
export const priceFor = (crop: Crop, quality: string) => crop.prices?.[quality]

export function seedOnSale(calendar: Calendar, crop: Crop, day: number) {
  return (
    !calendar.hasSeasons ||
    (crop.saleSeasons ?? crop.seasons).includes(calendarMath(calendar).date(day).season)
  )
}

export function calculateEconomics(
  calendar: Calendar,
  rows: readonly Projection[],
  input: {
    inventory: Readonly<Record<string, number>>
    start: number
    budget: number
    quality: string
    modifier?: string
  },
) {
  const stock = { ...input.inventory }
  const seeds = new Map<
    string,
    {
      itemId: string
      required: number
      owned: number
      purchased: number
      cost: number
      future: number
      unavailable: number
    }
  >()
  let initial = 0,
    future = 0,
    expenses = 0,
    gross = 0,
    harvests = 0,
    production = 0,
    planted = 0
  let balance = input.budget,
    affordable = true,
    complete = true
  const entries = rows
    .flatMap(({ crop, events, quantity, canBuy: purchaseAllowed = true }) => {
      const modifierCost = crop.modifiers?.find((entry) => entry.id === input.modifier)?.cost ?? 0
      let plantedOn = -1
      return events.map((event) => {
        if (isPlanting(event)) plantedOn = event.day
        const phase = isHarvest(event) ? Number(event.day === plantedOn) * 2 : 1
        const canPurchase =
          isPlanting(event) &&
          crop.seedCost !== undefined &&
          purchaseAllowed &&
          seedOnSale(calendar, crop, event.day)
        return { crop, modifierCost, event, quantity: quantity * event.quantity, phase, canPurchase }
      })
    })
    .sort(
      (a, b) =>
        a.event.day - b.event.day ||
        a.phase - b.phase ||
        Number(a.canPurchase) - Number(b.canPurchase) ||
        a.crop.id.localeCompare(b.crop.id),
    )
  const reserved = new Map<string, number>()
  for (const { event, crop, quantity, canPurchase } of entries) {
    if (isPlanting(event) && !canPurchase)
      reserved.set(crop.seedId, (reserved.get(crop.seedId) ?? 0) + quantity)
  }
  const events: ScheduleEvent[] = []
  for (const { event, crop, quantity, modifierCost, canPurchase } of entries) {
    let revenue = 0
    if (isHarvest(event)) {
      const price = priceFor(crop, input.quality)
      if (price === undefined) complete = false
      else revenue = price * quantity
      gross += revenue
      balance += revenue
      harvests++
      production += quantity
    }
    if (isPlanting(event)) {
      planted += quantity
      const itemId = crop.seedId
      const seed = seeds.get(itemId) ?? {
        itemId,
        required: 0,
        owned: 0,
        purchased: 0,
        cost: 0,
        future: 0,
        unavailable: 0,
      }
      seeds.set(itemId, seed)
      const onHand = stock[itemId] ?? 0
      const neededLater = reserved.get(itemId) ?? 0
      const owned = Math.min(quantity, canPurchase ? Math.max(0, onHand - neededLater) : onHand)
      stock[itemId] = onHand - owned
      if (!canPurchase) reserved.set(itemId, neededLater - quantity)
      const missing = quantity - owned
      if (missing && !canPurchase) complete = false
      const cost = canPurchase ? missing * crop.seedCost! : 0
      const expense = modifierCost * quantity
      seed.required += quantity
      seed.owned += owned
      seed.purchased += canPurchase ? missing : 0
      seed.unavailable += canPurchase ? 0 : missing
      seed.cost += cost
      if (event.day === input.start) initial += cost + expense
      else {
        future += cost + expense
        seed.future += cost
      }
      expenses += expense
      balance -= cost + expense
      if (balance < 0) affordable = false
    }
    events.push({
      ...event,
      cropId: crop.id,
      quantity,
      revenue,
      key: [crop.id, event.day, event.activity].join(':'),
    })
  }
  const tiles = rows.reduce((sum, row) => sum + footprint(row.crop) * row.quantity, 0)
  const tileDays = rows.reduce((sum, row) => sum + footprint(row.crop) * row.quantity * row.tileDays, 0)
  const net = gross - initial - future
  return {
    complete,
    affordable,
    initial,
    future,
    expenses,
    gross,
    net,
    harvests,
    production,
    planted,
    tiles,
    tileDays,
    events,
    seeds: [...seeds.values()],
    remainingBudget: input.budget - initial,
    perTile: tiles ? net / tiles : 0,
    perTileDay: tileDays ? net / tileDays : 0,
    perSeed: planted ? net / planted : 0,
  }
}
