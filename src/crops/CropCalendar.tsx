import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { download } from '../storage.ts'
import { calendarMath } from './calendar.ts'
import type { Activity, Calendar, Crop, ScheduleEvent } from './types.ts'

export const activityNames: Record<Activity, string> = {
  plant: 'Plant',
  harvest: 'Harvest',
  regrowth: 'Regrowth harvest',
  replant: 'Replant',
  expires: 'Expires',
}
const displayNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
export const moneyLabel = (calendar: Calendar, value: number) =>
  displayNumber(value) + ' ' + calendar.currency

export function scheduleCsv(calendar: Calendar, crops: ReadonlyMap<string, Crop>, events: ScheduleEvent[]) {
  const clock = calendarMath(calendar)
  const escape = (value: string | number) => {
    const text = String(value)
    const safe = typeof value === 'string' && /^[\s]*[=+@-]/.test(text) ? "'" + text : text
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  return [
    ['Year', 'Season', 'Day', 'Crop', 'Activity', 'Quantity', 'Estimated revenue'],
    ...events.map((event) => {
      const date = clock.date(event.day)
      return [
        date.year,
        calendar.seasons.find((season) => season.id === date.season)!.name,
        date.day,
        crops.get(event.cropId)?.name ?? event.cropId,
        activityNames[event.activity],
        event.quantity,
        event.revenue,
      ]
    }),
  ]
    .map((row) => row.map(escape).join(','))
    .join('\r\n')
}

export function CropCalendar({
  calendar,
  crops,
  events,
  completed,
  onToggle,
}: {
  calendar: Calendar
  crops: ReadonlyMap<string, Crop>
  events: ScheduleEvent[]
  completed: string[]
  onToggle: (key: string) => void
}) {
  const [mode, setMode] = useState('calendar')
  const [status, setStatus] = useState('all')
  const [crop, setCrop] = useState('')
  const [period, setPeriod] = useState(0)
  const clock = calendarMath(calendar)
  const done = new Set(completed)
  const cropIds = [...new Set(events.map((event) => event.cropId))]
  const filtered = events.filter(
    (event) =>
      (!crop || event.cropId === crop) &&
      (status === 'all' || done.has(event.key) === (status === 'completed')),
  )
  const byDay = new Map<number, ScheduleEvent[]>()
  for (const event of filtered) {
    const rows = byDay.get(event.day) ?? []
    rows.push(event)
    byDay.set(event.day, rows)
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)
  const periods: number[] = []
  if (events.length) {
    let day = clock.ordinal({ ...clock.date(events[0].day), day: 1 })
    while (day <= events[events.length - 1].day) {
      periods.push(day)
      day = clock.endOfSeason(day) + 1
    }
  }
  const activePeriod = Math.min(period, periods.length - 1)
  const start = periods[activePeriod]
  const date = (day: number) => {
    const value = clock.date(day)
    return (
      calendar.seasons.find((season) => season.id === value.season)!.name +
      ' ' +
      value.day +
      ', Year ' +
      value.year
    )
  }
  const list = (entries: ScheduleEvent[]) => (
    <ul className="crop-events">
      {entries.map((event) => (
        <li key={event.key}>
          <label className="check">
            <input type="checkbox" checked={done.has(event.key)} onChange={() => onToggle(event.key)} />
            <span>
              {activityNames[event.activity]} {displayNumber(event.quantity)}{' '}
              {crops.get(event.cropId)?.name ?? event.cropId}
              {event.revenue > 0 && <small>{moneyLabel(calendar, event.revenue)}</small>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
  const daily = (entries: ScheduleEvent[]) => {
    const yieldTotal = entries.reduce(
      (sum, event) =>
        sum + (event.activity === 'harvest' || event.activity === 'regrowth' ? event.quantity : 0),
      0,
    )
    return yieldTotal ? (
      <small>
        {displayNumber(yieldTotal)} harvested ·{' '}
        {moneyLabel(
          calendar,
          entries.reduce((sum, event) => sum + event.revenue, 0),
        )}
      </small>
    ) : null
  }

  return (
    <section className="feature-card crop-section">
      <div className="feature-section-title">
        <h3>Harvest calendar</h3>
        <button
          className="secondary"
          disabled={!filtered.length}
          onClick={() =>
            download(
              new Blob([scheduleCsv(calendar, crops, filtered)], { type: 'text/csv;charset=utf-8' }),
              'harvest-schedule.csv',
            )
          }
        >
          <Download size={15} /> Download CSV
        </button>
      </div>
      <div className="crop-controls">
        <label className="stack">
          View
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="calendar">Calendar</option>
            <option value="timeline">Timeline</option>
            <option value="daily">Daily harvest totals</option>
          </select>
        </label>
        <label className="stack">
          Crop
          <select
            value={cropIds.includes(crop) ? crop : ''}
            onChange={(event) => setCrop(event.target.value)}
          >
            <option value="">All crops</option>
            {cropIds.map((id) => (
              <option key={id} value={id}>
                {crops.get(id)?.name ?? id}
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          Activity
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All activities</option>
            <option value="projected">Projected</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      </div>
      {!filtered.length && (
        <p>
          {events.length
            ? 'No activities match these filters.'
            : 'Generate a plan to see planting and harvest dates.'}
        </p>
      )}
      {mode === 'calendar' && start !== undefined && (
        <>
          <div className="crop-calendar-nav">
            <button
              className="icon-button"
              aria-label="Previous season"
              disabled={activePeriod === 0}
              onClick={() => setPeriod(activePeriod - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <strong>{date(start).replace(/ 1,/, ',')}</strong>
            <button
              className="icon-button"
              aria-label="Next season"
              disabled={activePeriod + 1 === periods.length}
              onClick={() => setPeriod(activePeriod + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="crop-calendar-grid">
            {Array.from({ length: clock.endOfSeason(start) - start + 1 }, (_, i) => {
              const entries = byDay.get(start + i) ?? []
              return (
                <article key={start + i} className={entries.length ? 'has-events' : ''}>
                  <strong aria-label={date(start + i)}>{i + 1}</strong>
                  {daily(entries)}
                  {list(entries)}
                </article>
              )
            })}
          </div>
        </>
      )}
      {mode === 'timeline' && (
        <div className="crop-timeline">
          {days.map((day) => (
            <div key={day}>
              <strong>{date(day)}</strong>
              {daily(byDay.get(day)!)}
              {list(byDay.get(day)!)}
            </div>
          ))}
        </div>
      )}
      {mode === 'daily' && (
        <div className="crop-timeline">
          {days.map((day) => {
            const summary = daily(byDay.get(day)!)
            return (
              summary && (
                <div key={day}>
                  <strong>{date(day)}</strong>
                  {summary}
                </div>
              )
            )
          })}
        </div>
      )}
    </section>
  )
}
