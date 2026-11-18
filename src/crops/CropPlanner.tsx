import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, Grid2X2, Sprout } from 'lucide-react'
import { boardLimit, quantityLimit } from '../game.ts'
import type { Game, Inventory } from '../game.ts'
import type { Plan } from '../model.ts'
import { BomView } from '../BomView.tsx'
import { download } from '../storage.ts'
import { validateCropPlan } from '../workspace-state.ts'
import { CropCalendar, activityNames, moneyLabel } from './CropCalendar.tsx'
import { farmCropArea, placeCrops, plotKey } from './crop-layout-adapter.ts'
import { footprint, seedOnSale } from './economics.ts'
import { cropPlanner } from './optimizer.ts'
import { seedProduction, seedShopping } from './seed-bom.ts'
import { strategies } from './types.ts'
import type { Allocation, CropPlan, CropSettings, PlotAssignments, Strategy } from './types.ts'

const strategyNames: Record<Strategy, string> = {
  maximum: 'Maximum profit', 'low-budget': 'Low budget', fast: 'Fast harvest',
  'low-maintenance': 'Low maintenance', balanced: 'Balanced', custom: 'Custom',
}
const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
const clamp = (value: string, low: number, high: number) => Math.min(high, Math.max(low, Math.trunc(Number(value)) || low))
const json = (value: unknown) => new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })

interface Props {
  game: Game
  farm: Plan
  inventory: Inventory
  saved: CropPlan[]
  onSave: (plans: CropPlan[]) => void
  onInventory: (id: string, quantity: number) => void
  onApply: (plots: PlotAssignments) => void
  onBack: () => void
}

export function CropPlanner(props: Props) {
  const { game } = props
  return <main className="materials-page crops-page">
    <header className="feature-heading"><div>
      <button className="back-link" onClick={props.onBack}><ArrowLeft size={15} /> Farm layout</button>
      <h2>Seasonal Crop Planner</h2><p>{game.game.name}</p>
    </div></header>
    {game.seasons && game.crops ? <CropWorkspace {...props} calendar={game.seasons} catalog={game.crops} />
      : <section className="feature-card"><h3>Crop data unavailable</h3><p>Select a game with an installed crop catalog and calendar.</p></section>}
  </main>
}

