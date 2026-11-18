import type { CraftingCatalog, Inventory, Quantity, Recipe } from './crafting-types.ts'

export interface BomOptions {
  selections?: Readonly<Record<string, string>>
}
export interface BomRequest extends CraftingCatalog {
  targets: readonly Quantity[]
  inventory?: Readonly<Inventory>
  options?: BomOptions
}
export interface Requirement {
  id: string
  required: number
  owned: number
  remaining: number
}
export interface Material extends Requirement {
  recipe?: Recipe
  batches: number
  produced: number
  unknown: boolean
}

function add(total: number, quantity: number) {
  const result = total + quantity
  if (!Number.isSafeInteger(result))
    throw new Error('The crafting quantities exceed the supported calculation range.')
  return result
}

export function dependencyOrder(edges: ReadonlyMap<string, ReadonlySet<string>>) {
  const pending = new Map<string, number>()
  for (const [id, dependencies] of edges) {
    if (!pending.has(id)) pending.set(id, 0)
    for (const dep of dependencies) pending.set(dep, (pending.get(dep) ?? 0) + 1)
  }
  const order = [...pending].filter(([, count]) => count === 0).map(([id]) => id)
  for (let i = 0; i < order.length; i++)
    for (const dep of edges.get(order[i]) ?? []) {
      const count = pending.get(dep)! - 1
      pending.set(dep, count)
      if (count === 0) order.push(dep)
    }
  if (order.length !== pending.size)
    throw new Error(
      'recipes: circular recipe dependencies involving ' +
        [...pending]
          .filter(([, count]) => count > 0)
          .slice(0, 8)
          .map(([id]) => id)
          .join(', '),
    )
  return order
}

export function recipeAlternatives(recipes: readonly Recipe[]) {
  const groups = new Map<string, Recipe[]>()
  for (const recipe of recipes) {
    const options = groups.get(recipe.output.itemId) ?? []
    options.push(recipe)
    groups.set(recipe.output.itemId, options)
  }
  return groups
}

