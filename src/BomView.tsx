import { useState } from 'react'
import { Boxes, Check, ClipboardList, Hammer, Layers3, PackageSearch, TriangleAlert } from 'lucide-react'
import type { Bom, Material, Requirement } from './bom.ts'
import { quantityLimit } from './crafting-types.ts'
import type { Inventory, ItemDefinition, Recipe } from './crafting-types.ts'

export interface BomDisplayCatalog {
  items: readonly ItemDefinition[]
  catalog: ReadonlyMap<string, ItemDefinition>
  recipeOptions: ReadonlyMap<string, readonly Recipe[]>
  game: { stations: { id: string; name: string }[]; acquisitionMethods: Record<string, string> }
}

const number = (n: number) => n.toLocaleString()
const batchCount = (n: number) => number(n) + (n === 1 ? ' batch' : ' batches')
export const inputQuantity = (value: string) =>
  Math.min(quantityLimit, Math.max(0, Math.trunc(Number(value) || 0)))

export function CraftTree({
  id,
  count,
  game,
  recipes,
}: {
  id: string
  count: number
  game: BomDisplayCatalog
  recipes: ReadonlyMap<string, Recipe>
}) {
  const [open, setOpen] = useState(false)
  const recipe = recipes.get(id)
  const batches = recipe ? Math.ceil(count / recipe.output.quantity) : 0
  const name = game.catalog.get(id)?.name ?? id
  if (!recipe)
    return (
      <div className="tree-leaf">
        {name} × {number(count)}
      </div>
    )
  return (
    <details className="craft-node" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {name} × {number(count)}
      </summary>
      {open && (
        <div>
          <p>
            {batchCount(batches)} · {number(batches * recipe.output.quantity)} produced
            {recipe.stationId &&
              ' · ' + game.game.stations.find((station) => station.id === recipe.stationId)?.name}
          </p>
          {recipe.ingredients.map((entry, index) => (
            <CraftTree
              key={entry.itemId + index}
              id={entry.itemId}
              count={entry.quantity * batches}
              game={game}
              recipes={recipes}
            />
          ))}
        </div>
      )}
    </details>
  )
}

