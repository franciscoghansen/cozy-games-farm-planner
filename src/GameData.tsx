import { useMemo, useState } from 'react'
import { ArrowLeft, Database, Download, FileUp, Search } from 'lucide-react'
import { adaptGame, validatePackage } from './game.ts'
import type { GamePackage, ItemDefinition, Recipe } from './game.ts'
import { download } from './storage.ts'
import { prepareBom } from './bom.ts'
import { CraftTree } from './BomView.tsx'

export function GameData({ pack, bundled, customized, onSave, onReset, onBack }: {
  pack: GamePackage; bundled: boolean; customized: boolean
  onSave: (pack: GamePackage) => Promise<void>; onReset: () => Promise<void>; onBack: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(pack.items[0]?.id ?? '')
  const [edit, setEdit] = useState<{ type: 'items' | 'recipes'; id?: string; json: string }>()
  const [status, setStatus] = useState({ message: '', error: false })
  const [busy, setBusy] = useState(false)
  const game = useMemo(() => adaptGame(pack), [pack])
  const compiled = useMemo(() => prepareBom(game), [game])
  const item = pack.items.find(entry => entry.id === selected)
  const equipment = game.placedItems.get(selected)
  const recipes = pack.recipes.filter(recipe => recipe.output.itemId === selected)
  const name = (id: string) => pack.items.find(entry => entry.id === id)?.name ?? id
  const station = (id?: string) => pack.game.stations.find(station => station.id === id)?.name
  const matches = pack.items.filter(entry => (entry.name + ' ' + entry.id).toLowerCase().includes(query.trim().toLowerCase()))
  const begin = (type: 'items' | 'recipes', value: ItemDefinition | Recipe, id?: string) => {
    setEdit({ type, id, json: JSON.stringify(value, null, 2) })
    setStatus({ message: '', error: false })
  }

  async function act(callback: () => Promise<void>, message: string) {
    setBusy(true)
    setStatus({ message: '', error: false })
    try { await callback(); setStatus({ message, error: false }) }
    catch (error) { setStatus({ message: error instanceof Error ? error.message : String(error), error: true }) }
    finally { setBusy(false) }
  }
  async function saveEdit() {
    if (!edit) return
    const value = JSON.parse(edit.json) as ItemDefinition | Recipe
    if (edit.id && value?.id !== edit.id) throw new Error('Keep the existing ID when editing. Add a new entry for a new ID.')
    const list = pack[edit.type]
    const next = validatePackage({ ...pack, [edit.type]: edit.id ? list.map(row => row.id === edit.id ? value : row) : [...list, value] })
    await onSave(next)
    setSelected(edit.type === 'items' ? value.id : (value as Recipe).output.itemId)
    setEdit(undefined)
  }

  return <main className="materials-page">
    <header className="feature-heading">
      <div><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Farm layout</button>
        <h2>Game data</h2><p>{pack.game.name} · Version {pack.game.contentVersion}{customized ? ' · Local customization' : ''}</p></div>
      <div className="data-actions">
        <label className="secondary file-button"><FileUp size={15} /> Import game
          <input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            void act(async () => {
              const imported = validatePackage(JSON.parse(await file.text()))
              await onSave(imported)
            }, 'Game package installed.')
          }} /></label>
        <button className="secondary" onClick={() => download(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }), pack.game.id + '.game.json')}><Download size={15} /> Export game</button>
        {bundled && customized && <button className="secondary" disabled={busy} onClick={() => void act(onReset, 'Bundled definitions restored.')}>Reset overrides</button>}
      </div>
    </header>
    {status.message && <p className={status.error ? 'feature-warning' : 'feature-success'} role={status.error ? 'alert' : 'status'}>{status.message}</p>}
    <div className="feature-grid">
      <aside className="feature-card materials-settings">
        <h3><Search size={17} /> Item catalog</h3>
        <label className="stack">Search items<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button className="secondary" onClick={() => begin('items', {
          id: 'new_item', name: 'New item', category: 'miscellaneous', acquisition: [],
        })}>Add item</button>
        <div className="catalog-list">{matches.map(entry => <button className="secondary" key={entry.id}
          aria-pressed={entry.id === selected} onClick={() => { setSelected(entry.id); setEdit(undefined) }}>
          {entry.icon && <span className="item-icon">{entry.icon}</span>}{entry.name}</button>)}</div>
        {!matches.length && <p>No matching items.</p>}
      </aside>
      <div className="feature-content">
        <section className="feature-card">
          <div className="feature-section-title"><h3><Database size={17} /> {item?.name ?? 'Item details'}</h3>
            {item && <button className="secondary" disabled={busy} onClick={() => begin('items', item, item.id)}>Edit item</button>}
          </div>
          {item ? <>
            <p>{item.category.replaceAll('_', ' ')} · <code>{item.id}</code></p>
            {equipment && <p>{equipment.kind === 'guard' ? 'Protection' : 'Watering'} · {equipment.shape === 'square'
              ? `${2 * equipment.radius + 1} × ${2 * equipment.radius + 1} tiles`
              : `Circular coverage, radius ${equipment.radius} tiles`}</p>}
            {item.unlock && <p>Unlock · {item.unlock}</p>}
            {item.description && <p>{item.description}</p>}
            {item.acquisition.length > 0 && <p>Acquisition · {item.acquisition.map(key => pack.game.acquisitionMethods[key]).join(', ')}</p>}
            {item.stationId && <p>Station · {station(item.stationId)}</p>}
          </> : <p>Choose an item or add one to the catalog.</p>}
        </section>
        {item && <section className="feature-card">
          <div className="feature-section-title"><h3>Recipes</h3><button className="secondary" disabled={busy} onClick={() => begin('recipes', {
            id: 'craft_' + item.id, output: { itemId: item.id, quantity: 1 }, ingredients: [],
          })}>Add recipe</button></div>
          {item.recipeNote && !recipes.length && <p className="feature-warning">{item.recipeNote}</p>}
          {recipes.map(recipe => <div className="recipe-row" key={recipe.id}>
            <div><strong>{recipe.name ?? recipe.id.replaceAll('_', ' ')} · {recipe.output.quantity} produced</strong>
              <p>{recipe.ingredients.map(entry => name(entry.itemId) + ' × ' + entry.quantity).join(' · ') || 'No consumable ingredients'}</p>
              {(recipe.stationId || recipe.unlock) && <p>{[station(recipe.stationId), recipe.unlock].filter(Boolean).join(' · ')}</p>}
              {recipe.byproducts?.length ? <p>Byproducts · {recipe.byproducts.map(entry => name(entry.itemId) + ' × ' + entry.quantity).join(' · ')}</p> : null}
              {recipe.source && <p>Source · {recipe.source}</p>}
              <CraftTree id={recipe.output.itemId} count={recipe.output.quantity} game={game}
                recipes={new Map(compiled.chosen).set(recipe.output.itemId, recipe)} /></div>
            <button className="secondary" disabled={busy} onClick={() => begin('recipes', recipe, recipe.id)}>Override recipe</button>
          </div>)}
          {!recipes.length && !item.recipeNote && <p>No recipe is installed for this item.</p>}
        </section>}
        {edit && <form className="feature-card json-editor" onSubmit={event => {
          event.preventDefault()
          void act(saveEdit, 'Saved locally.')
        }}>
          <label className="stack">{edit.type === 'items' ? 'Item JSON' : 'Recipe JSON'}
            <textarea required rows={13} value={edit.json} spellCheck={false} onChange={event => setEdit({ ...edit, json: event.target.value })} /></label>
          <div className="data-actions"><button className="primary" disabled={busy}>Validate and save</button>
            <button className="secondary" disabled={busy} type="button" onClick={() => setEdit(undefined)}>Cancel</button></div>
        </form>}
      </div>
    </div>
  </main>
}
