import { adaptGame, validateManifest, validatePackage } from './game.ts'
import type { GamePackage, Inventory } from './game.ts'
import { gameFor, registerGame, setLayoutV1Game } from './equipment.ts'
import { loadWorkspace } from './storage.ts'
import type { Workspace } from './storage.ts'
import { defaultPlan } from './presets.ts'
import { defaultBomSettings } from './farm-bom.ts'
import type { BomConfiguration, BomSettings } from './farm-bom.ts'
import type { CraftingWorkspace } from './crafting-plans.ts'
import { validateState } from './workspace-state.ts'
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
export type WorkspaceDatabase = IDBDatabase | Map<Store, Map<string, unknown>>
const memoryDatabase = (): WorkspaceDatabase => new Map([
  ['games', new Map()], ['states', new Map()], ['settings', new Map()],
])

export function openDatabase(factory: IDBFactory = indexedDB) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('farm-planner', 1)
    let blocked = false
    request.onupgradeneeded = () => {
      for (const name of ['games', 'states', 'settings']) request.result.createObjectStore(name)
    }
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Another tab is blocking the planner database.'))
    }
  })
}

export async function dbGet<T>(db: WorkspaceDatabase, store: Store, key: string) {
  if (db instanceof Map) return structuredClone(db.get(store)!.get(key)) as T | undefined
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function dbEntries(db: WorkspaceDatabase, store: Store) {
  if (db instanceof Map) return [...db.get(store)!] as [IDBValidKey, unknown][]
  return new Promise<[IDBValidKey, unknown][]>((resolve, reject) => {
    const tx = db.transaction(store)
    const entries: [IDBValidKey, unknown][] = []
    const cursor = tx.objectStore(store).openCursor()
    cursor.onsuccess = () => {
      if (cursor.result) {
        entries.push([cursor.result.key, cursor.result.value])
        cursor.result.continue()
      }
    }
    tx.oncomplete = () => resolve(entries)
    tx.onabort = () => reject(tx.error)
  })
}

export async function dbGetAll(db: WorkspaceDatabase, store: Store) {
  return (await dbEntries(db, store)).map(([, value]) => value)
}

export async function dbWrite(db: WorkspaceDatabase, store: Store, key: IDBValidKey, value: unknown) {
  if (db instanceof Map) {
    const entries = db.get(store)!
    if (value === undefined) entries.delete(String(key))
    else entries.set(String(key), structuredClone(value))
    return
  }
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
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const response = await fetch(base + '/games/' + path, { cache: 'no-cache' })
  if (!response.ok) throw new Error('Could not load game data: ' + path)
  return response.json()
}

function isValidState(raw: unknown, id: string) {
  try { validateState(raw, gameFor(id)); return true } catch { return false }
}

export async function loadGameState(db: WorkspaceDatabase, id: string) {
  const raw = await dbGet<unknown>(db, 'states', id)
  if (raw === undefined) return { state: emptyState(id), recovery: await dbGet(db, 'settings', 'recovery:' + id), repaired: false }
  try {
    const state = validateState(raw, gameFor(id), true)
    return { state, recovery: await dbGet(db, 'settings', 'recovery:' + id),
      repaired: !isValidState(raw, id) }
  } catch {
    // Keep the first unrecoverable copy until the user has had a chance to export it.
    const recovery = await dbGet(db, 'settings', 'recovery:' + id) ?? { state: raw }
    await dbWrite(db, 'settings', 'recovery:' + id, recovery)
    return { state: emptyState(id), recovery, repaired: false }
  }
}

export async function bootstrap(open = openDatabase, json = getJson) {
  const manifest = validateManifest(await json('manifest.json'))
  const [packages, stored] = await Promise.all([
    Promise.all(manifest.games.map(async id => {
      const [game, items, equipment, recipes, presets] = await Promise.all(
        ['game', 'items', 'equipment', 'recipes', 'presets'].map(file => json(id + '/' + file + '.json')),
      )
      const pack = validatePackage({ game, items, equipment, recipes, presets })
      if (pack.game.id !== id) throw new Error('Game ID does not match its manifest directory: ' + id)
      return pack
    })),
    (async () => {
      try {
        const db = await open()
        try {
          const [custom, selected] = await Promise.all([dbEntries(db, 'games'), dbGet<string>(db, 'settings', 'selected')])
          return { db: db as WorkspaceDatabase, custom, selected }
        } catch (error) { db.close(); throw error }
      } catch { return { db: memoryDatabase(), custom: [], selected: undefined } }
    })(),
  ])
  let { db } = stored
  const bundled = new Map(packages.map(pack => [pack.game.id, pack]))
  const games = new Map(bundled)
  const invalidOverrides: IDBValidKey[] = []
  for (const [key, value] of stored.custom) {
    try {
      const validated = validatePackage(value)
      if (validated.game.id !== key) throw new Error('Invalid override key.')
      games.set(validated.game.id, validated)
    } catch { invalidOverrides.push(key) }
  }
  for (const pack of games.values()) registerGame(adaptGame(pack), pack.game.id === manifest.defaultGame)

  const legacyGame = manifest.layoutV1Game
  setLayoutV1Game(legacyGame)
  const gameId = stored.selected && games.has(stored.selected) ? stored.selected : manifest.defaultGame
  async function load(db: WorkspaceDatabase) {
    if (await dbGet(db, 'states', legacyGame) === undefined) {
      const current = emptyState(legacyGame)
      try { current.workspace = loadWorkspace(localStorage, current.workspace.current) } catch { /* Browser denies access. */ }
      await dbWrite(db, 'states', legacyGame, current)
    }
    return loadGameState(db, gameId)
  }
  let loaded: Awaited<ReturnType<typeof load>>
  try { loaded = await load(db) }
  catch {
    if (!(db instanceof Map)) db.close()
    db = memoryDatabase()
    loaded = await load(db)
  }
  return { db, bundled, games, gameId, ...loaded, invalidOverrides }
}
