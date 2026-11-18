import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { registerGame } from '../src/equipment.ts'
import { adaptGame, validatePackage } from '../src/game.ts'
import { coverage, statistics, visitCoverage } from '../src/coverage.ts'
import { calculateBom } from '../src/bom.ts'
import { countEquipment, itemId, newPlan, resize } from '../src/model.ts'
import { changes, optimize } from '../src/optimizer.ts'
import { preset } from '../src/presets.ts'
import { deserialize, loadWorkspace, saveWorkspace, serialize } from '../src/storage.ts'

const bundled = Object.fromEntries(
  ['game', 'items', 'equipment', 'recipes', 'presets', 'seasons', 'crops'].map((name) => [
    name,
    JSON.parse(readFileSync(new URL(`../public/games/coral-island/${name}.json`, import.meta.url), 'utf8')),
  ]),
)
const adapter = adaptGame(validatePackage(bundled))
registerGame(adapter, true)
const { placables: equipment, placedItems: items, presets } = adapter
const radii: Record<string, number> = { s1: 1, s2: 2, s3: 4, c1: 2, c2: 5, c3: 9 }
const usedOnly = (plan: ReturnType<typeof newPlan>) =>
  Object.fromEntries(Object.entries(countEquipment(plan)).filter(([, count]) => count > 0))
for (const item of equipment) {
  test(item.name + ' uses exact Chebyshev coverage', () => {
    const radius = radii[item.id] ?? 5
    assert.equal(item.radius, radius)
    const plan = newPlan(21, 21)
    const center = 10 * 21 + 10
    plan.tiles[center] = item.id
    const map = coverage(plan)[item.kind]
    assert.equal(map[center], 0)
    assert.equal(
      map.reduce((a, b) => a + b),
      (2 * radius + 1) ** 2 - 1,
    )
    assert.equal(map[(10 + radius) * 21 + 10 + radius], 1)
    assert.equal(map[(10 + radius + 1) * 21 + 10], 0)
  })
}

test('all 25 scarecrows have a source, an unlock and a calculable BOM', () => {
  const scarecrows = equipment.filter((item) => item.kind === 'guard')
  assert.equal(scarecrows.length, 25)
  for (const item of scarecrows) {
    assert.ok(item.unlock, item.name)
    assert.match(
      adapter.recipeOptions.get(item.id)?.[0].source ?? '',
      /^https:\/\/coralisland\.fandom\.com\//,
    )
    assert.equal(
      calculateBom({ ...adapter, targets: [{ itemId: item.id, quantity: 1 }] }).shopping.some(
        (row) => row.unknown,
      ),
      false,
      item.name,
    )
  }
  const starter = calculateBom({ ...adapter, targets: [{ itemId: 'c1', quantity: 1 }] })
  assert.equal(starter.shopping.find((row) => row.id === 'wood')?.required, 15)
  assert.equal(starter.shopping.find((row) => row.id === 'trash')?.required, 10)
  const ultimate = calculateBom({ ...adapter, targets: [{ itemId: 'c3', quantity: 1 }] })
  assert.equal(ultimate.shopping.find((row) => row.id === 'osmium_ore')?.required, 5)
  assert.equal(ultimate.shopping.find((row) => row.id === 'battery')?.required, 2)
})

test('coverage clips to rectangular boundaries without row wrap', () => {
  const visited: number[] = []
  visitCoverage(5, 3, 0, 2, (index) => visited.push(index))
  assert.deepEqual(visited, [1, 2, 5, 6, 7, 10, 11, 12])
})

test('crop statistics exclude equipment and terrain and count overlap', () => {
  const plan = preset('starter')
  plan.tiles[0] = 'rock'
  plan.tiles[2] = 'path'
  plan.tiles[4] = 'empty'
  const result = statistics(plan)
  assert.equal(result.farmland, 18)
  assert.equal(result.crops, 17)
  assert.equal(result.full, 17)
  assert.equal(result.watered, 17)
  assert.equal(result.protected, 17)
  assert.equal(result.perSprinkler, 4.25)
  assert.equal(result.perEquipment, 3.4)
  assert.ok(result.overlap > 0)
  assert.ok(result.wasted > 0)
})

const expected = [7, 20, 184, 96, 320, 0]
for (const [index, entry] of presets.entries()) {
  test(entry.name + ' resolves to the expected fully covered crop count', () => {
    const plan = preset(entry.id)
    assert.equal(statistics(plan).full, expected[index])
    assert.equal(plan.tiles.length, plan.width * plan.height)
    if (entry.id === 'expanded') assert.deepEqual(usedOnly(plan), { s1: 24, c1: 9 })
  })
}

test('seven is the maximum possible for Minimal Resources', () => {
  const plan = newPlan(5, 5)
  let best = 0
  for (let s = 0; s < 25; s++)
    for (let c = 0; c < 25; c++) {
      if (s === c) continue
      plan.tiles.fill('crop')
      plan.tiles[s] = 's1'
      plan.tiles[c] = 'c1'
      best = Math.max(best, statistics(plan).full)
    }
  assert.equal(best, 7)
  const minimal = preset('minimal')
  assert.ok(coverage(minimal).guard[minimal.tiles.indexOf('s1')])
})