function CropWorkspace({ game, calendar, catalog, farm, inventory, saved, onSave, onInventory, onApply }: Props & {
  calendar: NonNullable<Game['seasons']>; catalog: NonNullable<Game['crops']>
}) {
  const [settings, setSettings] = useState<CropSettings>({
    date: { season: calendar.seasons[0].id, day: 1, year: 1 }, horizon: 'remaining', seasons: 2,
    tiles: 20, farm: false, manualWater: true, protectedOnly: false, budget: 500,
    quality: 'base', rank: calendar.ranks[0]?.id ?? '', unlocked: [], strategy: 'maximum', replant: false, modifier: '',
  })
  const [showBom, setShowBom] = useState(false)
  const [requests, setRequests] = useState<Allocation[]>([])
  const [active, setActive] = useState('')
  const [name, setName] = useState('My crop plan')
  const [snapshot, setSnapshot] = useState<CropPlan>()
  const [completed, setCompleted] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [seasonOnly, setSeasonOnly] = useState(true)
  const [availableOnly, setAvailableOnly] = useState(false)
  const [maturityOnly, setMaturityOnly] = useState(false)
  const [profitableOnly, setProfitableOnly] = useState(false)
  const [growthLimit, setGrowthLimit] = useState(0)
  const [regrowth, setRegrowth] = useState('')
  const [sort, setSort] = useState('profit')
  const [selected, setSelected] = useState('')
  const crops = useMemo(() => new Map(catalog.crops.map(crop => [crop.id, crop])), [catalog])
  const area = useMemo(() => farmCropArea(farm, settings), [farm, settings.manualWater, settings.protectedOnly])
  const tiles = settings.farm ? area.eligible : settings.tiles
  const rectangular = useMemo(() => catalog.crops.some(crop => footprint(crop) !== 1), [catalog])
  const planner = useMemo(() => cropPlanner(calendar, catalog.crops, { ...settings, tiles }, inventory,
    settings.farm && rectangular ? allocations => !!placeCrops(farm, area.available, crops, allocations) : undefined),
  [calendar, catalog, settings, tiles, inventory, rectangular, farm, area, crops])
  const result = useMemo(() => planner.plan(requests), [planner, requests])
  const events = snapshot?.schedule ?? result.events
  const selectedCrop = planner.comparisons.find(entry => entry.crop.id === selected)
  const currentSeason = calendar.seasons.find(entry => entry.id === settings.date.season)!
  const harvestBy = planner.window.endOfSeason(planner.window.start)
  const modifiers = new Map(catalog.crops.flatMap(crop => (crop.modifiers ?? []).map(entry => [entry.id, entry.name] as const)))
  const dateLabel = (day: number) => {
    const date = planner.window.date(day)
    return calendar.seasons.find(entry => entry.id === date.season)!.name + ' ' + date.day + ', Year ' + date.year
  }
  const filtered = planner.comparisons.filter(({ crop, unlocked, first, area }) =>
    crop.name.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!seasonOnly || !calendar.hasSeasons || crop.seasons.includes(settings.date.season)) &&
    (!availableOnly || (unlocked && seedOnSale(calendar, crop, planner.window.start)) || (inventory[crop.seedId] ?? 0) > 0) &&
    (!maturityOnly || first !== undefined && first <= harvestBy) && (!profitableOnly || area.net > 0) &&
    (!growthLimit || crop.growth !== undefined && crop.growth <= growthLimit) &&
    (!regrowth || Boolean(crop.regrowth) === (regrowth === 'yes')))
  const metric = (entry: typeof filtered[number]) => {
    switch (sort) {
      case 'tile': return entry.unit.perTile
      case 'tile-day': return entry.unit.perTileDay
      case 'cost': return -entry.unit.initial
      case 'speed': return -(entry.first ?? Infinity)
      case 'harvests': return entry.unit.harvests
      case 'margin': return harvestBy - (entry.first ?? Infinity)
      default: return entry.area.net
    }
  }
  filtered.sort((a, b) => Number(b.eligible) - Number(a.eligible) || metric(b) - metric(a) || a.crop.name.localeCompare(b.crop.name))
  const refresh = () => { setSnapshot(undefined); setMessage(''); setError('') }
  function patch(next: Partial<CropSettings>) {
    refresh()
    setSettings(value => ({ ...value, ...next }))
  }
  function setQuantity(cropId: string, quantity: number) {
    patch({ strategy: 'custom' })
    setRequests(rows => {
      if (!quantity) return rows.filter(row => row.cropId !== cropId)
      return rows.some(row => row.cropId === cropId) ? rows.map(row => row.cropId === cropId ? { cropId, quantity } : row)
        : [...rows, { cropId, quantity }]
    })
  }
  function useAssignments() {
    const amounts = new Map<string, number>()
    area.available.forEach((eligible, i) => {
      const id = farm.cropPlots?.[plotKey(i, farm.width)]
      if (eligible && id && crops.has(id)) amounts.set(id, (amounts.get(id) ?? 0) + 1)
    })
    setRequests([...amounts].map(([cropId, amount]) => ({ cropId, quantity: Math.floor(amount / footprint(crops.get(cropId)!)) })))
    patch({ strategy: 'custom', farm: true })
  }
  function load(plan: CropPlan) {
    setActive(plan.id); setName(plan.name); setSettings(plan.settings); setRequests(plan.allocations)
    setCompleted(plan.completed); setSnapshot(plan); setMessage('Opened ' + plan.name + '.'); setError('')
  }
  function makePlan(id = active || crypto.randomUUID(), label = name.trim()): CropPlan {
    const plots = result.allocations.length ? placeCrops(farm, area.available, crops, result.allocations) : undefined
    const valid = new Set(events.map(event => event.key))
    return {
      version: 1, id, name: label || 'My crop plan', gameId: game.game.id, settings,
      allocations: snapshot?.allocations ?? result.allocations, plots: snapshot?.plots ?? plots ?? {},
      schedule: events, completed: completed.filter(key => valid.has(key)),
      pricing: snapshot?.pricing ?? {
        contentVersion: catalog.contentVersion, currency: calendar.currency,
        crops: result.allocations.map(({ cropId }) => {
          const crop = crops.get(cropId)!
          return { cropId, seedCost: crop.seedCost!, salePrice: crop.prices![settings.quality],
            includedExpense: crop.modifiers?.find(entry => entry.id === settings.modifier)?.cost ?? 0 }
        }),
      },
    }
  }
  function save(duplicate: boolean) {
    const plan = makePlan(duplicate ? crypto.randomUUID() : undefined, duplicate ? name.trim() + ' copy' : undefined)
    onSave([...saved.filter(entry => entry.id !== plan.id), plan])
    load(plan)
    setMessage('Saved ' + plan.name + '.')
  }
  function toggle(key: string) {
    const next = completed.includes(key) ? completed.filter(entry => entry !== key) : [...completed, key]
    setCompleted(next)
    if (snapshot && active) onSave(saved.map(entry => entry.id === active ? { ...entry, completed: next } : entry))
  }
  function apply() {
    const plots = placeCrops(farm, area.available, crops, result.allocations)
    if (!plots) { setError('The current farm has too few eligible plots for these allocations. Import farm tile capacity and recommend again.'); return }
    onApply(plots)
    setError('')
    setMessage('Crop plan applied to the farm. Open Farm layout to see assignments or undo.')
  }
  function restorePlots() {
    if (!snapshot) return
    const plots = { ...farm.cropPlots }
    const available = new Set<number>()
    area.available.forEach((eligible, index) => {
      if (!eligible) return
      const key = plotKey(index, farm.width)
      available.add(key)
      delete plots[key]
    })
    let skipped = 0
    for (const [key, id] of Object.entries(snapshot.plots)) {
      if (available.has(Number(key))) plots[key] = id
      else skipped++
    }
    onApply(plots)
    setError('')
    setMessage(skipped ? 'Saved plots restored. ' + count(skipped) + ' saved tiles are outside the eligible farm area.'
      : 'Saved plots restored. You can undo this from the farm toolbar.')
  }
  function numeric(label: string, value: number, min: number, max: number, change: (value: number) => void, disabled = false) {
    return <label className="stack">{label}<input type="number" min={min} max={max} value={value} disabled={disabled}
      onChange={event => change(clamp(event.target.value, min, max))} /></label>
  }
  const shopping = useMemo(() => seedShopping(game, result), [game, result])
  const seedBom = useMemo(() => {
    if (!showBom || !shopping.length) return undefined
    try { return { result: seedProduction(game, shopping.map(row => ({ itemId: row.itemId, quantity: row.required })), inventory) } }
    catch (error) { return { error: error instanceof Error ? error.message : 'Could not calculate seed materials.' } }
  }, [showBom, game, shopping, inventory])
  const warnings = [...new Set(result.allocations.flatMap(row => planner.comparisons.find(entry => entry.crop.id === row.cropId)?.warnings ?? []))]
  const formatMoney = (value: number) => moneyLabel(calendar, value)

  return <>
    <section className="feature-card crop-section">
      <div className="feature-section-title"><h3>Planning settings</h3>
        <button className="primary" disabled={settings.strategy === 'custom'} onClick={() => {
          refresh()
          const recommendation = planner.plan()
          setRequests(recommendation.allocations)
          setMessage(recommendation.allocations.length ? 'Recommendation updated.' : 'No profitable planting fits these settings. Try another date, budget, or rank.')
        }}><Sprout size={16} /> Recommend crops</button>
      </div>
      <div className="crop-controls">
        <label className="stack">{calendar.hasSeasons ? 'Season' : 'Calendar period'}<select value={settings.date.season} onChange={event =>
          patch({ date: { ...settings.date, season: event.target.value, day: Math.min(settings.date.day, calendar.seasons.find(entry => entry.id === event.target.value)!.days) } })}>
          {calendar.seasons.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
        {numeric('Current day', settings.date.day, 1, currentSeason.days, day => patch({ date: { ...settings.date, day } }), settings.horizon === 'full')}
        {numeric('Year', settings.date.year, 1, 9999, year => patch({ date: { ...settings.date, year } }))}
        <label className="stack">Planning horizon<select value={settings.horizon} onChange={event => patch({ horizon: event.target.value as CropSettings['horizon'] })}>
          <option value="remaining">Remaining season</option><option value="full">Full season from day 1</option><option value="multiple">Multiple seasons</option>
        </select></label>
        {settings.horizon === 'multiple' && numeric('Seasons to include', settings.seasons, 2, 8, seasons => patch({ seasons }))}
        {numeric('Budget (' + calendar.currency + ')', settings.budget, 0, quantityLimit, budget => patch({ budget }))}
        {numeric(settings.farm ? 'Farm crop tiles' : 'Crop tiles', tiles, 0, boardLimit ** 2, tiles => patch({ tiles }), settings.farm)}
        {calendar.ranks.length > 0 && <label className="stack">Town rank<select value={settings.rank} onChange={event => patch({ rank: event.target.value })}>
          {calendar.ranks.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>}
        <label className="stack">Fixed selling quality<select value={settings.quality} onChange={event => patch({ quality: event.target.value })}>
          {calendar.qualities.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
        <label className="stack">Strategy<select value={settings.strategy} onChange={event => patch({ strategy: event.target.value as Strategy })}>
          {strategies.map(entry => <option key={entry} value={entry}>{strategyNames[entry]}</option>)}
        </select></label>
        {modifiers.size > 0 && <label className="stack">Growth modifier<select value={settings.modifier} onChange={event => patch({ modifier: event.target.value })}>
          <option value="">None</option>{[...modifiers].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>}
      </div>
      <div className="crop-actions">
        <label className="check"><input type="checkbox" checked={settings.farm} onChange={event => patch({ farm: event.target.checked })} /> Use farm layout tile count</label>
        <label className="check"><input type="checkbox" checked={settings.manualWater} disabled={settings.protectedOnly}
          onChange={event => patch({ manualWater: event.target.checked })} /> Include manually watered tiles</label>
        <label className="check"><input type="checkbox" checked={settings.protectedOnly} onChange={event => patch({ protectedOnly: event.target.checked })} /> Require water and scarecrow protection</label>
        <label className="check"><input type="checkbox" checked={settings.replant} disabled={settings.strategy === 'low-maintenance'}
          onChange={event => patch({ replant: event.target.checked })} /> Replant when possible</label>
        <button className="secondary" disabled={!Object.keys(farm.cropPlots ?? {}).length} onClick={useAssignments}><Grid2X2 size={15} /> Use farm assignments</button>
      </div>
      <p className="crop-muted">{count(area.plantable)} plantable · {count(area.watered)} watered · {count(area.protectedTiles)} protected · {count(area.eligible)} eligible on farm</p>
      <p className="crop-muted">Planning from {dateLabel(planner.window.start)} to {dateLabel(planner.window.end)}. Estimates assume daily watering and harvest sales available for future seed purchases.</p>
      {message && <p className="feature-notice" role="status">{message}</p>}
      {error && <p className="feature-warning" role="alert">{error}</p>}
    </section>

    <div className="crop-catalog-layout">
      <section className="feature-card crop-section">
        <div className="feature-section-title"><h3>Crop catalog</h3><span>{filtered.length} crops</span></div>
        <div className="crop-controls">
          <label className="stack">Search crops<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label className="stack">Sort by<select value={sort} onChange={event => setSort(event.target.value)}>
            <option value="profit">Total net profit</option><option value="tile">Net profit per tile</option>
            <option value="tile-day">Net profit per tile-day</option><option value="cost">Lowest initial investment per plant</option>
            <option value="speed">Fastest harvest</option><option value="harvests">Most harvests</option><option value="margin">Most days before season end</option>
          </select></label>
          <label className="stack">Harvest type<select value={regrowth} onChange={event => setRegrowth(event.target.value)}>
            <option value="">Any</option><option value="yes">Regrowing</option><option value="no">Single harvest</option>
          </select></label>
          {numeric('Growth limit (0 = any)', growthLimit, 0, 366, setGrowthLimit)}
        </div>
        <div className="crop-actions">
          <label className="check"><input type="checkbox" checked={seasonOnly} onChange={event => setSeasonOnly(event.target.checked)} /> Selected season</label>
          <label className="check"><input type="checkbox" checked={availableOnly} onChange={event => setAvailableOnly(event.target.checked)} /> Seeds available</label>
          <label className="check"><input type="checkbox" checked={maturityOnly} onChange={event => setMaturityOnly(event.target.checked)} /> Harvest by season end</label>
          <label className="check"><input type="checkbox" checked={profitableOnly} onChange={event => setProfitableOnly(event.target.checked)} /> Profitable at this budget</label>
        </div>
        {!filtered.length ? <p>No crops match these filters.</p> : <div className="crop-table-wrap"><table className="crop-table">
          <thead><tr>{['Crop', 'Growth', 'Regrowth', 'Seed cost', 'Harvests', 'Net per tile', 'Affordable plants', 'Area net'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{filtered.map(({ crop, unlocked, first, eligible, unit, quantity, area }) => <tr key={crop.id} className={crop.id === selected ? 'selected' : ''}>
            <th scope="row"><button className="back-link" aria-pressed={crop.id === selected} onClick={() => setSelected(crop.id)}>{crop.name}</button>
              <small>{crop.status !== 'verified' ? crop.status : unlocked ? crop.category : 'Shop locked'}</small></th>
            <td>{crop.growth === undefined ? '—' : crop.growth + ' d'}</td><td>{crop.regrowth ? crop.regrowth + ' d' : '—'}</td>
            <td>{crop.seedCost === undefined ? '—' : count(crop.seedCost)}</td><td>{first === undefined ? '—' : unit.harvests}</td>
            <td>{eligible ? count(unit.perTile) : '—'}</td><td>{eligible ? count(quantity) : '—'}</td><td>{eligible && quantity ? count(area.net) : '—'}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <aside className="feature-card crop-section">
        <h3>{selectedCrop?.crop.name ?? 'Crop details'}</h3>
        {!selectedCrop ? <p>Select a crop to see its harvest dates, seed inventory, and projected returns.</p> : <>
          <p>{selectedCrop.crop.category} · {selectedCrop.crop.footprint.width} × {selectedCrop.crop.footprint.height} tiles</p>
          <p>{calendar.seasons.filter(season => selectedCrop.crop.seasons.includes(season.id)).map(season => season.name).join(', ')}</p>
          {selectedCrop.crop.rank && <p>Shop unlock at rank {calendar.ranks.find(entry => entry.id === selectedCrop.crop.rank)?.name}. {selectedCrop.crop.unlock}</p>}
          <label className="check"><input type="checkbox" checked={settings.unlocked.includes(selected)} onChange={event =>
            patch({ unlocked: event.target.checked ? [...settings.unlocked, selected] : settings.unlocked.filter(id => id !== selected) })} /> Mark shop unlock met</label>
          {numeric('Seeds owned (shared inventory)', inventory[selectedCrop.crop.seedId] ?? 0, 0, quantityLimit, quantity => {
            refresh(); onInventory(selectedCrop.crop.seedId, quantity)
          })}
          {numeric('Plants in custom plan', requests.find(row => row.cropId === selected)?.quantity ?? 0, 0, boardLimit ** 2,
            quantity => setQuantity(selected, quantity))}
          {!!selectedCrop.warnings.length && <ul className="crop-warnings">{selectedCrop.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          {selectedCrop.eligible && <p>{count(selectedCrop.unit.production)} produced per plant · {formatMoney(selectedCrop.unit.gross)} gross · {formatMoney(selectedCrop.unit.perTileDay)} net per tile-day · {formatMoney(selectedCrop.unit.perSeed)} net per seed</p>}
          {!!selectedCrop.row.events.length && <details className="bom-disclosure"><summary>Projected dates per plant</summary>
            <ul>{selectedCrop.row.events.map(event => <li key={event.day + ':' + event.activity}>{dateLabel(event.day)} · {activityNames[event.activity]} {event.quantity}</li>)}</ul>
          </details>}
          <a href={selectedCrop.crop.source} target="_blank" rel="noreferrer">Crop data source</a>
        </>}
      </aside>
    </div>

    <section className="feature-card crop-section">
      <div className="feature-section-title"><h3>Planting plan</h3>
        <div className="crop-actions">
          {snapshot && Object.keys(snapshot.plots).length > 0 &&
            <button className="secondary" disabled={!area.eligible} onClick={restorePlots}>Restore saved plot positions</button>}
          <button className="primary" disabled={!result.allocations.length} onClick={apply}>Apply crop plan to farm</button>
        </div>
      </div>
      <p className="crop-muted">Recommendations use a deterministic estimate. Applying replaces assignments in the eligible farm area and can be undone from the farm toolbar.</p>
      {snapshot && <p className="crop-muted">The calendar shows the saved schedule{snapshot.pricing ? ' from catalog ' + snapshot.pricing.contentVersion : ''}. Estimates use the current catalog, inventory, and farm. <button className="back-link" onClick={refresh}>Recalculate schedule</button></p>}
      {result.allocations.length ? <>
        <div className="crop-metrics">{[
          ['Initial investment', formatMoney(result.initial)], ['Gross revenue', formatMoney(result.gross)],
          ['Net profit', formatMoney(result.net)], ['Harvest events', count(result.harvests)],
          ['Farm utilization', count(result.tiles) + ' / ' + count(tiles) + ' tiles'], ['Produced items', count(result.production)],
          ['Starting budget left', formatMoney(result.remainingBudget)], ['Future expenses', formatMoney(result.future)],
        ].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
        <ul className="crop-allocation">{result.allocations.map(row => <li key={row.cropId}>
          <strong>{crops.get(row.cropId)?.name}</strong> <span>{count(row.quantity)} plants</span>
        </li>)}</ul>
        <h4>Seed shopping list</h4>
        <div className="crop-table-wrap"><table className="crop-table">
          <thead><tr>{['Seed', 'Required', 'Owned', 'Additional', 'Purchase cost', 'Future purchases', 'Acquisition'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{shopping.map(row => <tr key={row.itemId}>
            <th scope="row">{row.name}</th><td>{count(row.required)}</td><td>{count(row.owned)}</td><td>{count(row.required - row.owned)}</td>
            <td>{formatMoney(row.cost)}</td><td>{formatMoney(row.future)}</td><td>{row.acquisition}</td>
          </tr>)}</tbody>
        </table></div>
        <button className="secondary" aria-expanded={showBom} onClick={() => setShowBom(!showBom)}>{showBom ? 'Hide seed materials' : 'Show seed materials'}</button>
        {seedBom?.error && <p className="feature-warning" role="alert">{seedBom.error}</p>}
        {seedBom?.result && <div className="feature-content"><BomView game={game} bom={seedBom.result} inventory={inventory}
          onInventory={onInventory} useInventory /></div>}
      </> : <p>Recommend crops or enter a custom quantity from the catalog.</p>}
      {result.reduced.length > 0 && <p className="feature-warning">Some requested plants could not fit the budget, unlocks, growing window, seed supply, or farm capacity. {result.reduced.map(row =>
        crops.get(row.cropId)?.name + ' × ' + count(row.quantity)).join(', ')} left out.</p>}
      {!!warnings.length && <ul className="crop-warnings">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    </section>

    <CropCalendar calendar={calendar} crops={crops} events={events} completed={completed} onToggle={toggle} />

    <section className="feature-card crop-section">
      <h3>Saved crop plans</h3>
      <form className="crop-actions" onSubmit={event => { event.preventDefault(); save(false) }}>
        <label className="stack">Plan name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
        <button className="primary">Save crop plan</button>
        <button className="secondary" type="button" onClick={() => save(true)}>Duplicate current plan</button>
        <button className="secondary" type="button" onClick={() => download(json(makePlan()), 'crop-plan.json')}>Export plan JSON</button>
        <button className="secondary" type="button" onClick={() => input.current?.click()}>Import plan JSON</button>
        <input ref={input} hidden type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          try {
            if (file.size > 16 * 1024 * 1024) throw new Error('Crop plan exceeds 16 MiB.')
            const plan = { ...validateCropPlan(JSON.parse(await file.text()), game), id: crypto.randomUUID() }
            onSave([...saved, plan]); load(plan)
          } catch (error) { setError(error instanceof Error ? error.message : 'Crop plan import failed.') }
        }} />
      </form>
      {error && <p className="feature-warning" role="alert">{error}</p>}
      {!saved.length && <p>No saved crop plans for this game yet.</p>}
      <ul className="crop-allocation">{saved.map(plan => <li key={plan.id}>
        <strong>{plan.name}{active === plan.id ? ' · Open' : ''}</strong>
        <button className="secondary" onClick={() => load(plan)}>Load</button>
        <button className="secondary" onClick={() => {
          const label = window.prompt('Rename crop plan', plan.name)?.trim().slice(0, 100)
          if (!label) return
          onSave(saved.map(entry => entry.id === plan.id ? { ...entry, name: label } : entry))
          if (active === plan.id) setName(label)
        }}>Rename</button>
        <button className="secondary" onClick={() => {
          if (!window.confirm('Delete “' + plan.name + '”?')) return
          onSave(saved.filter(entry => entry.id !== plan.id))
          if (active === plan.id) { setActive(''); setSnapshot(undefined) }
        }}>Delete</button>
      </li>)}</ul>
    </section>
  </>
}
