import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BarChart3, Boxes, ChevronDown, Database, Download, Droplets, Eye, FolderOpen, Grid2X2, Hammer, Layers3, Redo2,
  Settings2, ShieldCheck, Sprout, Undo2, X } from 'lucide-react'
import { coverage, statistics } from './coverage.ts'
import { gameFor, isItem, registerGame } from './equipment.ts'
import { adaptGame, quantityLimit } from './game.ts'
import type { GamePackage } from './game.ts'
import { FarmGrid } from './FarmGrid.tsx'
import type { GridHandle, Overlays } from './FarmGrid.tsx'
import { itemId, resize, unlockedItems, usable } from './model.ts'
import type { Plan, Tile } from './model.ts'
import { changes } from './optimizer.ts'
import type { optimize } from './optimizer.ts'
import { Controls, legend, Statistics } from './Panels.tsx'
import type { Comparison, EditorTool } from './Panels.tsx'
import { preset } from './presets.ts'
import type { PresetId } from './presets.ts'
import { deserialize, download, serialize, validatePlan } from './storage.ts'
import { bootstrap, dbGet, dbWrite, emptyState } from './workspace-db.ts'
import type { GameState } from './workspace-db.ts'
import { Materials } from './Materials.tsx'
import { GameData } from './GameData.tsx'
import type { FarmBom } from './farm-bom.ts'
import { CraftingPlanner } from './CraftingPlanner.tsx'
import { emptyCrafting } from './crafting-plans.ts'
import { exportBackup, parseBackup, restoreBackup } from './backup.ts'
import './styles.css'

const overlayButtons = [
  { key: 'combined', label: 'Combined', icon: Layers3 },
  { key: 'water', label: 'Water', icon: Droplets },
  { key: 'guard', label: 'Protection', icon: ShieldCheck },
  { key: 'equipment', label: 'Equipment only', icon: Eye },
  { key: 'coords', label: 'Coordinates', icon: Grid2X2 },
] as const
const defaultOverlays: Overlays = { combined: true, water: false, guard: false, equipment: false, coords: false }
type Started = Awaited<ReturnType<typeof bootstrap>>

