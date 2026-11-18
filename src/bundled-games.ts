import { validateManifest, validatePackage } from './game.ts'

export async function loadBundledGames(json: (path: string) => Promise<unknown>) {
  const manifest = validateManifest(await json('manifest.json'))
  const packages = await Promise.all(
    manifest.games.map(async (id) => {
      const [game, items, equipment, recipes, presets] = await Promise.all(
        ['game', 'items', 'equipment', 'recipes', 'presets'].map((file) => json(id + '/' + file + '.json')),
      )
      const cropData =
        typeof game === 'object' && game !== null && 'cropData' in game && game.cropData === true
      const [seasons, crops] = cropData
        ? await Promise.all(['seasons', 'crops'].map((file) => json(id + '/' + file + '.json')))
        : []
      let pack
      try {
        pack = validatePackage({
          game,
          items,
          equipment,
          recipes,
          presets,
          ...(cropData && { seasons, crops }),
        })
      } catch (error) {
        throw new Error(id + ': ' + (error instanceof Error ? error.message : String(error)), {
          cause: error,
        })
      }
      if (pack.game.id !== id) throw new Error('Game ID does not match its manifest directory: ' + id)
      return pack
    }),
  )
  return { manifest, packages }
}
