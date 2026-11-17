import { adaptGame, validateManifest, validatePackage } from './game.ts'
import type { GamePackage, Inventory } from './game.ts'
import { registerGame, setLayoutV1Game } from './equipment.ts'
import { loadWorkspace } from './storage.ts'
import type { Workspace } from './storage.ts'
import { defaultPlan } from './presets.ts'
import { defaultBomSettings } from './farm-bom.ts'
import type { BomConfiguration, BomSettings } from './farm-bom.ts'
import type { CraftingWorkspace } from './crafting-plans.ts'
import type { Overlays } from './FarmGrid.tsx'

export interface GameState {
  workspace: Workspace
  materials: Inventory
  bom: BomSettings
  configurations?: BomConfiguration[]
  crafting?: CraftingWorkspace
  preferences?: { overlays: Overlays; manualLock: boolean }
}

export const emptyState = (gameId: string): GameState => ({
  workspace: { active: null, current: defaultPlan(gameId), saved: [] }, materials: {}, bom: defaultBomSettings,
})

type Store = 'games' | 'states' | 'settings'

export function openDatabase(factory: IDBFactory = indexedDB) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('farm-planner', 1)
    request.onupgradeneeded = () => {
      for (const name of ['games', 'states', 'settings']) request.result.createObjectStore(name)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Another tab is blocking the planner database.'))
  })
}

export function dbGet<T>(db: IDBDatabase, store: Store, key: string) {
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function dbGetAll<T>(db: IDBDatabase, store: Store) {
  return new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function dbWrite(db: IDBDatabase, store: Store, key: string, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    if (value === undefined) tx.objectStore(store).delete(key)
    else tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}

async function getJson(path: string) {
  const response = await fetch(import.meta.env.BASE_URL + 'games/' + path)
  if (!response.ok) throw new Error('Could not load game data: ' + path)
  return response.json()
}

export async function bootstrap() {
  const [manifestData, db] = await Promise.all([getJson('manifest.json'), openDatabase()])
  const manifest = validateManifest(manifestData)
  const [packages, custom, selected] = await Promise.all([
    Promise.all(manifest.games.map(async id => {
      const [game, items, equipment, recipes, presets] = await Promise.all(
        ['game', 'items', 'equipment', 'recipes', 'presets'].map(file => getJson(id + '/' + file + '.json')),
      )
      const pack = validatePackage({ game, items, equipment, recipes, presets })
      if (pack.game.id !== id) throw new Error('Game ID does not match its manifest directory: ' + id)
      return pack
    })),
    dbGetAll<GamePackage>(db, 'games'), dbGet<string>(db, 'settings', 'selected'),
  ])
  const bundled = new Map(packages.map(pack => [pack.game.id, pack]))
  const games = new Map(bundled)
  for (const value of custom) {
    const validated = validatePackage(value)
    games.set(validated.game.id, validated)
  }
  for (const pack of games.values()) registerGame(adaptGame(pack), pack.game.id === manifest.defaultGame)

  const legacyGame = manifest.layoutV1Game
  setLayoutV1Game(legacyGame)
  if (!await dbGet<GameState>(db, 'states', legacyGame)) {
    const current = emptyState(legacyGame)
    current.workspace = loadWorkspace(localStorage, current.workspace.current)
    await dbWrite(db, 'states', legacyGame, current)
  }
  const gameId = selected && games.has(selected) ? selected : manifest.defaultGame
  const state = await dbGet<GameState>(db, 'states', gameId) ?? emptyState(gameId)
  return { db, bundled, games, gameId, state }
}
