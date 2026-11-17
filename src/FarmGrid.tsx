import { forwardRef, useEffect, useImperativeHandle, useId, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Crosshair, Hand, Maximize, Minus, Plus, RotateCcw } from 'lucide-react'
import { gameFor } from './equipment.ts'
import { visitCoverage } from './coverage.ts'
import { itemId } from './model.ts'
import type { Plan, Tile } from './model.ts'
import type { coverage } from './coverage.ts'
import { download } from './storage.ts'

export interface Overlays { combined: boolean; water: boolean; guard: boolean; equipment: boolean; coords: boolean }
export interface GridHandle { downloadPng: () => void }
type Point = { x: number; y: number }
type View = Point & { scale: number }
type Maps = ReturnType<typeof coverage>
interface Props {
  plan: Plan; maps: Maps; overlays: Overlays; tool: Tile | 'pan' | 'lock'; disabled: boolean
  onPaint: (indices: number[]) => void; onEnd: () => void
}

const colors = {
  full: '#9abc78', water: '#90bbca', guard: '#e0bf79', neither: '#c5a482',
  empty: '#e1ceb1', rock: '#788782', path: '#eadac0', sprinkler: '#2f6a80', scarecrow: '#a26336',
}
export const palette = colors

function draw(ctx: CanvasRenderingContext2D, plan: Plan, maps: Maps, overlays: Overlays,
  view: View, size: Point, hover: number, decorations = true) {
  const cell = view.scale
  const ox = view.x - plan.width * cell / 2
  const oy = view.y - plan.height * cell / 2
  const x0 = Math.max(0, Math.floor(-ox / cell))
  const y0 = Math.max(0, Math.floor(-oy / cell))
  const x1 = Math.min(plan.width, Math.ceil((size.x - ox) / cell))
  const y1 = Math.min(plan.height, Math.ceil((size.y - oy) / cell))
  const gap = cell >= 7 ? Math.min(1.35, cell * 0.043) : 0
  const adapter = gameFor(plan.gameId)
  const items = adapter.placedItems
  const goal = adapter.game.requiredCoverage ?? ['water', 'guard']
  const needsWater = goal.includes('water'), needsGuard = goal.includes('guard')
  if (decorations && cell >= 8) {
    ctx.fillStyle = '#96826344'
    ctx.fillRect(ox - 4, oy - 4, plan.width * cell + 8, plan.height * cell + 8)
    ctx.fillStyle = '#f7f1df'
    ctx.fillRect(ox - 2, oy - 2, plan.width * cell + 4, plan.height * cell + 4)
  }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * plan.width + x
    const left = ox + x * cell
    const top = oy + y * cell
    const tile = plan.tiles[i]
    const id = itemId(tile)
    const item = id ? items.get(id) : undefined
    const water = (overlays.combined || overlays.water) && maps.water[i] > 0
    const guard = (overlays.combined || overlays.guard) && maps.guard[i] > 0
    const full = overlays.combined && (!needsWater || water) && (!needsGuard || guard) || water && guard
    const fill = item ? item.kind === 'water' ? colors.sprinkler : colors.scarecrow
      : tile === 'rock' ? colors.rock : tile === 'path' ? colors.path
      : tile === 'empty' || overlays.equipment ? colors.empty
      : full ? colors.full : water ? colors.water : guard ? colors.guard : colors.neither
    ctx.fillStyle = fill
    ctx.fillRect(left, top, cell - gap, cell - gap)
    if (cell >= 13 && item) {
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 ${Math.max(8, Math.min(13, cell * .31))}px sans-serif`
      ctx.fillText(item.label ?? item.name.slice(0, 2).toUpperCase(), left + cell * .48, top + cell * .51, cell - 3)
      if (tile.startsWith('!')) {
        ctx.fillStyle = '#ffdd87'
        ctx.fillRect(left + cell * .75, top + cell * .13, cell * .12, cell * .12)
      }
    } else if (cell >= 17 && tile === 'crop' && !overlays.equipment) {
      ctx.save()
      ctx.translate(left + cell * .48, top + cell * .53)
      ctx.strokeStyle = full ? '#486d38aa' : '#545d4f60'
      ctx.fillStyle = ctx.strokeStyle
      ctx.lineWidth = Math.max(1, cell * .039)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(0, cell * .13)
      ctx.lineTo(0, -cell * .015)
      ctx.stroke()
      for (const direction of [-1, 1]) {
        ctx.beginPath()
        ctx.ellipse(direction * cell * .078, -cell * .047, cell * .10, cell * .041, direction * -.65, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    } else if (cell >= 15 && tile === 'path') {
      ctx.fillStyle = '#b5a17d99'
      for (const [dx, dy] of [[.29, .35], [.68, .58], [.44, .74]]) {
        ctx.fillRect(left + cell * dx, top + cell * dy, 2, 2)
      }
    } else if (cell >= 15 && tile === 'rock') {
      ctx.fillStyle = '#c0c7b4'
      ctx.beginPath()
      ctx.arc(left + cell * .48, top + cell * .49, cell * .18, 0, Math.PI * 2)
      ctx.fill()
    }
    if (overlays.coords && cell >= 24 && !item) {
      ctx.fillStyle = '#243a32'
      ctx.font = '8px monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(`${x},${y}`, left + 2, top + 2)
    }
  }
  if (hover >= 0) {
    const x = hover % plan.width
    const y = Math.floor(hover / plan.width)
    const id = itemId(plan.tiles[hover])
    const item = id ? items.get(id) : undefined
    if (item) {
      const { radius, kind, shape } = item
      ctx.fillStyle = kind === 'water' ? '#b3f1ff65' : '#ffe6a46d'
      visitCoverage(plan.width, plan.height, hover, radius, index => {
        const tx = index % plan.width, ty = Math.floor(index / plan.width)
        if (tx >= x0 && tx < x1 && ty >= y0 && ty < y1) {
          ctx.fillRect(ox + tx * cell, oy + ty * cell, cell, cell)
        }
      }, shape)
    }
    ctx.strokeStyle = '#244c3b'
    ctx.lineWidth = Math.min(2, cell / 3)
    ctx.strokeRect(ox + x * cell, oy + y * cell, cell - gap, cell - gap)
  }
}

export const FarmGrid = forwardRef<GridHandle, Props>(function FarmGrid(
  { plan, maps, overlays, tool, disabled, onPaint, onEnd }, ref,
) {
  const area = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Point>({ x: 0, y: 0 })
  const [customView, setView] = useState<View | null>(null)
  const [hover, setHover] = useState(-1)
  const [space, setSpace] = useState(false)
  const [touchPaint, setTouchPaint] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const description = useId()
  const drag = useRef<{ id: number; pan: boolean; point: Point; last: Point } | null>(null)
  const fitted = { x: size.x / 2, y: size.y / 2, scale: Math.max(1, Math.min(56,
    (size.x - 46) / plan.width, (size.y - 46) / plan.height)) }
  const view = customView ?? fitted

  useLayoutEffect(() => {
    const node = area.current!
    const measure = () => {
      const { clientWidth: x, clientHeight: y } = node
      setSize(previous => previous.x === x && previous.y === y ? previous : { x, y })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => { setView(null); setHover(-1); setCursor(previous => previous < 0 ? -1 : 0) }, [plan.width, plan.height])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !(event.target instanceof HTMLElement) ||
        event.target.closest('input, textarea, select, button, [contenteditable]')) return
      event.preventDefault()
      setSpace(true)
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false) }
    const blur = () => setSpace(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useLayoutEffect(() => {
    const node = canvas.current!
    const dpr = window.devicePixelRatio || 1
    node.width = Math.round(size.x * dpr)
    node.height = Math.round(size.y * dpr)
    const ctx = node.getContext('2d')
    if (!ctx || !size.x || !size.y) return
    ctx.scale(dpr, dpr)
    draw(ctx, plan, maps, overlays, view, size, cursor >= 0 ? cursor : hover)
  }, [plan, maps, overlays, view.x, view.y, view.scale, size, hover, cursor])

  useImperativeHandle(ref, () => ({
    downloadPng() {
      const output = document.createElement('canvas')
      const scale = Math.min(40, Math.floor(3600 / Math.max(plan.width, plan.height)))
      output.width = plan.width * scale + 16
      output.height = plan.height * scale + 16
      const ctx = output.getContext('2d')!
      ctx.fillStyle = '#f7f1df'
      ctx.fillRect(0, 0, output.width, output.height)
      const center = { x: output.width / 2, y: output.height / 2, scale }
      draw(ctx, plan, maps, overlays, center, { x: output.width, y: output.height }, -1)
      output.toBlob(blob => { if (blob) download(blob, plan.name + '.png') })
    },
  }), [plan, maps, overlays])

  function zoom(factor: number, point: Point = { x: size.x / 2, y: size.y / 2 }) {
    setView(current => {
      const from = current ?? fitted
      const scale = Math.max(.85, Math.min(120, from.scale * factor))
      const ratio = scale / from.scale
      return { x: point.x + (from.x - point.x) * ratio, y: point.y + (from.y - point.y) * ratio, scale }
    })
  }
  useEffect(() => {
    const node = canvas.current!
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      zoom(Math.exp(-event.deltaY * .0015), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [size, plan.width, plan.height])

  function local(event: ReactPointerEvent) {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function tileAt(point: Point) {
    return { x: Math.floor((point.x - view.x) / view.scale + plan.width / 2),
      y: Math.floor((point.y - view.y) / view.scale + plan.height / 2) }
  }
  function index(point: Point) {
    return point.x >= 0 && point.y >= 0 && point.x < plan.width && point.y < plan.height
      ? point.y * plan.width + point.x : -1
  }
  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drag.current || ![0, 1, 2].includes(event.button)) return
    setCursor(-1)
    const pan = (event.pointerType === 'touch' && !touchPaint) || space || tool === 'pan' || event.button !== 0
    if (!pan && disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = local(event)
    const last = tileAt(point)
    drag.current = { id: event.pointerId, pan, point, last }
    const i = index(last)
    if (!pan && i >= 0) onPaint([i])
  }
  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = local(event)
    const current = drag.current
    const next = tileAt(point)
    if (current?.id === event.pointerId && current.pan) {
      const dx = point.x - current.point.x, dy = point.y - current.point.y
      setView(previous => ({ ...(previous ?? fitted), x: (previous ?? fitted).x + dx, y: (previous ?? fitted).y + dy }))
      current.point = point
      setHover(-1)
      return
    }
    setHover(index(next))
    if (!current || current.id !== event.pointerId || disabled) return
    const dx = next.x - current.last.x, dy = next.y - current.last.y
    const steps = Math.max(Math.abs(dx), Math.abs(dy))
    const indices: number[] = []
    for (let step = 1; step <= steps; step++) {
      const i = index({ x: current.last.x + Math.round(dx * step / steps), y: current.last.y + Math.round(dy * step / steps) })
      if (i >= 0) indices.push(i)
    }
    current.last = next
    if (indices.length) onPaint(indices)
  }
  function end(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drag.current?.id !== event.pointerId) return
    if (!drag.current.pan) onEnd()
    drag.current = null
  }
  const hoveredId = hover >= 0 ? itemId(plan.tiles[hover]) : undefined
  const hoveredItem = hoveredId ? gameFor(plan.gameId).placedItems.get(hoveredId) : undefined

  return <>
    <p id={description} className="sr-only">{plan.width} by {plan.height} grid with {plan.tiles.filter(tile => tile === 'crop').length.toLocaleString()} crop tiles.
      Use the arrow keys to move and Enter to apply the placement tool.</p>
    <div className={'farm-surface' + (touchPaint ? ' touch-paint' : '')} ref={area}>
      <canvas ref={canvas} tabIndex={0} aria-label="Editable farm grid" aria-describedby={description}
        onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setCursor(0) }} onBlur={() => setCursor(-1)}
        onKeyDown={event => {
          const i = Math.max(0, cursor)
          if (event.key === 'Enter') {
            event.preventDefault()
            if (!disabled) { onPaint([i]); onEnd() }
            return
          }
          const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
            ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
          const delta = directions[event.key]
          if (!delta) return
          event.preventDefault()
          const x = Math.max(0, Math.min(plan.width - 1, i % plan.width + delta.x))
          const y = Math.max(0, Math.min(plan.height - 1, Math.floor(i / plan.width) + delta.y))
          setCursor(index({ x, y }))
          const cx = view.x + (x + .5 - plan.width / 2) * view.scale
          const cy = view.y + (y + .5 - plan.height / 2) * view.scale
          if (cx < 0 || cx >= size.x || cy < 0 || cy >= size.y) {
            setView({ ...view, x: view.x + size.x / 2 - cx, y: view.y + size.y / 2 - cy })
          }
        }} style={{ cursor: space || tool === 'pan' ? 'grab' : 'crosshair' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
        onLostPointerCapture={end} onPointerLeave={() => setHover(-1)} onContextMenu={event => event.preventDefault()} />
      <div className="grid-tools">
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoom(.8)}><Minus size={16} /></button>
        <span>{Math.round(view.scale / fitted.scale * 100)}%</span>
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoom(1.25)}><Plus size={16} /></button>
        <i />
        <button title="Fit to screen" aria-label="Fit to screen" onClick={() => setView(null)}><Maximize size={15} /></button>
        <button title="Reset viewport" aria-label="Reset viewport" onClick={() => setView({ ...fitted, scale: 30 })}><RotateCcw size={15} /></button>
      </div>
    </div>
    <div className="grid-status">
      <button className="secondary touch-mode" aria-pressed={touchPaint} onClick={() => setTouchPaint(value => !value)}>
        Touch mode: {touchPaint ? 'Paint' : 'Pan'}
      </button>
      <span className="desktop-grid-hint"><Crosshair size={14} />{hover >= 0 ? `(${hover % plan.width}, ${Math.floor(hover / plan.width)})${hoveredItem ? ' · ' + hoveredItem.name : ''}` : 'Hover for coordinates'}</span>
      <span className="desktop-grid-hint"><Hand size={14} /> Space + drag to pan</span>
      <span className="touch-mode">{touchPaint ? 'Drag to paint' : 'Drag sideways to pan; swipe up or down to scroll'}</span>
      {cursor >= 0 && <span className="sr-only" aria-live="polite">Column {cursor % plan.width + 1}, row {Math.floor(cursor / plan.width) + 1}</span>}
    </div>
  </>
})
