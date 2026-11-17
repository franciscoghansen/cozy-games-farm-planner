export type Inventory = Record<string, number>
export const quantityLimit = 1_000_000_000
export const categories = ['raw_resource', 'refined_material', 'crafted_component', 'equipment', 'consumable', 'miscellaneous'] as const

export interface ItemDefinition {
  id: string; name: string; category: typeof categories[number]; acquisition: string[]
  description?: string; icon?: string | null; craftable?: boolean; purchasable?: boolean
  unlock?: string; stationId?: string; recipeNote?: string
}
export interface Quantity { itemId: string; quantity: number }
export interface Recipe {
  id: string; name?: string; output: Quantity; ingredients: Quantity[]
  stationId?: string; unlock?: string; alternativeIds?: string[]; byproducts?: Quantity[]
  seconds?: number; source?: string
}
export interface CraftingCatalog {
  items: readonly ItemDefinition[]
  recipes: readonly Recipe[]
}
