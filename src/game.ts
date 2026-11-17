import { dependencyOrder, recipeAlternatives } from './bom.ts'
import { categories, quantityLimit } from './crafting-types.ts'
import type { Inventory, ItemDefinition, Recipe } from './crafting-types.ts'
export { quantityLimit } from './crafting-types.ts'
export type { Inventory, ItemDefinition, Quantity, Recipe } from './crafting-types.ts'

export type CoverageKind = 'water' | 'guard'
export type Shape = 'square' | 'circle'
export const terrain = ['crop', 'empty', 'rock', 'path'] as const
export const boardLimit = 200
export interface EquipmentDefinition { itemId: string; kind: CoverageKind; radius: number; shape: Shape; label?: string }
export interface PresetDefinition {
  id: string; name: string; width: number; height: number; fill?: 'empty' | 'crop'; progression?: string
  placements: { x: number; y: number; tile: string }[]
}
export interface Metadata {
  schemaVersion: 1; contentVersion: string; id: string; name: string; description?: string
  defaultPreset?: string; requiredCoverage?: CoverageKind[]; defaultInventory?: Inventory
  progressions: { id: string; name: string; equipment: string[] }[]
  acquisitionMethods: Record<string, string>; stations: { id: string; name: string }[]
}
export interface GamePackage {
  game: Metadata; items: ItemDefinition[]; equipment: EquipmentDefinition[]; recipes: Recipe[]; presets: PresetDefinition[]
}

function fail(path: string, message: string): never { throw new Error(path + ': ' + message) }
function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || !value || Array.isArray(value)) fail(path, 'expected an object')
  return value as Record<string, unknown>
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected a list')
  return value
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(path, 'expected non-empty text (up to 1,000 characters)')
  return value
}
function id(value: unknown, path: string) {
  const result = text(value, path)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(result) || result === '__proto__' || result === 'constructor') fail(path, 'invalid ID')
  return result
}
function number(value: unknown, path: string, min = 1, max = quantityLimit) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(path, `expected an integer between ${min} and ${max}`)
  }
  return value
}
function choice<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (!options.includes(value as T)) fail(path, 'expected one of ' + options.join(', '))
  return value as T
}
function optional(value: unknown, path: string, parse: (value: unknown, path: string) => unknown) {
  if (value !== undefined) parse(value, path)
}
function records(value: unknown, path: string, field = 'id') {
  const seen = new Set<string>()
  return array(value, path).map((entry, index) => {
    const at = `${path}[${index}]`
    const obj = object(entry, at)
    const key = id(obj[field], at + '.' + field)
    if (seen.has(key)) fail(at, 'duplicate ID ' + key)
    seen.add(key)
    return { obj, at, key }
  })
}
function ref(value: unknown, path: string, known: ReadonlySet<string>) {
  const key = id(value, path)
  if (!known.has(key)) fail(path, 'unknown reference ' + key)
  return key
}

