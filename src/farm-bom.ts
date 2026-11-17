import { calculateBom, prepareBom } from './bom.ts'
import type { Bom } from './bom.ts'
import type { CraftingCatalog, Inventory, Quantity } from './crafting-types.ts'
import { countEquipment } from './model.ts'
import type { Plan } from './model.ts'

export type BomMode = 'scratch' | 'inventory' | 'upgrade' | 'custom'
export interface BomSettings {
  mode: BomMode
  base: 'previous' | 'saved' | 'snapshot'
  baseId: string
  snapshot?: Plan
  targetId: string
  quantity: number
  selections: Record<string, string>
}
export interface BomConfiguration { id: string; name: string; settings: BomSettings }
export const defaultBomSettings: BomSettings = {
  mode: 'scratch', base: 'snapshot', baseId: '', targetId: '', quantity: 1, selections: {},
}

function equipmentTargets(counts: Readonly<Inventory>, reuse: Readonly<Inventory> = {}) {
  return Object.entries(counts).filter(([, count]) => count > 0).map(([itemId, quantity]) => {
    const reusable = Math.min(quantity, reuse[itemId] ?? 0)
    return { itemId, required: quantity, reusable, quantity: quantity - reusable }
  })
}

export function farmLayoutToCraftingTargets(plan: Plan, base?: Plan): Quantity[] {
  return equipmentTargets(countEquipment(plan), base?.gameId === plan.gameId ? countEquipment(base) : {})
    .filter(({ quantity }) => quantity > 0).map(({ itemId, quantity }) => ({ itemId, quantity }))
}

function calculateEquipmentBom(calculate: ReturnType<typeof prepareBom>['calculate'],
  counts: Inventory, inventory?: Inventory, reuse?: Inventory) {
  const targets = equipmentTargets(counts, reuse)
  const computed = calculate(targets, inventory)
  const byId = new Map(computed.roots.map(row => [row.id, row]))
  return {
    ...computed,
    roots: targets.map(({ itemId, required, reusable }) => {
      const row = byId.get(itemId)
      return { id: itemId, required, reusable, owned: row?.owned ?? 0, remaining: row?.remaining ?? 0 }
    }),
  }
}
export type FarmBom = ReturnType<typeof calculateEquipmentBom>

export function layoutBom(catalog: CraftingCatalog, plan: Plan, inventory: Inventory, settings: BomSettings, base?: Plan): FarmBom {
  const options = { selections: settings.selections }
  if (settings.mode === 'custom') {
    const targets = settings.targetId ? [{ itemId: settings.targetId, quantity: settings.quantity }] : []
    const result = calculateBom({ ...catalog, targets, inventory, options })
    return { ...result, roots: result.roots.map(row => ({ ...row, reusable: 0 })) }
  }
  const planReuse = settings.mode === 'upgrade' && base?.gameId === plan.gameId ? countEquipment(base) : undefined
  return calculateEquipmentBom(prepareBom(catalog, options).calculate, countEquipment(plan),
    settings.mode === 'scratch' ? undefined : inventory, planReuse)
}

export function createFarmMaterialService(catalog: CraftingCatalog, original: Plan, inventory: Inventory,
  selections?: Record<string, string>) {
  const reuse = countEquipment(original)
  const { calculate } = prepareBom(catalog, { selections })
  return {
    cost: (counts: Inventory): Bom => calculate(equipmentTargets(counts)),
    fits: (counts: Inventory) => Object.entries(counts).every(([id, count]) => count <= (inventory[id] ?? 0) + (reuse[id] ?? 0))
      || calculateEquipmentBom(calculate, counts, inventory, reuse).feasible,
    proposal: (target: Plan) => calculateEquipmentBom(calculate, countEquipment(target), inventory,
      original.gameId === target.gameId ? reuse : undefined),
  }
}