function App({ session, switchGame, replaceGame, switching }: {
  session: Started; switchGame: (id: string) => Promise<void>; switching: boolean
  replaceGame: (pack: GamePackage, reset?: boolean) => Promise<void>
}) {
  const { gameId, state, db } = session
  const adapter = gameFor(gameId)
  const pack = session.games.get(gameId)!
  const initial = state.workspace
  const [plan, setPlan] = useState(initial.current)
  const current = useRef(plan)
  const [previous, setPrevious] = useState<Plan>()
  const [view, setView] = useState<'planner' | 'materials' | 'data' | 'crafting'>(() =>
    location.hash === '#crafting' ? 'crafting' : 'planner')
  const [showCraftPlan, setShowCraftPlan] = useState(false)
  const [crafting, setCrafting] = useState<FarmBom>()
  const [craftingWorkspace, setCraftingWorkspace] = useState(() => state.crafting ?? emptyCrafting())
  const [materials, setMaterials] = useState(state.materials)
  const [bom, setBom] = useState(state.bom)
  const [configurations, setConfigurations] = useState(state.configurations ?? [])
  const [active, setActive] = useState(initial.active)
  const [saved, setSaved] = useState(initial.saved)
  const [tool, setTool] = useState<EditorTool>('crop')
  const [manualLock, setManualLock] = useState(state.preferences?.manualLock ?? false)
  const [selectedPreset, setSelectedPreset] = useState<PresetId | ''>(() => adapter.presets.find(entry =>
    entry.name === initial.current.name && entry.width === initial.current.width && entry.height === initial.current.height
    && preset(entry.id, gameId).tiles.every((tile, i) => tile === initial.current.tiles[i]))?.id ?? '')
  const [overlays, setOverlays] = useState<Overlays>(state.preferences?.overlays ?? defaultOverlays)
  const [past, setPast] = useState<Plan[]>([])
  const [future, setFuture] = useState<Plan[]>([])
  const stroke = useRef<{ before: Plan; seen: Set<number> } | null>(null)
  const [warning, setWarning] = useState('')
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const worker = useRef<Worker | null>(null)
  const grid = useRef<GridHandle>(null)
  const imported = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const [backupStatus, setBackupStatus] = useState('')
  const [dialog, setDialog] = useState(false)
  const modal = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(plan.name)
  const [showControls, setShowControls] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const editing = view === 'planner'
  const maps = useMemo(() => editing ? coverage(plan) : null, [editing, plan, adapter])
  const stats = useMemo(() => maps ? statistics(plan, maps) : null, [plan, maps])
  const busy = progress !== null
  const stock = useMemo(() => ({ ...materials, ...plan.inventory }), [materials, plan.inventory])
  const activeSaves = useMemo(() => saved.map(entry => entry.id === active ? { ...entry, plan } : entry), [saved, active, plan])

  useEffect(() => {
    const workspace = { current: plan, active, saved: activeSaves }
    void dbWrite(db, 'states', gameId, { workspace, materials, bom, configurations, crafting: craftingWorkspace,
      preferences: { overlays, manualLock } })
      .catch(() => setNotice('IndexedDB could not save your changes. Export JSON to keep a copy.'))
  }, [db, gameId, plan, active, activeSaves, materials, bom, configurations, craftingWorkspace, overlays, manualLock])
  useEffect(() => {
    if (view === 'crafting') history.replaceState(history.state, '', '#crafting')
    else if (location.hash === '#crafting') history.replaceState(history.state, '', location.pathname + location.search)
  }, [view])
  useEffect(() => {
    const element = modal.current!
    if (dialog && !element.open) element.showModal()
    if (!dialog && element.open) element.close()
  }, [dialog])
  useEffect(() => () => worker.current?.terminate(), [])

  function update(next: Plan) {
    current.current = next
    setPlan(next)
    setCrafting(undefined)
  }
  function remember(before: Plan) {
    setPrevious(before)
    setPast(history => [...history.slice(-39), before])
    setFuture([])
  }
  function commit(next: Plan) {
    remember(current.current)
    update(next)
    setComparison(null)
    setWarning('')
  }
  function undo() {
    if (!past.length || busy) return
    setFuture([current.current, ...future])
    update(past[past.length - 1])
    setPast(past.slice(0, -1))
    setComparison(null)
    setWarning('')
    setSelectedPreset('')
  }
  function redo() {
    if (!future.length || busy) return
    setPast([...past, current.current])
    update(future[0])
    setFuture(future.slice(1))
    setComparison(null)
    setWarning('')
    setSelectedPreset('')
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof HTMLElement) ||
        event.target.closest('input, textarea, select, [contenteditable]') || modal.current?.open) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  function paint(indices: number[]) {
    const before = current.current
    const id = isItem(tool, gameId) ? tool : undefined
    if (tool === 'pan' || busy || (id && !unlockedItems(before).some(item => item.id === id))) return
    const editing = stroke.current ??= { before, seen: new Set<number>() }
    const tiles = [...before.tiles]
    let changed = false
    for (const i of indices) {
      if (editing.seen.has(i)) continue
      editing.seen.add(i)
      const tile = tiles[i]
      let next: Tile = tile
      if (id && usable(tile)) next = manualLock ? `!${id}` : id
      else if (tool === 'lock' && itemId(tile)) next = tile.startsWith('!') ? itemId(tile)! : `!${itemId(tile)!}`
      else if (tool === 'erase') next = 'empty'
      else if (tool === 'crop' || tool === 'path' || tool === 'rock' || tool === 'empty') {
        if (!itemId(tile)) next = tool
      }
      if (next !== tile) { tiles[i] = next; changed = true }
    }
    if (changed) {
      update({ ...before, tiles })
      setSelectedPreset('')
      setComparison(null)
      setWarning('')
    }
  }
  function finishStroke() {
    if (stroke.current && stroke.current.before !== current.current) remember(stroke.current.before)
    stroke.current = null
  }

  function startOptimization(upgrade: boolean) {
    if (worker.current) return
    const before = current.current
    const agent = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' })
    worker.current = agent
    setProgress(0)
    setWarning('')
    setNotice('')
    const finish = () => {
      agent.terminate()
      worker.current = null
      setProgress(null)
    }
    agent.onmessage = (event: MessageEvent<{ progress?: number; error?: string; result?: ReturnType<typeof optimize> }>) => {
      const { progress, result, error } = event.data
      if (progress !== undefined) setProgress(progress)
      if (error) { finish(); setWarning(error) }
      if (!result) return
      finish()
      if (before.tiles.some((tile, i) => tile !== result.plan.tiles[i])) {
        commit(result.plan)
        setSelectedPreset('')
      }
      if (upgrade) setComparison({ before: statistics(before), after: statistics(result.plan), edits: changes(before, result.plan) })
      if (result.crafting || upgrade) {
        setBom(settings => ({ ...settings, mode: 'upgrade', base: 'snapshot', snapshot: before }))
      }
      if (result.crafting) setCrafting(result.crafting)
      if (result.shortfall) setWarning(`Found ${result.full.toLocaleString()} of ${before.target.toLocaleString()} target crops. The best layout found is short by ${result.shortfall.toLocaleString()}.`)
      setNotice(`${upgrade ? 'Upgrade' : 'Optimization'} complete · ${result.full.toLocaleString()} fully covered crops.`)
    }
    agent.onerror = () => { finish(); setWarning('The optimizer encountered a worker error.') }
    agent.postMessage({ plan: before, game: pack, options: { inventory: stock, selections: bom.selections } })
  }

  function saveNamed(duplicate: boolean) {
    const value = name.trim()
    if (!value) return
    const id = duplicate || !active ? crypto.randomUUID() : active
    const next = { ...current.current, name: value }
    setSaved(entries => [...entries.filter(entry => entry.id !== id), { id, plan: next }])
    setActive(id)
    update(next)
    setDialog(false)
    setNotice(duplicate ? 'Layout duplicated.' : 'Layout saved.')
  }

  function openSaved(id: string) {
    const entry = saved.find(item => item.id === id)
    if (!entry) return
    const previous = current.current
    if (active) setSaved(entries => entries.map(item => item.id === active ? { ...item, plan: previous } : item))
    setActive(id)
    update(entry.plan)
    setPast([])
    setFuture([])
    setSelectedPreset('')
    setComparison(null)
    setWarning('')
    setNotice('Layout loaded.')
    setDialog(false)
  }

  async function importFile(file: File) {
    try {
      const next = deserialize(await file.text(), gameId)
      commit(next)
      setSelectedPreset('')
      setNotice('Layout imported.')
    } catch (error) {
      setNotice(error instanceof Error ? 'Import failed. ' + error.message : 'Import failed.')
    }
  }

  function updateInventory(id: string, count: number) {
    const quantity = Math.min(quantityLimit, Math.max(0, Math.trunc(count)))
    if (adapter.placedItems.has(id)) update({ ...current.current, inventory: { ...current.current.inventory, [id]: quantity } })
    else {
      setMaterials(previous => ({ ...previous, [id]: quantity }))
      setCrafting(undefined)
    }
  }

  async function downloadWorkspace() {
    try {
      const data = await exportBackup(db, gameId)
      download(new Blob([data], { type: 'application/json' }), 'farm-planner-backup.json')
      setBackupStatus('Workspace backup downloaded.')
    } catch {
      setBackupStatus('Could not download the workspace backup. Try again or export individual layouts.')
    }
  }

  async function importWorkspace(file: File) {
    try {
      const backup = parseBackup(await file.text(), session.bundled)
      if (!window.confirm('Restore this workspace backup? Existing data for games in the backup will be replaced. Other games will be kept.')) return
      await restoreBackup(db, backup)
      location.reload()
    } catch (error) {
      setBackupStatus(error instanceof Error ? 'Backup restore failed. ' + error.message : 'Backup restore failed.')
    }
  }

  return <>
    <header className="topbar">
      <a className="brand" href={location.pathname + location.search} aria-label="Farm Planner home" onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        setView('planner')
      }}>
        <div className="brand-icon"><Sprout size={26} strokeWidth={1.8} aria-hidden="true" /></div>
        <div><h1><span>Farm Planner</span></h1><p>Plan crops, coverage, and equipment</p></div>
      </a>
      <div className="top-actions">
        <label className="game-picker"><span>Game</span><select aria-label="Game" value={gameId} disabled={busy || switching} onChange={event => {
          void switchGame(event.target.value).catch(error => setNotice(error.message))
        }}>{[...session.games.values()].map(entry => <option key={entry.game.id} value={entry.game.id}>{entry.game.name}</option>)}</select></label>
        <button className="secondary feature-nav" aria-pressed={view === 'materials'} disabled={busy} onClick={() => {
          setShowCraftPlan(false)
          setView(view === 'materials' ? 'planner' : 'materials')
        }}><Boxes size={16} /> Materials</button>
        <button className="secondary feature-nav" aria-pressed={view === 'crafting'} disabled={busy}
          onClick={() => setView(view === 'crafting' ? 'planner' : 'crafting')}><Hammer size={16} /> Crafting Planner</button>
        <button className="secondary feature-nav" aria-pressed={view === 'data'} disabled={busy} onClick={() => setView(view === 'data' ? 'planner' : 'data')}><Database size={15} /> Game data</button>
        <button className="secondary" disabled={busy} onClick={() => { setName(plan.name); setDialog(true) }}><FolderOpen size={16} /> Layouts</button>
        <details className="export-menu">
          <summary className="secondary"><Download size={15} /> Export <ChevronDown size={13} /></summary>
          <div className="menu">
            <button onClick={event => { download(new Blob([serialize(plan)], { type: 'application/json' }), plan.name + '.json'); event.currentTarget.closest('details')!.open = false }}>Download JSON</button>
            <button onClick={event => { grid.current?.downloadPng(); event.currentTarget.closest('details')!.open = false }}>Download PNG</button>
            <button disabled={busy} onClick={event => { imported.current?.click(); event.currentTarget.closest('details')!.open = false }}>Import JSON</button>
            <button disabled={busy || switching} onClick={event => {
              event.currentTarget.closest('details')!.open = false
              void downloadWorkspace()
            }}>Download workspace backup</button>
            <button disabled={busy || switching} onClick={event => {
              backupInput.current?.click()
              event.currentTarget.closest('details')!.open = false
            }}>Restore workspace backup</button>
          </div>
        </details>
        <a className="kofi-button" href="https://ko-fi.com/Z3C12AU1YN" target="_blank" rel="noopener noreferrer">
          <img src="https://storage.ko-fi.com/cdn/kofi6.png?v=6" height={36} alt="Buy Me a Coffee at ko-fi.com" referrerPolicy="no-referrer" />
        </a>
        <input hidden ref={imported} type="file" accept=".json,application/json" onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importFile(file)
        }} />
        <input hidden ref={backupInput} type="file" accept=".json,application/json" onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importWorkspace(file)
        }} />
      </div>
    </header>
    {backupStatus && <p className="feature-notice" role="status">{backupStatus}</p>}
    {view === 'materials' && <Materials game={adapter} plan={plan} inventory={stock} settings={bom} saved={activeSaves}
      previous={previous} onSettings={patch => { setBom(value => ({ ...value, ...patch })); setCrafting(undefined) }}
      configurations={configurations} onConfigurations={setConfigurations}
      onInventory={updateInventory} onBack={() => setView('planner')} showPlan={showCraftPlan} />}
    {view === 'crafting' && <CraftingPlanner game={adapter} workspace={craftingWorkspace} inventory={stock}
      onChange={setCraftingWorkspace} onInventory={updateInventory} />}
    {view === 'data' && <GameData key={gameId} pack={pack} bundled={session.bundled.has(gameId)}
      customized={session.bundled.get(gameId) !== pack} onSave={replaceGame}
      onReset={async () => { await replaceGame(session.bundled.get(gameId)!, true); setPast([]); setFuture([]); setPrevious(undefined) }}
      onBack={() => setView('planner')} />}
    {view !== 'planner' && notice && <p className="feature-notice" role="status">{notice}</p>}
    {view === 'planner' && maps && stats && <><div className="mobile-toggles">
      <button className="secondary" aria-expanded={showControls} onClick={() => setShowControls(!showControls)}><Settings2 size={15} /> Controls</button>
      <button className="secondary" aria-expanded={showStats} onClick={() => setShowStats(!showStats)}><BarChart3 size={15} /> Statistics</button>
    </div>
    <main className="workspace">
      <div className={'left-panel' + (showControls ? ' revealed' : '')}>
        <Controls key={plan.width + 'x' + plan.height} plan={plan} stats={stats} selectedPreset={selectedPreset} tool={tool}
          manualLock={manualLock} onTool={setTool} onLock={setManualLock}
          onPlan={patch => commit({ ...current.current, ...patch })}
          onPreset={id => {
            const { inventory, limited } = current.current
            commit({ ...preset(id, gameId), inventory, limited })
            setSelectedPreset(id)
          }}
          onResize={(w, h) => { if (w !== plan.width || h !== plan.height) { commit(resize(current.current, w, h)); setSelectedPreset('') } }}
          onRun={startOptimization} progress={progress} onCancel={() => {
            worker.current?.terminate(); worker.current = null; setProgress(null); setNotice('Optimization canceled.')
          }} />
      </div>
      <section className="editor" aria-label="Farm workspace">
        <div className="editor-heading">
          <div><div className="map-label"><Grid2X2 size={13} /> Farm layout</div><h2>{plan.name}</h2></div>
          <div className="editor-actions">
            <span className="size-badge">{plan.width} × {plan.height}</span>
            <button className="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!past.length || busy} onClick={undo}><Undo2 size={17} /></button>
            <button className="icon-button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!future.length || busy} onClick={redo}><Redo2 size={17} /></button>
          </div>
        </div>
        <div className="overlay-bar" aria-label="Coverage overlays">
          {overlayButtons.map(({ key, label, icon: Icon }) => <button key={key} aria-pressed={overlays[key]} onClick={() => setOverlays(value => ({
            ...value, [key]: !value[key], ...(key === 'combined' && !value.combined ? { water: false, guard: false } :
              (key === 'water' || key === 'guard') ? { combined: false } : {}),
          }))}><Icon size={14} />{label}</button>)}
        </div>
        <FarmGrid ref={grid} plan={plan} maps={maps} overlays={overlays} tool={tool === 'erase' ? 'empty' : tool}
          disabled={busy} onPaint={paint} onEnd={finishStroke} />
        <div className="legend">{legend.map(([name, color], index) => <span key={name}><i style={{ background: color }} />
          {index === 0 && (adapter.game.requiredCoverage?.length ?? 2) < 2 ? 'Meets coverage goal' : name}</span>)}</div>
        {crafting && <div className="craft-proposal">
          <div><strong>{crafting.operations.toLocaleString()} crafting operations</strong>
            <p>{crafting.consumed.size ? 'Stock assigned · ' + [...crafting.consumed].map(([id, count]) =>
              (adapter.catalog.get(id)?.name ?? id) + ' × ' + count.toLocaleString()).join(', ') : 'No loose stock required.'}</p></div>
          <button className="secondary" onClick={() => { setShowCraftPlan(true); setView('materials') }}><Boxes size={15} /> View crafting plan</button>
        </div>}
        <div className="editor-notice" aria-live="polite">{notice}</div>
      </section>
      <div className={'right-panel' + (showStats ? ' revealed' : '')}>
        <Statistics plan={plan} stats={stats} comparison={comparison} warning={warning} />
      </div>
    </main></>}
    <dialog ref={modal} onClose={() => setDialog(false)} className="layout-dialog">
      <div className="dialog-title"><h2>Farm layouts</h2><button className="icon-button" aria-label="Close layouts" onClick={() => setDialog(false)}><X size={18} /></button></div>
      <form onSubmit={event => { event.preventDefault(); saveNamed(false) }}>
        <label className="stack">Layout name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="dialog-actions"><button className="primary" type="submit">Save layout</button>
          <button className="secondary" type="button" onClick={() => saveNamed(true)}>Duplicate</button></div>
      </form>
      <h3>Saved layouts</h3>
      {saved.length ? <ul className="saved-layouts">{saved.map(entry => <li key={entry.id}>
        <button className="secondary" onClick={() => openSaved(entry.id)} disabled={entry.id === active}>
          <span>{entry.id === active ? plan.name : entry.plan.name}</span><small>{entry.id === active ? 'Open' : `${entry.plan.width} × ${entry.plan.height}`}</small>
        </button>
      </li>)}</ul> : <p>No named layouts saved yet.</p>}
      <button className="reset-button" onClick={() => {
        commit({ ...current.current, tiles: current.current.tiles.map(() => 'crop') })
        setSelectedPreset(''); setDialog(false); setNotice('Layout reset. You can undo this change.')
      }}>Reset layout</button>
    </dialog>
  </>
}