test('JSON and local persistence round-trip named plans, terrain, tiers and locks', () => {
  const plan = preset('starter')
  plan.tiles.splice(0, 4, 'rock', 'path', 'empty', '!s1')
  plan.inventory.s2 = 7
  plan.limited = true
  plan.progression = 'custom'
  plan.unlocked = ['s2', 'c2']
  assert.deepEqual(deserialize(serialize(plan)), plan)
  let data = ''
  const storage = {
    setItem: (_key: string, value: string) => {
      data = value
    },
    getItem: () => data,
  }
  const workspace = {
    current: plan,
    active: 'farm-id',
    saved: [
      { id: 'farm-id', plan },
      { id: 'other', plan: preset('mid') },
    ],
  }
  saveWorkspace(storage, workspace)
  assert.deepEqual(loadWorkspace(storage, newPlan(2, 2)), workspace)
  assert.throws(
    () => deserialize(JSON.stringify({ version: 1, plan: { ...plan, tiles: ['bad'] } })),
    /Invalid farm tiles/,
  )
  assert.throws(
    () =>
      deserialize(
        JSON.stringify({ version: 1, plan: { ...plan, inventory: { ...plan.inventory, s1: -1 } } }),
      ),
    /Invalid equipment/,
  )
})

test('resizing remaps overlapping coordinates without collision', () => {
  const plan = preset('starter')
  const result = resize(plan, 8, 6)
  assert.equal(result.tiles[2 * 8 + 2], 'c1')
  assert.equal(result.tiles[2 * 5 + 2], 'crop')
  assert.equal(result.tiles.length, 48)
})

test('optimizer fits four early sprinklers around one scarecrow on a 5×5 farm', () => {
  const plan = newPlan(5, 5)
  plan.limited = true
  plan.inventory.s1 = 4
  plan.inventory.c1 = 1
  const result = optimize(plan)
  assert.equal(result.full, 20)
  assert.equal(statistics(result.plan).full, 20)
  assert.deepEqual(usedOnly(result.plan), { s1: 4, c1: 1 })
})

test('all strategies enforce inventory and preserve obstacles, reserved paths and equipment locks', () => {
  const plan = newPlan(16, 14)
  plan.progression = 'custom'
  plan.unlocked = ['s1', 's2', 'c2']
  plan.limited = true
  plan.inventory = { s1: 7, s2: 1, s3: 9, c1: 0, c2: 2, c3: 9 }
  plan.tiles.splice(0, 5, 'rock', 'rock', 'path', '!s1', '!c2')
  plan.tiles[84] = 'path'
  plan.tiles[90] = 'rock'
  for (const strategy of ['maximum', 'low', 'balanced', 'rework'] as const) {
    const input = { ...plan, strategy, target: 45 }
    const { plan: result, full } = optimize(input)
    const stats = statistics(result)
    assert.ok(full > 0)
    assert.equal(stats.full, full)
    assert.equal(result.tiles.length, input.width * input.height)
    const placed = result.tiles.map((tile, index) => ({ tile, index })).filter(({ tile }) => itemId(tile))
    assert.equal(placed.length, stats.sprinklers + stats.scarecrows)
    for (const { tile, index } of placed) {
      assert.ok(input.unlocked.includes(itemId(tile)!))
      assert.ok(!['rock', 'path'].includes(input.tiles[index]))
      assert.ok(items.has(itemId(tile)!))
    }
    for (const index of [0, 1, 2, 3, 4, 84, 90]) assert.equal(result.tiles[index], input.tiles[index])
    for (const item of equipment) assert.ok(stats.used[item.id] <= (input.inventory[item.id] ?? 0))
    assert.deepEqual(optimize(input).plan, result)
  }
})

test('optimizer uses mixed tiers when it can increase production', () => {
  const plan = newPlan(9, 9)
  plan.progression = 'mid'
  plan.limited = true
  plan.inventory = { s1: 6, s2: 1, s3: 0, c1: 0, c2: 1, c3: 0 }
  const result = optimize(plan).plan
  const used = countEquipment(result)
  assert.ok(used.s1 > 0)
  assert.equal(used.s2, 1)
  assert.equal(used.c2, 1)
})

test('optimizer reports a target shortfall and rejects infeasible locked inventory', () => {
  const plan = newPlan(5, 5)
  plan.strategy = 'low'
  plan.target = 8
  plan.limited = true
  plan.inventory = { s1: 1, s2: 0, s3: 0, c1: 1, c2: 0, c3: 0 }
  const result = optimize(plan)
  assert.equal(result.full, 7)
  assert.equal(result.shortfall, 1)
  plan.tiles[0] = '!s1'
  plan.tiles[1] = '!s1'
  assert.throws(() => optimize(plan), /Locked equipment exceeds inventory/)
})

test('low resources prunes equipment while maintaining a reachable target', () => {
  const plan = preset('mid')
  plan.strategy = 'low'
  plan.target = 10
  const result = optimize(plan)
  const stats = statistics(result.plan)
  assert.ok(stats.full >= 10)
  assert.equal(stats.sprinklers + stats.scarecrows, 2)
  assert.equal(result.shortfall, 0)
})

test('upgrade comparison reports relocated equipment separately', () => {
  const before = preset('starter')
  const after = { ...before, tiles: [...before.tiles] }
  after.tiles[6] = 'crop'
  after.tiles[0] = 's1'
  after.tiles[18] = 's2'
  assert.deepEqual(changes(before, after), { added: 1, removed: 1, moved: 1 })
})

test('the Mid Game preset puts the unwatered cross outside usable farmland', () => {
  assert.equal(statistics(preset('mid')).efficiency, 100)
})
