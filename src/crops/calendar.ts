import type { Calendar, CropDate, CropSettings } from './types.ts'

export function calendarMath(calendar: Calendar) {
  let yearLength = 0
  const offsets = calendar.seasons.map(season => {
    const offset = yearLength
    yearLength += season.days
    return offset
  })
  function ordinal(date: CropDate) {
    const index = calendar.seasons.findIndex(season => season.id === date.season)
    if (index < 0 || !Number.isInteger(date.day) || date.day < 1 || date.day > calendar.seasons[index].days ||
      !Number.isInteger(date.year) || date.year < 1) throw new Error('Invalid crop calendar date.')
    return (date.year - 1) * yearLength + offsets[index] + date.day - 1
  }
  function date(day: number): CropDate {
    if (!Number.isSafeInteger(day) || day < 0) throw new Error('Invalid crop calendar day.')
    const elapsed = day % yearLength
    let index = offsets.length - 1
    while (offsets[index] > elapsed) index--
    return { year: Math.floor(day / yearLength) + 1, season: calendar.seasons[index].id, day: elapsed - offsets[index] + 1 }
  }
  function endOfSeason(day: number) {
    const current = date(day)
    return day + calendar.seasons.find(season => season.id === current.season)!.days - current.day
  }
  return { ordinal, date, endOfSeason }
}

export function planningWindow(calendar: Calendar, settings: Pick<CropSettings, 'date' | 'horizon' | 'seasons'>) {
  const clock = calendarMath(calendar)
  const start = clock.ordinal({ ...settings.date, day: settings.horizon === 'full' ? 1 : settings.date.day })
  let end = clock.endOfSeason(start)
  if (settings.horizon === 'multiple') {
    for (let i = 1; i < settings.seasons; i++) end = clock.endOfSeason(end + 1)
  }
  return { ...clock, start, end }
}
