import { gameFor } from './equipment.ts'
import type { Item, ItemId } from './equipment.ts'
import { createFarmMaterialService } from './farm-bom.ts'
import type { Inventory } from './game.ts'
import { coverage, statistics, visitCoverage } from './coverage.ts'
import { countEquipment, itemId, unlockedItems, usable } from './model.ts'
import type { Plan } from './model.ts'

interface Candidate { index: number; item: Item; score: number }

class MaxHeap {
  private entries: Candidate[] = []
  push(value: Candidate) {
    const entries = this.entries
    let i = entries.length
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (entries[parent].score >= value.score) break
      entries[i] = entries[parent]
      i = parent
    }
    entries[i] = value
  }
  pop() {
    const entries = this.entries
    if (!entries.length) return undefined
    const top = entries[0]
    const tail = entries.pop()!
    if (!entries.length) return top
    let i = 0
    while (2 * i + 1 < entries.length) {
      let child = 2 * i + 1
      if (child + 1 < entries.length && entries[child + 1].score > entries[child].score) child++
      if (entries[child].score <= tail.score) break
      entries[i] = entries[child]
      i = child
    }
    entries[i] = tail
    return top
  }
}

export function changes(before: Plan, after: Plan) {
  return [...gameFor(before.gameId).placedItems.keys()].reduce((result, key) => {
    const id = key as ItemId
    let added = 0
    let removed = 0
    before.tiles.forEach((tile, i) => {
      if (itemId(tile) === id && itemId(after.tiles[i]) !== id) removed++
      if (itemId(tile) !== id && itemId(after.tiles[i]) === id) added++
    })
    const moved = Math.min(added, removed)
    return { added: result.added + added - moved, removed: result.removed + removed - moved, moved: result.moved + moved }
  }, { added: 0, removed: 0, moved: 0 })
}

export interface MaterialOptions { inventory?: Inventory; selections?: Record<string, string> }

