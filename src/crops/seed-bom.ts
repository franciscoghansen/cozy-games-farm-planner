import { calculateBom } from '../bom.ts'
import type { Game, Inventory } from '../game.ts'
import type { calculateEconomics } from './economics.ts'

export function seedShopping(game: Game, result: ReturnType<typeof calculateEconomics>) {
  return result.seeds.map((seed) => {
    const hasRecipe = (game.recipeOptions.get(seed.itemId)?.length ?? 0) > 0
    return {
      ...seed,
      name: game.catalog.get(seed.itemId)?.name ?? seed.itemId,
      acquisition:
        [
          seed.purchased && 'Purchase',
          seed.unavailable && !hasRecipe && 'Acquisition unknown or seed unavailable',
          hasRecipe && seed.required > seed.owned && 'Production recipe available',
        ]
          .filter(Boolean)
          .join(' · ') || 'From inventory',
    }
  })
}

export function seedProduction(
  game: Game,
  requirements: { itemId: string; quantity: number }[],
  inventory: Inventory,
) {
  return calculateBom({ ...game, targets: requirements, inventory })
}
