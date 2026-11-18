import type { Calendar, Crop, GrowthEvent } from './types.ts'
import { calendarMath } from './calendar.ts'

export function simulateCrop(calendar: Calendar, crop: Crop, options: {
  start: number; end: number; replant: boolean; modifier?: string; environment?: string
  canPlant?: (day: number) => boolean
}) {
  const { start, end, replant, canPlant = () => true, environment = calendar.environments[0]?.id } = options
  const clock = calendarMath(calendar)
  const events: GrowthEvent[] = []
  const warnings: string[] = []
  let tileDays = 0
  const result = () => ({ events, warnings, tileDays, footprint: crop.footprint.width * crop.footprint.height })
  if (crop.status === 'unsupported' || crop.environment !== environment) {
    warnings.push('This growing environment is outside the selected planting area.')
    return result()
  }
  if (crop.growth === undefined || crop.yield === undefined) {
    warnings.push('Growth or yield data is missing.')
    return result()
  }
  const modifier = crop.modifiers?.find(entry => entry.id === options.modifier)
  const duration = Math.max(1, crop.growth - (modifier?.daysSaved ?? 0))
  const firstDelay = duration - Number(calendar.growthStart === 'planting-day')
  const inSeason = (day: number) => !calendar.hasSeasons || crop.seasons.includes(clock.date(day).season)
  const survives = (day: number) => !calendar.hasSeasons || (inSeason(day) && crop.survivesSeasonChange && calendar.crossSeason === 'crop-specific')
  const canMature = (day: number) => {
    const maturity = day + firstDelay
    if (maturity > end) return false
    for (let boundary = clock.endOfSeason(day) + 1; boundary <= maturity; boundary = clock.endOfSeason(boundary) + 1) {
      if (!survives(boundary)) return false
    }
    return true
  }

  if (!inSeason(start)) warnings.push('This crop is out of season on the selected date.')
  else if (!canMature(start)) warnings.push('This crop cannot mature before the season or planning window ends.')
  let harvestDay: number | undefined
  let harvestCount = 0
  let plantings = 0
  let plantedDay = -1
  let nextPlant = start
  for (let day = start; day <= end; day++) {
    if (harvestDay !== undefined && day > plantedDay && clock.date(day).day === 1 && !survives(day)) {
      events.push({ day, activity: 'expires', quantity: 1 })
      warnings.push('Standing crops expire at the season transition.')
      harvestDay = undefined
    }
    let harvested = false
    if (harvestDay === day) {
      events.push({ day, activity: harvestCount ? 'regrowth' : 'harvest', quantity: crop.yield })
      harvested = true
      harvestCount++
      harvestDay = crop.regrowth && harvestCount < (crop.maxHarvests ?? Infinity) ? day + crop.regrowth : undefined
      // A zero-delay crop gets at most one planting per tile per day.
      nextPlant = day + Number(firstDelay === 0)
    }
    if (harvestDay === undefined && day >= nextPlant && (!plantings || (replant && crop.replant)) &&
      inSeason(day) && canMature(day) && canPlant(day)) {
      events.push({ day, activity: plantings ? 'replant' : 'plant', quantity: 1 })
      plantings++
      harvestCount = 0
      plantedDay = day
      harvestDay = day + firstDelay
      if (harvestDay === day) {
        events.push({ day, activity: 'harvest', quantity: crop.yield })
        harvested = true
        harvestCount++
        harvestDay = crop.regrowth && harvestCount < (crop.maxHarvests ?? Infinity) ? day + crop.regrowth : undefined
      }
    }
    if (harvestDay !== undefined || harvested) tileDays++
  }
  if (harvestDay !== undefined && !survives(clock.endOfSeason(end) + 1)) {
    warnings.push('Standing crops expire at the next season transition.')
  }
  if (!events.some(event => event.activity === 'plant')) warnings.push('No viable planting date in this window.')
  return { ...result(), warnings: [...new Set(warnings)] }
}