export function optimize(original: Plan, progress: (percent: number) => void = () => {}, options: MaterialOptions = {}) {
  const game = gameFor(original.gameId)
  const required = game.game.requiredCoverage ?? ['water', 'guard']
  const unlocked = unlockedItems(original).filter(item => required.includes(item.kind))
  const constrained = original.strategy === 'materials'
  const costMode = original.strategy === 'cost'
  const limited = original.limited && !constrained
  const owned = { ...options.inventory, ...original.inventory }
  const materials = constrained || costMode ? createFarmMaterialService(game, original, owned, options.selections) : undefined
  const costs = new Map(game.placables.map(item => {
    if (!costMode) return [item.id, 1]
    const list = materials!.cost({ [item.id]: 1 }).shopping
    return [item.id, 1 + Math.log2(1 + list.reduce((sum, row) => sum + row.remaining * (row.unknown ? 100 : 1), 0))]
  }))
  const locked = countEquipment({ ...original, tiles: original.tiles.map(tile => tile.startsWith('!') ? tile : 'empty') })
  const conflicts = Object.keys(locked).filter(id => limited && locked[id] > (original.inventory[id] ?? 0))
  if (conflicts.length) throw new Error('Locked equipment exceeds inventory. Unlock items or increase the available quantities.')

  const old = statistics(original)
  const variants = original.strategy === 'rework'
    ? [['water', true], ['guard', true], ['water', false]] as const
    : [['water', false], ['guard', false], ['water', true]] as const
  const usableOriginal = original.tiles.map(tile => tile === 'empty' ? 'empty' : 'crop')
  let best: { plan: Plan; score: number; full: number; resourceRank?: number[] } | undefined

  const consider = (plan: Plan) => {
    const stats = statistics(plan)
    if (constrained && !materials!.fits(stats.used)) return
    const count = stats.sprinklers + stats.scarecrows
    const diff = changes(original, plan)
    let score = stats.full * 10000 - count
    if (original.strategy === 'low' && stats.full >= original.target) score = 1e12 - count * 100000 + stats.full
    if (original.strategy === 'balanced') score = stats.full - 1.4 * count - 0.035 * (stats.overlap + stats.wasted)
    if (original.strategy === 'rework') score = stats.full - 1.5 * (diff.added + diff.removed + diff.moved)
    let resourceRank: number[] | undefined
    if (costMode) {
      const list = materials!.cost(stats.used).shopping
      const unknown = list.reduce((sum, row) => sum + (row.unknown ? row.remaining : 0), 0)
      const known = list.reduce((sum, row) => sum + (row.unknown ? 0 : row.remaining), 0)
      resourceRank = [Math.max(0, original.target - stats.full), unknown, known, -stats.full, count]
    }
    const previousRank = best?.resourceRank
    const rankIndex = resourceRank && previousRank ? resourceRank.findIndex((value, index) => value !== previousRank[index]) : -1
    if (!best || (resourceRank && best.resourceRank
      ? rankIndex >= 0 && resourceRank[rankIndex] < best.resourceRank[rankIndex]
      : score > best.score || (score === best.score && stats.full > best.full))) {
      best = { plan: { ...plan, tiles: [...plan.tiles] }, score, full: stats.full, resourceRank }
    }
  }

  if (!limited || game.placables.every(item => old.used[item.id] <= (original.inventory[item.id] ?? 0))) {
    consider(original)
  }

  for (const [variantIndex, [first, preserve]] of variants.entries()) {
    const used = { ...locked }
    const plan: Plan = { ...original, tiles: original.tiles.map((tile, i) => {
      const id = itemId(tile)
      if (!id || tile.startsWith('!')) return tile
      if (preserve && (!limited || used[id] < (original.inventory[id] ?? 0))) {
        used[id]++
        return tile
      }
      return usableOriginal[i]
    }) }
    const maps = coverage(plan)
    for (const kind of ['water', 'guard'] as const) if (!required.includes(kind)) maps[kind].fill(1)
    const other = first === 'water' ? 'guard' : 'water'
    const visit = (index: number, item: Item, callback: (i: number) => void) =>
      visitCoverage(plan.width, plan.height, index, item.radius, callback, item.shape)
    const available = (id: ItemId) => !limited || used[id] < (plan.inventory[id] ?? 0)

    function fill(kind: Item['kind'], seed: boolean, limit = Infinity) {
      const own = maps[kind]
      const opposite = kind === 'water' ? 'guard' : 'water'
      const complementary = maps[opposite]
      const heap = new MaxHeap()
      const denied = new Set<string>()
      const complement = unlocked.filter(item => item.kind === opposite)
      const reserveComplement = constrained && required.includes(opposite)
        && !game.placables.some(item => item.kind === opposite && used[item.id] > 0)
      function score(index: number, item: Item) {
        if (denied.has(item.id) || !available(item.id) || !usable(plan.tiles[index])) return 0
        let gain = 0
        visit(index, item, i => {
          if (!own[i] && plan.tiles[i] === 'crop') gain += complementary[i] ? 20 : seed ? 3 : 0
        })
        if (plan.tiles[index] === 'crop') {
          if (own[index] && complementary[index]) gain -= 20
          else if (seed) gain -= 3
        }
        // Coverage dominates; deterministic ties favor compact starts and reuse.
        const reuse = itemId(original.tiles[index]) === item.id ? 0.12 : 0
        const edgeDistance = index % plan.width + Math.floor(index / plan.width)
        const weight = costMode && variantIndex !== 2 ? costs.get(item.id)! : 1
        return gain > 0 ? gain / weight + reuse - edgeDistance * 0.0001 : 0
      }
      for (const item of unlocked.filter(item => item.kind === kind && available(item.id))) {
        for (let index = 0; index < plan.tiles.length; index++) {
          const value = score(index, item)
          if (value > 0) heap.push({ index, item, score: value })
        }
      }
      for (let candidate = heap.pop(); candidate && limit > 0; candidate = heap.pop()) {
        const { index, item } = candidate
        const value = score(index, item)
        if (value <= 0) continue
        if (value < candidate.score) {
          heap.push({ ...candidate, score: value })
          continue
        }
        used[item.id]++
        const feasible = !constrained || (materials!.fits(used) && (!reserveComplement || complement.some(entry => {
          used[entry.id]++
          const fits = materials!.fits(used)
          used[entry.id]--
          return fits
        })))
        if (!feasible) {
          used[item.id]--
          denied.add(item.id)
          continue
        }
        plan.tiles[index] = item.id
        limit--
        visit(index, item, i => own[i]++)
      }
    }

    function prune(target?: number) {
      let full = statistics(plan, maps).full
      const positions = plan.tiles.flatMap((tile, index) => itemId(tile) && !tile.startsWith('!') ? [index] : []).reverse()
      if (costMode && target !== undefined) {
        positions.sort((a, b) => costs.get(itemId(plan.tiles[b])!)! - costs.get(itemId(plan.tiles[a])!)!)
      }
      for (const index of positions) {
        const tile = plan.tiles[index]
        const id = itemId(tile)
        if (!id || tile.startsWith('!')) continue
        if (target === undefined && original.strategy === 'rework' && original.tiles[index] === tile) continue
        const item = game.placedItems.get(id)!
        const own = maps[item.kind]
        const complementary = maps[item.kind === 'water' ? 'guard' : 'water']
        const participates = required.includes(item.kind)
        let delta = Number(usableOriginal[index] === 'crop' && Boolean(own[index] && complementary[index]))
        visit(index, item, i => {
          if (participates && plan.tiles[i] === 'crop' && own[i] === 1 && complementary[i]) delta--
        })
        if (target === undefined ? delta < 0 : full + delta < target) continue
        plan.tiles[index] = usableOriginal[index]
        used[id]--
        full += delta
        visit(index, item, i => own[i]--)
      }
    }

    fill(first, true, constrained && variantIndex === 2 ? 1 : Infinity)
    fill(other, true)
    fill(first, false)
    fill(other, false)
    prune()
    consider(plan)
    if ((original.strategy === 'low' || costMode) && statistics(plan, maps).full >= original.target) {
      prune(original.target)
      consider(plan)
    }
    progress(Math.round(100 * (variantIndex + 1) / variants.length))
  }

  const result = best!
  return {
    plan: result.plan, full: result.full,
    shortfall: original.strategy === 'low' || costMode ? Math.max(0, original.target - result.full) : 0,
    crafting: constrained ? materials!.proposal(result.plan) : undefined,
  }
}
