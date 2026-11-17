import { useMemo, useState } from 'react'
import { ArrowLeft, Boxes, TriangleAlert } from 'lucide-react'
import { layoutBom } from './farm-bom.ts'
import type { BomConfiguration, BomSettings } from './farm-bom.ts'
import { BomView, OwnedStock, RecipeChoices, inputQuantity } from './BomView.tsx'
import { quantityLimit } from './crafting-types.ts'
import type { Game, Inventory } from './game.ts'
import type { Plan } from './model.ts'
import type { Workspace } from './storage.ts'

const modes = {
  scratch: 'Build from scratch', inventory: 'Use existing inventory',
  upgrade: 'Upgrade existing layout', custom: 'Custom crafting target',
}
export function Materials({ game, plan, inventory, settings, saved, previous, onSettings, onInventory, onBack, showPlan,
  configurations, onConfigurations }: {
  game: Game; plan: Plan; inventory: Inventory; settings: BomSettings; saved: Workspace['saved']; previous?: Plan
  onSettings: (patch: Partial<BomSettings>) => void; onInventory: (id: string, quantity: number) => void; onBack: () => void; showPlan: boolean
  configurations: BomConfiguration[]; onConfigurations: (values: BomConfiguration[]) => void
}) {
  const [configName, setConfigName] = useState('')
  const [configId, setConfigId] = useState('')
  const base = settings.base === 'previous' ? previous : settings.base === 'saved'
    ? saved.find(entry => entry.id === settings.baseId)?.plan : settings.snapshot
  const computed = useMemo(() => {
    try { return { bom: layoutBom(game, plan, inventory, settings, base) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [game, plan, inventory, settings, base])
  const custom = settings.mode === 'custom'
  return <main className="materials-page">
    <header className="feature-heading">
      <div><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Farm layout</button>
        <h2>Materials &amp; crafting</h2><p>{plan.name} · {game.game.name}</p></div>
    </header>
    <div className="feature-grid">
      <aside className="feature-card materials-settings">
        <h3><Boxes size={17} /> Calculation settings</h3>
        <label className="stack">BOM mode<select value={settings.mode}
          onChange={event => onSettings({ mode: event.target.value as BomSettings['mode'] })}>
          {Object.entries(modes).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        {settings.mode === 'custom' && <>
          <label className="stack">Target item<select value={settings.targetId} onChange={event => onSettings({ targetId: event.target.value })}>
            <option value="">Choose an item</option>{game.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label className="stack">Target quantity<input type="number" min="0" max={quantityLimit} value={settings.quantity}
            onChange={event => onSettings({ quantity: inputQuantity(event.target.value) })} /></label>
        </>}
        {settings.mode === 'upgrade' && <div className="materials-settings">
          <label className="stack">Existing layout<select value={settings.base} onChange={event => onSettings({ base: event.target.value as BomSettings['base'] })}>
            <option value="snapshot">Captured layout</option><option value="previous">Before last edit</option><option value="saved">Named layout</option>
          </select></label>
          {settings.base === 'snapshot' && <button className="secondary" onClick={() => onSettings({ snapshot: plan })}>Capture current layout</button>}
          {settings.base === 'saved' && <label className="stack">Named baseline<select value={settings.baseId} onChange={event => onSettings({ baseId: event.target.value })}>
            <option value="">Choose a layout</option>
            {saved.map(entry => <option key={entry.id} value={entry.id}>{entry.plan.name}</option>)}
          </select></label>}
          <p>{base ? 'Reusing equipment from ' + base.name + '.' : 'Choose or capture a baseline to reuse its equipment.'}</p>
        </div>}
        {settings.mode === 'scratch' && <p>Stock and existing equipment are ignored in this mode.</p>}
        {computed.bom && <RecipeChoices game={game} recipes={computed.bom.selectedRecipes} onSelect={(id, recipe) =>
          onSettings({ selections: { ...settings.selections, [id]: recipe } })} />}
        <details className="bom-disclosure">
          <summary>Saved BOM configurations</summary>
          <form className="materials-settings" onSubmit={event => {
            event.preventDefault()
            const name = configName.trim()
            if (!name) return
            const id = configurations.find(entry => entry.name === name)?.id ?? crypto.randomUUID()
            const savedSettings = settings.base === 'previous' ? { ...settings, base: 'snapshot' as const, snapshot: previous } : settings
            onConfigurations([...configurations.filter(entry => entry.id !== id), { id, name, settings: savedSettings }])
            setConfigId(id)
          }}>
            <label className="stack">Configuration name<input required maxLength={100} value={configName}
              onChange={event => setConfigName(event.target.value)} /></label>
            <button className="secondary" type="submit">Save configuration</button>
          </form>
          {configurations.length > 0 && <label className="stack saved-bom-picker">Load a configuration<select value={configId}
            onChange={event => {
              const entry = configurations.find(entry => entry.id === event.target.value)
              if (!entry) return
              setConfigId(entry.id)
              setConfigName(entry.name)
              onSettings({ ...entry.settings, snapshot: entry.settings.snapshot })
            }}><option value="" disabled>Choose a configuration</option>
            {configurations.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select></label>}
          {configId && <button className="secondary" onClick={() => {
            onConfigurations(configurations.filter(entry => entry.id !== configId))
            setConfigId('')
            setConfigName('')
          }}>Delete configuration</button>}
        </details>
        {settings.mode !== 'scratch' && <OwnedStock game={game} inventory={inventory} onInventory={onInventory} />}
      </aside>
      <div className="feature-content">
        {computed.error && <p className="feature-warning" role="alert"><TriangleAlert size={17} />{computed.error}</p>}
        {computed.bom && <BomView game={game} bom={computed.bom}
          inventory={inventory} onInventory={onInventory} useInventory={settings.mode !== 'scratch'} showPlan={showPlan}
          label={custom ? 'Target items' : 'Equipment'} requirementTitle={custom ? 'Crafting target' : 'Equipment requirements'}
          emptyText={custom ? 'Select a target item and quantity.' : 'Place equipment on the farm to calculate materials.'}
          showReuse={!custom} finalStep={custom ? undefined : 'Place or relocate equipment in the target farm layout.'} />}
      </div>
    </div>
  </main>
}
