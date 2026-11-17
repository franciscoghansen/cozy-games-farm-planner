import type { Game } from './game.ts'

export type ItemId = string
export type Item = Game['placables'][number]

const installed = new Map<string, Game>()
let defaultId: string | undefined
let layoutV1Game: string | undefined

export function registerGame(game: Game, makeDefault = false) {
  installed.set(game.game.id, game)
  if (makeDefault || !defaultId) defaultId = game.game.id
}

export function gameFor(id = defaultId): Game {
  const game = id && installed.get(id)
  if (!game) throw new Error('Game definition is not installed: ' + (id ?? '(default)'))
  return game
}

export const isItem = (id: string, gameId?: string) => gameFor(gameId).placedItems.has(id)
export const setLayoutV1Game = (id: string) => { layoutV1Game = id }
export const getLayoutV1Game = () => layoutV1Game ?? gameFor().game.id
