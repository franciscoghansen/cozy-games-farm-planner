import type { Quantity } from './crafting-types.ts'

export interface CraftingDraft {
  targets: Quantity[]
  useInventory: boolean
  selections: Record<string, string>
}

export interface SavedCraftingPlan {
  id: string
  name: string
  draft: CraftingDraft
}

export interface CraftingWorkspace {
  draft: CraftingDraft
  saved: SavedCraftingPlan[]
  active: string
}

export const emptyCrafting = (): CraftingWorkspace => ({
  draft: { targets: [], useInventory: true, selections: {} }, saved: [], active: '',
})