export function prepareBom({ items, recipes }: CraftingCatalog, { selections = {} }: BomOptions = {}) {
  const catalog = new Map(items.map((item) => [item.id, item]))
  if (catalog.size !== items.length) throw new Error('Duplicate crafting item ID.')
  const ids = new Set<string>()
  for (const recipe of recipes) {
    if (ids.has(recipe.id)) throw new Error('Duplicate recipe ID: ' + recipe.id)
    ids.add(recipe.id)
    for (const entry of [recipe.output, ...recipe.ingredients, ...(recipe.byproducts ?? [])]) {
      if (!catalog.has(entry.itemId)) throw new Error('Unknown recipe item: ' + entry.itemId)
      if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1) {
        throw new Error('Invalid recipe quantity in ' + recipe.id)
      }
    }
  }
  const chosen = new Map<string, Recipe>()
  const dependencies = new Map<string, Set<string>>()
  const warnings: string[] = []
  const alternatives = recipeAlternatives(recipes)
  for (const [id, options] of alternatives) {
    const selection = Object.hasOwn(selections, id) ? selections[id] : undefined
    const match = options.find((option) => option.id === selection)
    if (selection && !match)
      warnings.push('Selected recipe is unavailable for ' + catalog.get(id)!.name + '. Using the default.')
    const recipe = match ?? options[0]
    chosen.set(id, recipe)
    dependencies.set(id, new Set(recipe.ingredients.map((ingredient) => ingredient.itemId)))
  }
  const order = dependencyOrder(dependencies)
  const orderedItems = new Set(order)

  function calculate(targets: readonly Quantity[], owned: Readonly<Inventory> = {}) {
    const inventory = new Map(Object.entries(owned))
    for (const [id, count] of inventory) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid inventory quantity: ' + id)
    }
    const demand = new Map<string, number>()
    for (const { itemId, quantity } of targets) {
      if (!Number.isSafeInteger(quantity) || quantity < 0 || (quantity && !catalog.has(itemId))) {
        throw new Error('Invalid crafting target: ' + itemId)
      }
      if (quantity) demand.set(itemId, add(demand.get(itemId) ?? 0, quantity))
    }
    const requirements = new Map<string, number>()
    const roots: Requirement[] = []
    const materials: Material[] = []
    const ingredientIds = new Set<string>()
    const surplus = new Map<string, number>()
    const consumed = new Map<string, number>()
    const take = (id: string, count: number) => {
      const initial = inventory.get(id) ?? 0
      const used = Math.min(count, initial)
      if (used) {
        inventory.set(id, initial - used)
        consumed.set(id, add(consumed.get(id) ?? 0, used))
      }
      return used
    }

    // Reserve requested finished items before using remaining stock for ingredients.
    for (const [id, required] of demand) {
      const fromStock = take(id, required)
      const remaining = required - fromStock
      roots.push({ id, required, owned: fromStock, remaining })
      requirements.set(id, remaining)
    }

    // Consumers precede ingredients so shared demand is summed before rounding batches.
    for (const id of [...order, ...[...demand.keys()].filter((id) => !orderedItems.has(id))]) {
      const requested = requirements.get(id) ?? 0
      const rootOwned = demand.has(id) ? (consumed.get(id) ?? 0) : 0
      const required = add(requested, rootOwned)
      if (!required) continue
      const fromStock = take(id, requested)
      const remaining = requested - fromStock
      const recipe = chosen.get(id)
      const batches = recipe ? Math.ceil(remaining / recipe.output.quantity) : 0
      const produced = recipe ? add(0, batches * recipe.output.quantity) : 0
      const item = catalog.get(id)!
      const unknown =
        !recipe &&
        (Boolean(item.recipeNote) ||
          (item.category !== 'raw_resource' &&
            !item.purchasable &&
            !item.acquisition.some((method) => method !== 'crafting')))
      materials.push({
        id,
        required,
        owned: add(rootOwned, fromStock),
        remaining,
        recipe,
        batches,
        produced,
        unknown,
      })
      if (!recipe || !batches) continue
      if (produced > remaining) surplus.set(id, add(surplus.get(id) ?? 0, produced - remaining))
      for (const ingredient of recipe.ingredients) {
        ingredientIds.add(ingredient.itemId)
        requirements.set(
          ingredient.itemId,
          add(requirements.get(ingredient.itemId) ?? 0, ingredient.quantity * batches),
        )
      }
      for (const byproduct of recipe.byproducts ?? []) {
        surplus.set(byproduct.itemId, add(surplus.get(byproduct.itemId) ?? 0, byproduct.quantity * batches))
      }
    }

    const shopping = materials.filter((row) => !row.recipe)
    const steps = materials.filter((row) => row.batches > 0).reverse()
    const deficits = shopping.filter((row) => row.remaining > 0)
    const unresolved = deficits.filter((row) => row.unknown)
    return {
      roots,
      materials,
      shopping,
      steps,
      surplus,
      consumed,
      deficits,
      unresolved,
      selectedRecipes: new Map(chosen),
      rawMaterials: shopping.filter((row) => catalog.get(row.id)?.category === 'raw_resource'),
      intermediates: materials.filter((row) => row.recipe && ingredientIds.has(row.id)),
      warnings: [...warnings],
      operations: steps.reduce((sum, row) => add(sum, row.batches), 0),
      stations: [
        ...new Set(
          steps
            .map((row) => row.recipe?.stationId ?? catalog.get(row.id)?.stationId)
            .filter((id): id is string => Boolean(id)),
        ),
      ],
      feasible: deficits.length === 0,
    }
  }

  return { chosen, calculate }
}

export function calculateBom({ targets, inventory, items, recipes, options }: BomRequest) {
  return prepareBom({ items, recipes }, options).calculate(targets, inventory)
}
export type Bom = ReturnType<typeof calculateBom>
