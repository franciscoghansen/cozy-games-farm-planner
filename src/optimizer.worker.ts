import { optimize } from './optimizer.ts'
import type { MaterialOptions } from './optimizer.ts'
import { adaptGame } from './game.ts'
import type { GamePackage } from './game.ts'
import { registerGame } from './equipment.ts'
import type { Plan } from './model.ts'

self.onmessage = (event: MessageEvent<{ plan: Plan; game: GamePackage; options: MaterialOptions }>) => {
  try {
    const { plan, game, options } = event.data
    registerGame(adaptGame(game))
    const result = optimize(plan, (progress) => self.postMessage({ progress }), options)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Optimization failed.' })
  }
}