function Session({ initial }: { initial: Started }) {
  const [session, setSession] = useState(initial)
  const [switching, setSwitching] = useState(false)
  async function switchGame(id: string) {
    if (switching || id === session.gameId) return
    setSwitching(true)
    try {
      const state = await dbGet<GameState>(session.db, 'states', id) ?? emptyState(id)
      await dbWrite(session.db, 'settings', 'selected', id)
      setSession(previous => ({ ...previous, gameId: id, state }))
    } finally { setSwitching(false) }
  }
  async function replaceGame(pack: GamePackage, reset = false) {
    const id = pack.game.id
    const previous = session.games.get(id)
    registerGame(adaptGame(pack))
    try {
      const state = await dbGet<GameState>(session.db, 'states', id)
      if (state) {
        const plans = [state.workspace.current, ...state.workspace.saved.map(entry => entry.plan), state.bom.snapshot,
          ...(state.configurations ?? []).map(entry => entry.settings.snapshot)]
        for (const plan of plans) if (plan) validatePlan(plan, id)
      }
      await dbWrite(session.db, 'games', id, reset ? undefined : pack)
    } catch (error) {
      if (previous) registerGame(adaptGame(previous))
      throw new Error('Game data could not be saved. ' + (error instanceof Error ? error.message : String(error)))
    }
    setSession(value => ({ ...value, games: new Map(value.games).set(id, pack) }))
  }
  return <App key={session.gameId} session={session} switchGame={switchGame} switching={switching} replaceGame={replaceGame} />
}

const root = createRoot(document.getElementById('root')!)
root.render(<p className="feature-notice" role="status">Loading game data…</p>)
void bootstrap().then(initial => root.render(<Session initial={initial} />)).catch(error =>
  root.render(<p className="feature-warning" role="alert">The planner could not open. {error instanceof Error ? error.message : String(error)}</p>))
