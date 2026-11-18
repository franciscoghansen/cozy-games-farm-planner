export interface Calendar {
  schemaVersion: 1
  contentVersion: string
  source: string
  hasSeasons: boolean
  seasons: { id: string; name: string; days: number }[]
  currency: string
  growthStart: 'planting-day' | 'following-day'
  crossSeason: 'crop-specific' | 'reset'
  environments: { id: string; name: string }[]
  ranks: { id: string; name: string }[]
  qualities: { id: string; name: string }[]
}

export interface Crop {
  id: string
  itemId: string
  seedId: string
  name: string
  icon?: string
  category: string
  environment: string
  footprint: { width: number; height: number }
  seasons: string[]
  saleSeasons?: string[]
  rank?: string
  unlock?: string
  growth?: number
  regrowth?: number
  maxHarvests?: number
  yield?: number
  seedCost?: number
  prices?: Record<string, number>
  survivesSeasonChange: boolean
  replant: boolean
  modifiers?: { id: string; name: string; daysSaved: number; cost: number }[]
  status: 'verified' | 'incomplete' | 'unsupported'
  source: string
  note?: string
}

export interface CropCatalog {
  schemaVersion: 1
  contentVersion: string
  crops: Crop[]
}
export interface CropDate {
  year: number
  season: string
  day: number
}
export const strategies = ['maximum', 'low-budget', 'fast', 'low-maintenance', 'balanced', 'custom'] as const
export type Strategy = (typeof strategies)[number]
export const harvestActivities = ['plant', 'harvest', 'regrowth', 'replant', 'expires'] as const
export type Activity = (typeof harvestActivities)[number]
export interface GrowthEvent {
  day: number
  activity: Activity
  quantity: number
}
export interface ScheduleEvent extends GrowthEvent {
  cropId: string
  revenue: number
  key: string
}
export interface Allocation {
  cropId: string
  quantity: number
}
export interface CropSettings {
  date: CropDate
  horizon: 'remaining' | 'full' | 'multiple'
  seasons: number
  tiles: number
  farm: boolean
  manualWater: boolean
  protectedOnly: boolean
  budget: number
  quality: string
  rank: string
  unlocked: string[]
  strategy: Strategy
  replant: boolean
  modifier: string
}
export type PlotAssignments = Record<string, string>
export interface CropPlan {
  version: 1
  gameId: string
  id: string
  name: string
  settings: CropSettings
  allocations: Allocation[]
  plots: PlotAssignments
  schedule: ScheduleEvent[]
  completed: string[]
  pricing?: {
    contentVersion: string
    currency: string
    crops: { cropId: string; seedCost: number; salePrice: number; includedExpense: number }[]
  }
}