export function validatePackage(value: unknown): GamePackage {
  const pack = object(value, 'Package')
  const meta = object(pack.game, 'game')
  if (meta.schemaVersion !== 1) fail('game.schemaVersion', 'unsupported schema version')
  id(meta.id, 'game.id')
  text(meta.name, 'game.name')
  text(meta.contentVersion, 'game.contentVersion')
  optional(meta.description, 'game.description', text)
  const methods = object(meta.acquisitionMethods, 'game.acquisitionMethods')
  for (const [key, name] of Object.entries(methods)) { id(key, 'acquisition method'); text(name, key) }
  const methodIds = new Set(Object.keys(methods))
  const stationIds = new Set(records(meta.stations, 'game.stations').map(({ obj, at, key }) => {
    text(obj.name, at + '.name')
    return key
  }))
  const coverageKinds = ['water', 'guard'] as const
  if (meta.requiredCoverage !== undefined) {
    const required = array(meta.requiredCoverage, 'game.requiredCoverage')
    for (const kind of required) choice(kind, 'game.requiredCoverage', coverageKinds)
    if (new Set(required).size !== required.length) fail('game.requiredCoverage', 'duplicate coverage kind')
  }

  const itemRecords = records(pack.items, 'items')
  const itemIds = new Set(itemRecords.map(entry => entry.key))
  for (const { obj, at } of itemRecords) {
    text(obj.name, at + '.name')
    choice(obj.category, at + '.category', categories)
    for (const method of array(obj.acquisition, at + '.acquisition')) ref(method, at + '.acquisition', methodIds)
    for (const field of ['description', 'unlock', 'recipeNote']) optional(obj[field], at + '.' + field, text)
    if (obj.icon !== null) optional(obj.icon, at + '.icon', text)
    for (const field of ['craftable', 'purchasable']) {
      if (obj[field] !== undefined && typeof obj[field] !== 'boolean') fail(at + '.' + field, 'expected a boolean')
    }
    if (obj.stationId !== undefined) ref(obj.stationId, at + '.stationId', stationIds)
  }

  const itemCategories = new Map(itemRecords.map(({ obj, key }) => [key, obj.category]))
  const equipmentIds = new Set(records(pack.equipment, 'equipment', 'itemId').map(({ obj, at, key }) => {
    ref(key, at + '.itemId', itemIds)
    if (itemCategories.get(key) !== 'equipment' || [...terrain, 'pan', 'erase', 'lock'].includes(key)) fail(at, 'invalid or reserved equipment item ID')
    choice(obj.kind, at + '.kind', coverageKinds)
    choice(obj.shape, at + '.shape', ['square', 'circle'])
    number(obj.radius, at + '.radius', 1, boardLimit)
    optional(obj.label, at + '.label', text)
    return key
  }))

  const progressions = new Set(records(meta.progressions, 'game.progressions').map(({ obj, at, key }) => {
    if (key === 'custom') fail(at, 'custom is reserved for individual tier selection')
    text(obj.name, at + '.name')
    for (const item of array(obj.equipment, at + '.equipment')) ref(item, at + '.equipment', equipmentIds)
    return key
  }))
  if (meta.defaultInventory !== undefined) {
    for (const [key, count] of Object.entries(object(meta.defaultInventory, 'game.defaultInventory'))) {
      ref(key, 'game.defaultInventory', equipmentIds)
      number(count, 'game.defaultInventory.' + key, 0)
    }
  }

  const presetIds = new Set(records(pack.presets, 'presets').map(({ obj, at, key }) => {
    text(obj.name, at + '.name')
    const width = number(obj.width, at + '.width', 1, boardLimit)
    const height = number(obj.height, at + '.height', 1, boardLimit)
    if (obj.progression !== undefined) ref(obj.progression, at + '.progression', progressions)
    if (obj.fill !== undefined) choice(obj.fill, at + '.fill', ['crop', 'empty'])
    const seen = new Set<number>()
    for (const entry of array(obj.placements, at + '.placements')) {
      const place = object(entry, at + '.placements')
      const x = number(place.x, at + '.x', 0, width - 1), y = number(place.y, at + '.y', 0, height - 1)
      if (seen.has(y * width + x)) fail(at, 'duplicate tile placement at ' + x + ',' + y)
      seen.add(y * width + x)
      const tile = text(place.tile, at + '.tile')
      if (!(terrain as readonly string[]).includes(tile)) ref(tile.replace(/^!/, ''), at + '.tile', equipmentIds)
    }
    return key
  }))
  if (meta.defaultPreset !== undefined) ref(meta.defaultPreset, 'game.defaultPreset', presetIds)

  function quantity(value: unknown, path: string) {
    const entry = object(value, path)
    number(entry.quantity, path + '.quantity')
    return ref(entry.itemId, path + '.itemId', itemIds)
  }
  const edges = new Map<string, Set<string>>()
  const byproducts = new Map<string, string>()
  const recipeRecords = records(pack.recipes, 'recipes')
  const recipeOutputs = new Map(recipeRecords.map(({ obj, at, key }) => [key, quantity(obj.output, at + '.output')]))
  for (const { obj, at, key } of recipeRecords) {
    const output = recipeOutputs.get(key)!
    const edgesForOutput = edges.get(output) ?? new Set<string>()
    for (const value of array(obj.ingredients, at + '.ingredients')) edgesForOutput.add(quantity(value, at + '.ingredients'))
    edges.set(output, edgesForOutput)
    if (obj.byproducts !== undefined) for (const value of array(obj.byproducts, at + '.byproducts')) {
      const id = quantity(value, at + '.byproducts')
      if (id === output) fail(at, 'list main output quantity under output')
      byproducts.set(id, at + '.byproducts')
    }
    if (obj.alternativeIds !== undefined) for (const value of array(obj.alternativeIds, at + '.alternativeIds')) {
      const alternative = id(value, at + '.alternativeIds')
      if (alternative === key || recipeOutputs.get(alternative) !== output) fail(at, 'alternative must be another recipe for ' + output)
    }
    if (obj.stationId !== undefined) ref(obj.stationId, at + '.stationId', stationIds)
    optional(obj.seconds, at + '.seconds', (v, path) => number(v, path, 0))
    for (const field of ['unlock', 'source', 'name']) optional(obj[field], at + '.' + field, text)
  }
  for (const ingredients of edges.values()) for (const id of ingredients) {
    const path = byproducts.get(id)
    if (path) fail(path, 'byproduct ' + id + ' is also used as a recipe ingredient')
  }
  dependencyOrder(edges)
  return value as GamePackage
}

export function validateManifest(value: unknown) {
  const manifest = object(value, 'manifest')
  if (manifest.schemaVersion !== 1) fail('manifest', 'unsupported schema version')
  const games = array(manifest.games, 'manifest.games').map(entry => id(entry, 'manifest.games'))
  if (games.length !== new Set(games).size) fail('manifest.games', 'duplicate game ID')
  const known = new Set(games)
  const defaultGame = ref(manifest.defaultGame, 'manifest.defaultGame', known)
  const layoutV1Game = manifest.layoutV1Game === undefined ? defaultGame : ref(manifest.layoutV1Game, 'manifest.layoutV1Game', known)
  return { games, defaultGame, layoutV1Game }
}

export function adaptGame(pack: GamePackage) {
  const catalog = new Map(pack.items.map(item => [item.id, item]))
  const equipment = pack.equipment.map(entry => ({ ...catalog.get(entry.itemId)!, ...entry, id: entry.itemId }))
  return { ...pack, catalog, placables: equipment, placedItems: new Map(equipment.map(item => [item.id, item])),
    recipeOptions: recipeAlternatives(pack.recipes) }
}
export type Game = ReturnType<typeof adaptGame>
