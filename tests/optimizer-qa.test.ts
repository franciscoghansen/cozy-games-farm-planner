import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { registerGame } from '../src/equipment.ts'
import { adaptGame, validatePackage } from '../src/game.ts'
import { mergedInventory, newPlan } from '../src/model.ts'
import { optimize } from '../src/optimizer.ts'
import { statistics } from '../src/coverage.ts'

const pack = validatePackage(
  JSON.parse(readFileSync(new URL('./fixtures/meadow-test.game.json', import.meta.url), 'utf8')),
)
pack.equipment.find((item) => item.itemId === 'deluxe')!.radius = 4
pack.game.defaultInventory = { deluxe: 4 }
registerGame(adaptGame(pack), true)

test('optimized high-tier equipment is removed when deselected, even at lower production', () => {
  const before = newPlan(7, 7)
  before.unlocked = ['orb', 'tower', 'deluxe']
  const upgraded = optimize(before).plan
  assert.ok(statistics(upgraded).used.deluxe > 0)
  const result = optimize({ ...upgraded, unlocked: ['orb', 'tower'] }).plan
  assert.equal(statistics(result).used.deluxe, 0)
  assert.ok(statistics(result).used.orb > 0)
})

test('preserve variants keep manual locks and drop other deselected placements', () => {
  const before = newPlan(7, 7)
  before.tiles[10] = 'deluxe'
  before.tiles[25] = '!deluxe'
  before.unlocked = ['orb', 'tower']
  before.strategy = 'rework'
  const { plan, warnings } = optimize(before)
  assert.equal(plan.tiles[25], '!deluxe')
  assert.ok(!plan.tiles.includes('deluxe'))
  assert.match(warnings.join(' '), /1 manually locked Deluxe Orb/)
})

test('optimizer rejects missing required kinds before doing work', () => {
  const plan = newPlan(5, 5)
  plan.unlocked = ['orb']
  assert.throws(
    () => optimize(plan, () => assert.fail('Optimization should not run')),
    /Select at least one watering and one protection item/,
  )
})

test('new stock starts empty and limited optimization uses nonzero material stock without hiding zero counts', () => {
  const plan = newPlan(5, 5)
  plan.limited = true
  assert.equal(plan.inventory.deluxe, 0)
  assert.deepEqual(mergedInventory({ orb: 4, ore: 2 }, { orb: 0, tower: 4 }), { orb: 4, ore: 2, tower: 4 })
  const { plan: result, warnings } = optimize(plan, undefined, { inventory: { orb: 4, tower: 4 } })
  assert.ok(statistics(result).used.orb > 0)
  assert.equal(statistics(result).used.deluxe, 0)
  assert.ok(warnings.includes('Deluxe Orb is selected but you own 0.'))
})
