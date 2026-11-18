import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import { calculateBom } from '../src/bom.ts'
import type { CraftingCatalog, ItemDefinition } from '../src/crafting-types.ts'

const item = (id: string, category: ItemDefinition['category'] = 'crafted_component'): ItemDefinition => ({
  id,
  name: id,
  category,
  acquisition: category === 'raw_resource' ? ['mining'] : ['crafting'],
})
const quantity = (itemId: string, quantity: number) => ({ itemId, quantity })
const catalog: CraftingCatalog = {
  items: [
    item('radio'),
    item('antenna'),
    item('circuit'),
    item('wire'),
    item('copper', 'raw_resource'),
    item('unknown'),
  ],
  recipes: [
    { id: 'radio', output: quantity('radio', 1), ingredients: [quantity('circuit', 2), quantity('wire', 1)] },
    { id: 'antenna', output: quantity('antenna', 1), ingredients: [quantity('wire', 3)] },
    { id: 'circuit', output: quantity('circuit', 1), ingredients: [quantity('wire', 2)] },
    { id: 'draw-wire', output: quantity('wire', 3), ingredients: [quantity('copper', 2)] },
  ],
}

void test('BOM and its generic types have no planner, UI or storage imports', () => {
  const moduleReferences = (name: string) => {
    const source = readFileSync(new URL('../src/' + name, import.meta.url), 'utf8')
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
    const references: string[] = []
    function visit(node: import('typescript').Node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
          references.push(node.moduleSpecifier.text)
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        references.push(node.argument.literal.text)
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(file) === 'require')
      ) {
        references.push(node.arguments[0]?.getText(file) ?? '(dynamic import)')
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    return references
  }
  assert.deepEqual(moduleReferences('bom.ts'), ['./crafting-types.ts'])
  assert.deepEqual(moduleReferences('crafting-types.ts'), [])
})

void test('arbitrary non-farm targets share stock, intermediates and rounding in one calculation', () => {
  const inventory = { copper: 1, wire: 1, circuit: 1 }
  const targets = [quantity('radio', 1), quantity('antenna', 1), quantity('antenna', 1)]
  const request = { ...catalog, targets, inventory, options: { selections: { wire: 'missing-choice' } } }
  const original = structuredClone(request)
  const result = calculateBom(request)
  assert.deepEqual(
    result.roots.map(({ id, required }) => [id, required]),
    [
      ['radio', 1],
      ['antenna', 2],
    ],
  )
  assert.deepEqual(
    [...result.consumed],
    [
      ['circuit', 1],
      ['wire', 1],
      ['copper', 1],
    ],
  )
  assert.deepEqual(result.intermediates.map((row) => [row.id, row.batches]).sort(), [
    ['circuit', 1],
    ['wire', 3],
  ])
  assert.equal(result.surplus.get('wire'), 1)
  assert.deepEqual(
    result.rawMaterials.map((row) => [row.id, row.required, row.owned, row.remaining]),
    [['copper', 6, 1, 5]],
  )
  assert.deepEqual(
    result.deficits.map((row) => row.id),
    ['copper'],
  )
  assert.ok(result.warnings[0].includes('Using the default'))
  const order = result.steps.map((row) => row.id)
  assert.ok(order.indexOf('wire') < order.indexOf('circuit'))
  assert.ok(order.indexOf('circuit') < order.indexOf('radio'))
  assert.deepEqual(request, original)
})

void test('missing recipes are unresolved and invalid recipe data fails safely without a game loader', () => {
  const result = calculateBom({ ...catalog, targets: [quantity('unknown', 2)] })
  assert.deepEqual(
    result.unresolved.map((row) => [row.id, row.remaining]),
    [['unknown', 2]],
  )
  assert.equal(result.feasible, false)
  const edge = { id: 'broken', output: quantity('unknown', 1), ingredients: [quantity('missing-item', 1)] }
  assert.throws(
    () => calculateBom({ ...catalog, recipes: [...catalog.recipes, edge], targets: [] }),
    /Unknown recipe item/,
  )
  assert.throws(
    () =>
      calculateBom({
        ...catalog,
        recipes: [...catalog.recipes, { ...edge, ingredients: [quantity('unknown', 1)] }],
        targets: [],
      }),
    /circular recipe dependencies/,
  )
  assert.throws(
    () => calculateBom({ ...catalog, targets: [], inventory: { copper: -1 } }),
    /Invalid inventory quantity/,
  )
})
