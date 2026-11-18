import { adaptGame, validatePackage, withBundledCrops } from './game.ts'
import type { GamePackage } from './game.ts'
import type { GameState } from './workspace-db.ts'
import { dbGet, dbGetAll } from './workspace-db.ts'
import type { WorkspaceDatabase } from './workspace-db.ts'
import { list, record, text, unique, validateState } from './workspace-state.ts'

const format = 'cozy-games-farm-planner'
const stores = ['states', 'games', 'settings']

export const backupSizeLimit = 32 * 1024 * 1024

export async function exportBackup(db: WorkspaceDatabase, activeGame: string) {
  if (db instanceof Map) return JSON.stringify({
    format, version: 1, activeGame, states: await dbGetAll(db, 'states'), games: await dbGetAll(db, 'games'),
  }, null, 2)
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction(stores, 'readonly')
    const states = tx.objectStore('states').getAll()
    const games = tx.objectStore('games').getAll()
    tx.oncomplete = () => resolve(JSON.stringify({
      format, version: 1, activeGame, states: states.result, games: games.result,
    }, null, 2))
    tx.onabort = () => reject(tx.error)
  })
}

export function parseBackup(source: string, bundled: ReadonlyMap<string, GamePackage>) {
  if (source.length > backupSizeLimit || new Blob([source]).size > backupSizeLimit) throw new Error('Workspace backup exceeds 32 MiB.')
  const backup = record(JSON.parse(source), 'workspace backup')
  if (backup.format !== format || backup.version !== 1) throw new Error('Choose a supported Farm Planner backup file.')
  const games = unique(list(backup.games, 'custom games').map(value => {
    const pack = record(value, 'custom game')
    for (const field of ['items', 'equipment', 'recipes', 'presets']) list(pack[field], 'game ' + field)
    const validated = validatePackage(value)
    return withBundledCrops(validated, bundled.get(validated.game.id))
  }), pack => pack.game.id, 'game ID')
  const definitions = new Map(bundled)
  for (const pack of games) definitions.set(pack.game.id, pack)
  const activeGame = text(backup.activeGame, 'selected game ID')
  if (!definitions.has(activeGame)) throw new Error('The selected game is missing from this backup.')
  const states = unique(list(backup.states, 'game workspaces').map(value => {
    const state = record(value, 'game workspace')
    const plan = record(record(state.workspace, 'workspace').current, 'current layout')
    const id = text(plan.gameId, 'game ID')
    const pack = definitions.get(id)
    if (!pack) throw new Error('No definition is available for game ' + id + '.')
    return validateState(value, adaptGame(pack))
  }), state => state.workspace.current.gameId, 'game workspace')
  return { states, games, activeGame }
}

export async function restoreBackup(db: IDBDatabase, backup: ReturnType<typeof parseBackup>) {
  const restored = new Set(backup.states.map(state => state.workspace.current.gameId))
  const overrides = new Set(backup.games.map(pack => pack.game.id))
  for (const pack of backup.games) {
    if (restored.has(pack.game.id)) continue
    const existing = await dbGet<GameState>(db, 'states', pack.game.id)
    if (existing) validateState(existing, adaptGame(pack))
  }
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite')
    const games = tx.objectStore('games')
    const states = tx.objectStore('states')
    for (const state of backup.states) {
      const id = state.workspace.current.gameId
      states.put(state, id)
      if (!overrides.has(id)) games.delete(id)
    }
    for (const pack of backup.games) games.put(pack, pack.game.id)
    tx.objectStore('settings').put(backup.activeGame, 'selected')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
}
