import { useMemo, useState } from 'react'
import { ArrowLeft, Hammer, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { prepareBom } from './bom.ts'
import { BomView, OwnedStock, RecipeChoices, inputQuantity } from './BomView.tsx'
import type { BomDisplayCatalog } from './BomView.tsx'
import { quantityLimit } from './crafting-types.ts'
import type { CraftingCatalog, Inventory } from './crafting-types.ts'
import type { CraftingWorkspace } from './crafting-plans.ts'

export function CraftingPlanner({ game, workspace, inventory, onChange, onInventory, onBack }: {
  game: BomDisplayCatalog & CraftingCatalog & { game: { name: string } }
  workspace: CraftingWorkspace
  inventory: Inventory
  onChange: (update: (previous: CraftingWorkspace) => CraftingWorkspace) => void
  onInventory: (id: string, count: number) => void
  onBack: () => void
}) {
  const { draft, saved, active } = workspace
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const [addQuantity, setAddQuantity] = useState('1')
  const [quantityError, setQuantityError] = useState('')
  const quantity = Number(addQuantity)
  const [name, setName] = useState(() => saved.find(plan => plan.id === active)?.name ?? '')
  const [status, setStatus] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = game.items.filter(item => (item.name + ' ' + item.id).toLowerCase().includes(needle))
  const craftable = new Set(game.recipes.map(recipe => recipe.output.itemId))
  const groups = ['Equipment', 'Craftable', 'Raw resources', 'Other items'].map((label, index) => ({
    label, items: matches.filter(item => (item.category === 'equipment' ? 0 : craftable.has(item.id) ? 1 :
      item.category === 'raw_resource' ? 2 : 3) === index),
  }))
  const chosen = matches.some(item => item.id === picked) ? picked : groups.find(group => group.items.length)?.items[0]?.id ?? ''
  const compiled = useMemo(() => {
    try { return { engine: prepareBom(game, { selections: draft.selections }) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [game, draft.selections])
  const computed = useMemo(() => {
    if (!compiled.engine) return { error: compiled.error }
    try { return { bom: compiled.engine.calculate(draft.targets, draft.useInventory ? inventory : {}) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [compiled, draft.targets, draft.useInventory, inventory])

  return <main className="materials-page">
    <header className="feature-heading"><div><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Farm layout</button><h2>Crafting Planner</h2><p>{game.game.name}</p></div></header>
    <div className="feature-grid">
      <aside className="feature-card materials-settings">
        <h3><Hammer size={17} /> Crafting targets</h3>
        <form className="materials-settings" onSubmit={event => {
          event.preventDefault()
          if (!chosen) return
          if (!Number.isInteger(quantity) || quantity < 1) { setQuantityError('Enter a whole quantity of at least 1.'); return }
          const existing = draft.targets.find(target => target.itemId === chosen)
          if ((existing?.quantity ?? 0) + quantity > quantityLimit) {
            setQuantityError('The total quantity exceeds the limit for this item.')
            return
          }
          onChange(current => ({
            ...current, draft: { ...current.draft, targets: existing
              ? current.draft.targets.map(target => target.itemId === chosen
                ? { ...target, quantity: target.quantity + quantity } : target)
              : [...current.draft.targets, { itemId: chosen, quantity }] },
          }))
          setStatus('')
          setQuantityError('')
        }} noValidate>
          <label className="stack">Search catalog<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label className="stack">Item to add<select value={chosen} onChange={event => { setPicked(event.target.value); setQuantityError('') }} disabled={!matches.length}>
            {!matches.length && <option value="">No matching items</option>}
            {groups.filter(group => group.items.length).map(group => <optgroup key={group.label} label={group.label}>
              {group.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </optgroup>)}
          </select></label>
          <label className="stack">Quantity to add<input type="number" min="1" max={quantityLimit} value={addQuantity}
            aria-invalid={Boolean(quantityError)} aria-describedby={quantityError ? 'quantity-error' : undefined}
            onChange={event => { setAddQuantity(event.target.value); setQuantityError('') }} />
            {quantityError && <small id="quantity-error" role="alert">{quantityError}</small>}
          </label>
          <button className="primary" disabled={!chosen}><Plus size={15} /> Add target</button>
        </form>
        {draft.targets.length > 0 && <ul className="crafting-targets">{draft.targets.map(({ itemId, quantity }) => {
          const label = game.catalog.get(itemId)?.name ?? itemId
          return <li key={itemId}>
            <label>{label}<input type="number" min="1" max={quantityLimit} value={quantity} aria-label={label + ' target quantity'}
              onChange={event => {
                const quantity = Math.max(1, inputQuantity(event.target.value))
                onChange(current => ({ ...current, draft: { ...current.draft, targets: current.draft.targets.map(target =>
                  target.itemId === itemId ? { ...target, quantity } : target) } }))
              }} /></label>
            <button className="icon-button" aria-label={'Remove ' + label} onClick={() =>
              onChange(current => ({ ...current, draft: { ...current.draft, targets: current.draft.targets.filter(target => target.itemId !== itemId) } }))
            }><Trash2 size={14} /></button>
          </li>
        })}</ul>}
        <label className="check"><input type="checkbox" checked={draft.useInventory} onChange={event => {
          const useInventory = event.target.checked
          onChange(current => ({ ...current, draft: { ...current.draft, useInventory } }))
        }} /> Apply owned inventory</label>
        {compiled.engine && <RecipeChoices game={game} recipes={compiled.engine.chosen} onSelect={(id, recipe) =>
          onChange(current => ({ ...current, draft: { ...current.draft, selections: { ...current.draft.selections, [id]: recipe } } }))} />}
        <OwnedStock game={game} inventory={inventory} onInventory={onInventory} />
        <details className="bom-disclosure">
          <summary>Saved crafting plans</summary>
          <form className="materials-settings" onSubmit={event => {
            event.preventDefault()
            const planName = name.trim()
            if (!planName) return
            const id = saved.find(plan => plan.name === planName)?.id ?? crypto.randomUUID()
            onChange(current => ({
              ...current, active: id,
              saved: [...current.saved.filter(plan => plan.id !== id), { id, name: planName, draft: current.draft }],
            }))
            setStatus('Crafting plan saved.')
          }}>
            <label className="stack">Crafting plan name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
            <button className="secondary">Save crafting plan</button>
          </form>
          {saved.length > 0 && <label className="stack saved-bom-picker">Load crafting plan<select value={active} onChange={event => {
            const plan = saved.find(entry => entry.id === event.target.value)
            if (!plan) return
            onChange(current => ({ ...current, active: plan.id, draft: plan.draft }))
            setName(plan.name)
            setStatus('Crafting plan loaded.')
          }}>
            <option value="">Choose a plan</option>
            {saved.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
          </select></label>}
          {active && <button className="back-link" type="button" onClick={() => {
            onChange(current => ({ ...current, active: '', draft: { ...current.draft, targets: [] } }))
            setName('')
            setStatus('')
          }}>New plan</button>}
        </details>
        {status && <p role="status">{status}</p>}
      </aside>
      <div className="feature-content">
        {computed.error && <p className="feature-warning" role="alert"><TriangleAlert size={17} />{computed.error}</p>}
        {computed.bom && <BomView game={game} bom={computed.bom}
          inventory={inventory} onInventory={onInventory} useInventory={draft.useInventory} />}
      </div>
    </div>
  </main>
}
