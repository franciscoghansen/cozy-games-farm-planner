import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, ChevronDown, Droplets, Fence, Grid2X2, Hand, Leaf, LockKeyhole,
  Mountain, ScanLine, Settings2, ShieldCheck, Shovel, Sparkles, Sprout, Trash2, TriangleAlert } from 'lucide-react'
import { gameFor } from './equipment.ts'
import { maxSize, sizeOf, unlockedItems } from './model.ts'
import type { Plan, Tile } from './model.ts'
import type { statistics } from './coverage.ts'
import type { changes } from './optimizer.ts'
import type { PresetId } from './presets.ts'
import { palette } from './FarmGrid.tsx'

export type Tool = Tile | 'pan' | 'lock'
type Stats = ReturnType<typeof statistics>
export interface Comparison {
  before: Stats; after: Stats; edits: ReturnType<typeof changes>
}

export const strategyNames = {
  maximum: 'Maximum production', low: 'Low resources', balanced: 'Balanced', rework: 'Minimal rework',
  cost: 'Minimize raw resource cost', materials: 'Use available materials',
}

export function Section({ title, icon, children, closed = false }: { title: string; icon: ReactNode; children: ReactNode; closed?: boolean }) {
  return <details className="control-section" open={!closed || undefined}>
    <summary>{icon}<span>{title}</span><ChevronDown size={15} className="chevron" /></summary>
    <div className="section-content">{children}</div>
  </details>
}
const terrainTools = [
  { id: 'crop', name: 'Crop', icon: Sprout }, { id: 'empty', name: 'Farmland', icon: Shovel },
  { id: 'rock', name: 'Obstacle', icon: Mountain }, { id: 'path', name: 'Path', icon: Fence },
  { id: 'erase', name: 'Eraser', icon: Trash2 }, { id: 'pan', name: 'Pan', icon: Hand },
  { id: 'lock', name: 'Toggle lock', icon: LockKeyhole },
] as const
export type EditorTool = Tool | 'erase'

interface ControlProps {
  plan: Plan; stats: Stats; selectedPreset: PresetId | ''; tool: EditorTool; manualLock: boolean;
  onTool: (tool: EditorTool) => void; onLock: (value: boolean) => void; onPlan: (patch: Partial<Plan>) => void;
  onPreset: (preset: PresetId) => void; onResize: (width: number, height: number) => void;
  onRun: (upgrade: boolean) => void; onCancel: () => void; progress: number | null;
}