export function RecipeChoices({
  game,
  recipes,
  onSelect,
}: {
  game: BomDisplayCatalog
  recipes: ReadonlyMap<string, Recipe>
  onSelect: (id: string, recipe: string) => void
}) {
  const alternatives = [...game.recipeOptions].filter(([, list]) => list.length > 1)
  if (!alternatives.length) return null
  return (
    <details className="bom-disclosure">
      <summary>Recipe alternatives</summary>
      <div className="materials-settings">
        {alternatives.map(([id, options]) => (
          <label key={id} className="stack">
            {game.catalog.get(id)?.name ?? id}
            <select value={recipes.get(id)?.id} onChange={(event) => onSelect(id, event.target.value)}>
              {options.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name ?? recipe.id.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </details>
  )
}

export function OwnedStock({
  game,
  inventory,
  onInventory,
}: {
  game: BomDisplayCatalog
  inventory: Inventory
  onInventory: (id: string, quantity: number) => void
}) {
  const [filter, setFilter] = useState('')
  return (
    <details className="bom-disclosure">
      <summary>Owned stock</summary>
      <div className="materials-settings">
        <label className="stack">
          Search inventory
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </label>
        <div className="stock-list">
          {game.items
            .filter((item) => item.name.toLowerCase().includes(filter.trim().toLowerCase()))
            .map((item) => (
              <label key={item.id}>
                <span>{item.name}</span>
                <input
                  type="number"
                  min="0"
                  max={quantityLimit}
                  aria-label={item.name + ' owned stock'}
                  value={inventory[item.id] ?? 0}
                  onChange={(event) => onInventory(item.id, inputQuantity(event.target.value))}
                />
              </label>
            ))}
        </div>
      </div>
    </details>
  )
}

type DisplayBom = Omit<Bom, 'roots'> & { roots: (Requirement & { reusable?: number })[] }
export function BomView({
  game,
  bom,
  inventory,
  onInventory,
  useInventory,
  showPlan = false,
  label = 'Target items',
  requirementTitle = 'Crafting targets',
  emptyText = 'Add items to calculate materials.',
  showReuse = false,
  finalStep,
}: {
  game: BomDisplayCatalog
  bom: DisplayBom
  inventory: Inventory
  onInventory: (id: string, count: number) => void
  useInventory: boolean
  showPlan?: boolean
  label?: string
  requirementTitle?: string
  emptyText?: string
  showReuse?: boolean
  finalStep?: string
}) {
  const [missing, setMissing] = useState(false)
  const [detail, setDetail] = useState<'list' | 'tree' | 'checklist' | 'aggregate'>(
    showPlan ? 'checklist' : 'list',
  )
  const name = (id: string) => game.catalog.get(id)?.name ?? id
  const station = (id?: string) =>
    id ? game.game.stations.find((station) => station.id === id)?.name : undefined
  const quantity = (rows: { required: number }[]) => rows.reduce((sum, row) => sum + row.required, 0)
  const remaining = (rows: { remaining: number }[]) => rows.reduce((sum, row) => sum + row.remaining, 0)
  const [collection, setCollection] = useState<{ id: string; before: number; after: number }>()
  const resources = bom.shopping.filter((row) => game.catalog.get(row.id)?.category !== 'equipment')
  const pending = bom.unresolved
  const intermediates = new Set(bom.intermediates.map((row) => row.id))
  const grouped = new Map<string, Material[]>()
  for (const row of resources) {
    if (missing && !row.remaining) continue
    const item = game.catalog.get(row.id)
    const methodId = item?.acquisition.find((method) => method !== 'crafting')
    const method = row.unknown
      ? 'Other / Unknown'
      : (game.game.acquisitionMethods[methodId ?? ''] ?? 'Other / Unknown')
    grouped.set(method, [...(grouped.get(method) ?? []), row])
  }
  const roots = bom.roots
  const recipes = bom.selectedRecipes
  const totalOwnedMaterials = [...bom.consumed].reduce(
    (sum, [id, owned]) => sum + (game.catalog.get(id)?.category === 'equipment' ? 0 : owned),
    0,
  )
  return (
    <>
      {bom.warnings.map((warning) => (
        <p className="feature-warning" role="status" key={warning}>
          {warning}
        </p>
      ))}
      <div className="bom-metrics">
        <div>
          <span>{label} required</span>
          <strong>{number(quantity(roots))}</strong>
        </div>
        <div>
          <span>{showReuse ? 'Owned or reusable' : 'Owned'}</span>
          <strong>{number(quantity(roots) - remaining(roots))}</strong>
        </div>
        <div>
          <span>Additional {label.toLowerCase()}</span>
          <strong>{number(remaining(roots))}</strong>
        </div>
        <div>
          <span>Crafting operations</span>
          <strong>{number(bom.operations)}</strong>
        </div>
      </div>
      {pending.length > 0 && (
        <div className="feature-warning" role="status">
          <TriangleAlert size={17} />
          <div>
            <strong>Some crafting requirements are unknown</strong>
            <ul>
              {pending.map((row) => (
                <li key={row.id}>
                  {name(row.id)} × {number(row.remaining)}.{' '}
                  {game.catalog.get(row.id)?.recipeNote ?? 'No usable recipe is installed.'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <section className="feature-card">
        <h3>
          <Layers3 size={17} /> {requirementTitle}
        </h3>
        <div className="bom-scroll">
          <table className="bom-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Required</th>
                <th>Owned</th>
                {showReuse && <th>Reusable</th>}
                <th>To craft</th>
                <th>External / unknown</th>
              </tr>
            </thead>
            <tbody>
              {roots.map((row) => (
                <tr key={row.id}>
                  <th>{name(row.id)}</th>
                  <td>{number(row.required)}</td>
                  <td>{number(row.owned)}</td>
                  {showReuse && <td>{number(row.reusable ?? 0)}</td>}
                  <td>{recipes.has(row.id) ? number(row.remaining) : '—'}</td>
                  <td>{recipes.has(row.id) ? '—' : number(row.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!roots.length && <p>{emptyText}</p>}
      </section>
      <section className="feature-card">
        <div className="feature-section-title">
          <h3>
            <ClipboardList size={17} /> Crafting plan
          </h3>
          <div className="view-tabs" aria-label="Crafting plan views">
            <button aria-pressed={detail === 'list'} onClick={() => setDetail('list')}>
              Shopping list
            </button>
            <button aria-pressed={detail === 'aggregate'} onClick={() => setDetail('aggregate')}>
              Aggregated materials
            </button>
            <button aria-pressed={detail === 'tree'} onClick={() => setDetail('tree')}>
              Dependency tree
            </button>
            <button aria-pressed={detail === 'checklist'} onClick={() => setDetail('checklist')}>
              Checklist
            </button>
          </div>
        </div>
        {detail === 'list' && (
          <>
            {useInventory && collection && inventory[collection.id] === collection.after && (
              <p className="feature-notice" role="status">
                Marked {name(collection.id)} as collected.{' '}
                <button
                  className="back-link"
                  onClick={() => {
                    onInventory(collection.id, collection.before)
                    setCollection(undefined)
                  }}
                >
                  Undo
                </button>
              </p>
            )}
            <div className="shopping-summary">
              <span>
                <b>{number(quantity(bom.rawMaterials))}</b> raw resource units
              </span>
              <span>
                <b>{number(totalOwnedMaterials)}</b> owned materials used
              </span>
              <span>
                <b>{number(remaining(resources))}</b> materials remaining
              </span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={missing}
                  onChange={(event) => setMissing(event.target.checked)}
                />{' '}
                Missing only
              </label>
            </div>
            {game.game.stations.length > 0 && (
              <p>
                Required stations · {bom.stations.map((id) => station(id)).join(', ') || 'None for this plan'}
              </p>
            )}
            {[...grouped].map(([method, rows]) => (
              <div key={method} className="resource-group">
                <h4>{method}</h4>
                <div className="bom-scroll">
                  <table className="bom-table">
                    <thead>
                      <tr>
                        <th>Resource</th>
                        <th>Total needed</th>
                        {useInventory && <th>Owned stock</th>}
                        <th>Remaining</th>
                        {useInventory && <th>Collected</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <th>{name(row.id)}</th>
                          <td>{number(row.required)}</td>
                          {useInventory && (
                            <td>
                              <input
                                aria-label={name(row.id) + ' owned'}
                                type="number"
                                min="0"
                                max={quantityLimit}
                                value={inventory[row.id] ?? 0}
                                onChange={(event) => onInventory(row.id, inputQuantity(event.target.value))}
                              />
                            </td>
                          )}
                          <td>{number(row.remaining)}</td>
                          {useInventory && (
                            <td>
                              <button
                                className="icon-button"
                                disabled={!row.remaining}
                                title={'Mark ' + name(row.id) + ' as collected'}
                                aria-label={'Mark ' + name(row.id) + ' as collected'}
                                onClick={() => {
                                  const before = inventory[row.id] ?? 0
                                  const after = Math.min(quantityLimit, before + row.remaining)
                                  onInventory(row.id, after)
                                  setCollection({ id: row.id, before, after })
                                }}
                              >
                                <Check size={15} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {!grouped.size && <p>No resources match this view.</p>}
          </>
        )}
        {detail === 'tree' && (
          <>
            <p>
              Each branch shows standalone recipe quantities. Use the shopping list for shared materials and
              stock deductions.
            </p>
            <div className="craft-tree">
              {roots
                .filter((row) => row.remaining)
                .map((row) => (
                  <CraftTree key={row.id} id={row.id} count={row.remaining} game={game} recipes={recipes} />
                ))}
            </div>
            {bom.surplus.size > 0 && (
              <p>
                Aggregate surplus ·{' '}
                {[...bom.surplus].map(([id, n]) => name(id) + ' × ' + number(n)).join(', ')}
              </p>
            )}
          </>
        )}
        {detail === 'aggregate' && (
          <>
            <p>
              Shared ingredients appear once. Quantities include batch rounding and stock already assigned to
              the plan.
            </p>
            <div className="bom-scroll">
              <table className="bom-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Demand to fulfill</th>
                    <th>Stock applied</th>
                    <th>Batches</th>
                    <th>Produced</th>
                    <th>Surplus</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.materials.map((row) => (
                    <tr key={row.id}>
                      <th>
                        {name(row.id)}
                        {intermediates.has(row.id) && <small className="bom-stage">Intermediate</small>}
                      </th>
                      <td>{number(row.required)}</td>
                      <td>{number(row.owned)}</td>
                      <td>{number(row.batches)}</td>
                      <td>{number(row.produced)}</td>
                      <td>{number(bom.surplus.get(row.id) ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bom.surplus.size > 0 && (
              <p>
                All surplus and byproducts ·{' '}
                {[...bom.surplus].map(([id, n]) => name(id) + ' × ' + number(n)).join(', ')}
              </p>
            )}
            {[...bom.consumed].length > 0 && (
              <p>
                Stock assigned · {[...bom.consumed].map(([id, n]) => name(id) + ' × ' + number(n)).join(', ')}
              </p>
            )}
          </>
        )}
        {detail === 'checklist' && (
          <ol className="craft-checklist">
            {bom.consumed.size > 0 && (
              <li>
                <Boxes size={16} />
                <span>
                  Set aside owned stock{' '}
                  <b>{[...bom.consumed].map(([id, n]) => name(id) + ' × ' + number(n)).join(', ')}</b>
                </span>
              </li>
            )}
            {bom.deficits.map((row) => (
              <li key={row.id}>
                <PackageSearch size={16} />
                <span>
                  {row.unknown ? 'Resolve requirements for' : 'Acquire'}{' '}
                  <b>
                    {name(row.id)} × {number(row.remaining)}
                  </b>
                  {game.catalog
                    .get(row.id)
                    ?.acquisition.map((id) => game.game.acquisitionMethods[id])
                    .filter(Boolean).length ? (
                    <small>
                      {game.catalog
                        .get(row.id)
                        ?.acquisition.map((id) => game.game.acquisitionMethods[id])
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  ) : null}
                </span>
              </li>
            ))}
            {bom.steps.map((row) => (
              <li key={row.id}>
                <Hammer size={16} />
                <span>
                  <b>
                    {batchCount(row.batches)} of {name(row.id)}
                  </b>
                  <small>
                    {row.recipe?.ingredients
                      .map((entry) => name(entry.itemId) + ' × ' + number(entry.quantity * row.batches))
                      .join(', ') || 'No consumable ingredients'}
                    {' → ' + number(row.produced) + ' produced'}
                    {row.produced > row.remaining
                      ? ' · ' + number(row.produced - row.remaining) + ' surplus'
                      : ''}
                    {station(row.recipe?.stationId ?? game.catalog.get(row.id)?.stationId)
                      ? ' · ' + station(row.recipe?.stationId ?? game.catalog.get(row.id)?.stationId)
                      : ''}
                    {row.recipe?.unlock ? ' · ' + row.recipe.unlock : ''}
                    {row.recipe?.seconds !== undefined
                      ? ' · ' + number(row.recipe.seconds) + ' s per batch'
                      : ''}
                  </small>
                </span>
              </li>
            ))}
            {finalStep && roots.length > 0 && (
              <li>
                <Check size={16} />
                <span>{finalStep}</span>
              </li>
            )}
          </ol>
        )}
      </section>
    </>
  )
}