export function Controls({ plan, stats, selectedPreset, tool, manualLock, onTool, onLock,
  onPlan, onPreset, onResize, onRun, onCancel, progress }: ControlProps) {
  const [width, setWidth] = useState(String(plan.width))
  const [height, setHeight] = useState(String(plan.height))
  const available = unlockedItems(plan)
  const { game, placables: equipment, presets } = gameFor(plan.gameId)
  const busy = progress !== null
  return <aside className="sidebar controls">
    <div className="sidebar-title"><Settings2 size={17} /><h2>Planner controls</h2></div>
    <fieldset disabled={busy} className="control-fieldset">
      <Section title="Farm setup" icon={<Grid2X2 size={16} />}>
        <label className="stack">Layout preset<select value={selectedPreset} onChange={e => onPreset(e.target.value as PresetId)}>
          <option disabled value="">Custom layout</option>
          {presets.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.width} × {entry.height}</option>)}
        </select></label>
        <form onSubmit={event => {
          event.preventDefault()
          const w = sizeOf(Number(width), plan.width), h = sizeOf(Number(height), plan.height)
          onResize(w, h)
          setWidth(String(w))
          setHeight(String(h))
        }}>
          <div className="dimensions">
            <label className="stack">Width<input required type="number" min="1" max={maxSize} value={width} onChange={e => setWidth(e.target.value)} /></label>
            <span>×</span>
            <label className="stack">Height<input required type="number" min="1" max={maxSize} value={height} onChange={e => setHeight(e.target.value)} /></label>
            <button className="small-button" type="submit">Apply</button>
          </div>
        </form>
        <div className="quick-sizes" aria-label="Quick grid sizes">
          {[5, 15, 30, 50, 100, 200].map(size => <button key={size} type="button" className={size === plan.width && size === plan.height ? 'current' : ''}
            onClick={() => { onResize(size, size); setWidth(String(size)); setHeight(String(size)) }}>{size}</button>)}
        </div>
        <label className="stack">Farming progression<select value={plan.progression} onChange={e =>
          onPlan({ progression: e.target.value as Plan['progression'], unlocked: available.map(item => item.id) })}>
          {game.progressions.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
          <option value="custom">Custom equipment</option>
        </select></label>
        {plan.progression === 'custom' && <div className="tier-list">{equipment.map(item =>
          <label className="check" key={item.id}><input type="checkbox" checked={plan.unlocked.includes(item.id)}
            onChange={e => onPlan({ unlocked: e.target.checked ? [...plan.unlocked, item.id] : plan.unlocked.filter(id => id !== item.id) })} />{item.name}</label>)}</div>}
      </Section>
      <Section title="Placement tools" icon={<Shovel size={16} />}>
        <div className="equipment-tools">
          {equipment.some(item => item.kind === 'water') && <label className="stack">Watering<select aria-label="Watering equipment placement tool" value={available.some(item => item.kind === 'water' && item.id === tool) ? tool : ''}
            onChange={e => onTool(e.target.value as Tool)}><option value="" disabled>Choose tier</option>
            {available.filter(item => item.kind === 'water').map(item =>
              <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {equipment.some(item => item.kind === 'guard') && <label className="stack">Protection<select aria-label="Protection equipment placement tool" value={available.some(item => item.kind === 'guard' && item.id === tool) ? tool : ''}
            onChange={e => onTool(e.target.value as Tool)}><option value="" disabled>Choose tier</option>
            {available.filter(item => item.kind === 'guard').map(item =>
              <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        </div>
        <div className="terrain-tools">
          {terrainTools.map(({ id, name, icon: Icon }) => <button key={id} type="button" aria-pressed={tool === id}
            onClick={() => onTool(id)}><Icon size={15} /><span>{name}</span></button>)}
        </div>
        <label className="check manual-lock"><input type="checkbox" checked={manualLock} onChange={e => onLock(e.target.checked)} /> Lock newly placed equipment</label>
      </Section>
      <Section title="Equipment inventory" icon={<Fence size={16} />} closed>
        <label className="check"><input type="checkbox" checked={plan.limited} onChange={e => onPlan({ limited: e.target.checked })} /> Limit to owned equipment</label>
        <div className="inventory-inputs">{equipment.map(item => <label key={item.id}>
          <span>{item.name}<small>{stats.used[item.id]} used · {plan.limited ? Math.max(0, (plan.inventory[item.id] ?? 0) - stats.used[item.id]) : '∞'} left</small></span>
          <input aria-label={item.name + ' available'} type="number" min="0" max={maxSize ** 2} value={plan.inventory[item.id] ?? 0}
            onChange={e => onPlan({ inventory: { ...plan.inventory, [item.id]: Math.min(maxSize ** 2, Math.max(0, Math.trunc(Number(e.target.value)))) } })} />
        </label>)}</div>
      </Section>
      <Section title="Layout optimizer" icon={<Sparkles size={16} />}>
        <label className="stack">Strategy<select value={plan.strategy} onChange={e => onPlan({ strategy: e.target.value as Plan['strategy'] })}>
          {Object.entries(strategyNames).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
        </select></label>
        {(plan.strategy === 'low' || plan.strategy === 'cost') && <label className="stack">Target fully covered crops
          <input type="number" min="0" max={maxSize ** 2} value={plan.target} onChange={e =>
            onPlan({ target: Math.min(maxSize ** 2, Math.max(0, Math.trunc(Number(e.target.value)))) })} />
        </label>}
        {(plan.strategy === 'cost' || plan.strategy === 'materials') && <p className="optimizer-hint">Approximate search using recipe choices and stock from Materials.</p>}
        <button className="primary optimize" onClick={() => onRun(false)}><Sparkles size={16} /> Optimize layout</button>
        <button className="secondary upgrade" onClick={() => onRun(true)}>Upgrade layout <ArrowRight size={15} /></button>
      </Section>
    </fieldset>
    {busy && <div className="progress-box"><progress max={100} value={progress} aria-label="Optimizer progress" /><button onClick={onCancel}>Cancel optimization</button></div>}
  </aside>
}

export const legend = [
  ['Watered & protected', palette.full], ['Watered only', palette.water], ['Protected only', palette.guard],
  ['Uncovered crops', palette.neither], ['Empty farmland', palette.empty], ['Watering equipment', palette.sprinkler],
  ['Protection equipment', palette.scarecrow], ['Obstacle', palette.rock], ['Path', palette.path],
]

const fmt = (value: number) => value.toLocaleString()
export const pct = (value: number) => value.toFixed(1) + '%'

export function Statistics({ plan, stats, comparison, warning }: { plan: Plan; stats: Stats; comparison: Comparison | null; warning: string }) {
  const { game, placables: equipment } = gameFor(plan.gameId)
  const fullLabel = game.requiredCoverage?.length === 1 ? 'Meets coverage goal' : game.requiredCoverage?.length === 0 ? 'Crop tiles' : legend[0][0]
  const over = equipment.filter(item => plan.limited && stats.used[item.id] > (plan.inventory[item.id] ?? 0))
  return <aside className="sidebar stats">
    <div className="sidebar-title"><Leaf size={17} /><h2>Farm statistics</h2></div>
    {(warning || over.length > 0) && <div className="warning" role="status"><TriangleAlert size={16} /><div>
      {warning && <p>{warning}</p>}
      {over.map(item => <p key={item.id}>{item.name} exceeds inventory by {stats.used[item.id] - (plan.inventory[item.id] ?? 0)}.</p>)}
    </div></div>}
    <section className="efficiency">
      <div className="efficiency-label"><Sprout size={17} /> Production efficiency</div>
      <strong>{pct(stats.efficiency)}</strong>
      <div className="meter" aria-label={pct(stats.efficiency)}><div style={{ width: stats.efficiency + '%' }} /></div>
      <p>{fmt(stats.full)} of {fmt(stats.farmland)} usable tiles</p>
    </section>
    {comparison && <section className="stat-card comparison">
      <h3>Upgrade comparison</h3>
      <dl>
        <div><dt>Crop tiles</dt><dd>{fmt(comparison.before.crops)} → {fmt(comparison.after.crops)}</dd></div>
        <div><dt>{fullLabel}</dt><dd>{fmt(comparison.before.full)} → {fmt(comparison.after.full)}</dd></div>
        <div><dt>Efficiency</dt><dd>{pct(comparison.before.efficiency)} → {pct(comparison.after.efficiency)}</dd></div>
        <div><dt>Equipment added / removed</dt><dd>+{comparison.edits.added} / −{comparison.edits.removed}</dd></div>
        <div><dt>Equipment moved</dt><dd>{comparison.edits.moved}</dd></div>
        <div><dt>Net farmland reclaimed</dt><dd>{comparison.after.farmland - comparison.before.farmland}</dd></div>
      </dl>
    </section>}
    <section className="stat-card">
      <h3><ScanLine size={16} /> Coverage breakdown</h3>
      <dl className="coverage-stats">{[stats.full, stats.waterOnly, stats.guardOnly, stats.neither].map((value, index) =>
        <div key={legend[index][0]}><dt><i style={{ background: legend[index][1] }} />{index === 0 ? fullLabel : legend[index][0]}</dt><dd>{fmt(value)}</dd></div>)}</dl>
      <dl className="mini-stats">
        <div><dt><Droplets size={14} /> Total watered</dt><dd>{fmt(stats.watered)}</dd></div>
        <div><dt><ShieldCheck size={14} /> Total protected</dt><dd>{fmt(stats.protected)}</dd></div>
        <div><dt>Overlap / wasted coverage</dt><dd>{fmt(stats.overlap)} / {fmt(stats.wasted)}</dd></div>
      </dl>
    </section>
    <section className="stat-card">
      <h3><Grid2X2 size={16} /> Farmland</h3>
      <dl className="mini-stats plain">
        <div><dt>Total grid tiles</dt><dd>{fmt(stats.total)}</dd></div>
        <div><dt>Usable farmland</dt><dd>{fmt(stats.farmland)}</dd></div>
        <div><dt>Crop tiles</dt><dd>{fmt(stats.crops)}</dd></div>
        <div><dt>Empty farmland</dt><dd>{fmt(stats.empty)}</dd></div>
      </dl>
    </section>
    <section className="stat-card equipment-stats">
      <h3><Fence size={16} /> Equipment usage</h3>
      <div className="table-scroll"><table>
        <thead><tr><th>Equipment</th><th>Used</th><th>Own</th><th>Left</th></tr></thead>
        <tbody>{equipment.map(item => <tr key={item.id}><th>{item.name}</th><td>{stats.used[item.id]}</td>
          <td>{plan.limited ? plan.inventory[item.id] ?? 0 : '∞'}</td><td>{plan.limited ? Math.max(0, (plan.inventory[item.id] ?? 0) - stats.used[item.id]) : '∞'}</td></tr>)}</tbody>
      </table></div>
      <dl className="mini-stats">
        <div><dt>Watering / protection</dt><dd>{stats.sprinklers} / {stats.scarecrows}</dd></div>
        <div><dt>Full crops per watering item</dt><dd>{stats.perSprinkler.toFixed(1)}</dd></div>
        <div><dt>Full crops per equipment</dt><dd>{stats.perEquipment.toFixed(1)}</dd></div>
      </dl>
    </section>
    {!warning && !over.length && (game.requiredCoverage?.length ?? 2) === 2 && (stats.waterOnly > 0 || stats.guardOnly > 0) && <p className="suggestion">
      {stats.waterOnly > stats.guardOnly ? 'Add protection coverage to protect more watered crops.' : 'Add watering coverage to water more protected crops.'}
    </p>}
  </aside>
}
