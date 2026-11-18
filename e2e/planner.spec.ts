import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function checkAccessibility(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const findings = violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    targets: nodes.map(({ target }) => target),
  }))
  const advisory = findings.filter(({ impact }) => impact !== 'critical' && impact !== 'serious')
  if (advisory.length) console.info(`axe ${name} advisories:`, advisory.map(({ id }) => id).join(', '))
  if (findings.length) {
    await test.info().attach(`axe-${name}.json`, {
      body: JSON.stringify(findings, null, 2),
      contentType: 'application/json',
    })
  }
  expect(
    findings.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
    name,
  ).toEqual([])
}

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The smoke suite requires a preview URL.')
  const origin = new URL(baseURL).origin
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) await route.continue()
    else await route.abort()
  })
})

test('starts with the default game and accessible farm controls', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Farm Planner', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Game', exact: true })).toHaveValue('coral-island')
  const nav = page.getByRole('navigation', { name: 'Planner views' })
  for (const view of ['Materials', 'Crafting Planner', 'Crops', 'Game data']) {
    await expect(nav.getByRole('button', { name: view, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/franciscoghansen/cozy-games-farm-planner',
  )
  await checkAccessibility(page, 'farm')
  await page.getByRole('button', { name: 'Layouts', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Farm layouts' })).toBeVisible()
  await checkAccessibility(page, 'layouts-dialog')
  expect(errors).toEqual([])
})

test('places equipment and saves a layout across reload in an isolated workspace', async ({
  page,
  browser,
  baseURL,
}) => {
  const openLayouts = () => page.getByRole('button', { name: 'Layouts', exact: true }).click()
  await page.goto('./')
  const sprinklerUsed = page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Sprinkler I', exact: true }) })
    .getByRole('cell')
    .first()
  const before = Number(await sprinklerUsed.innerText())
  await page.getByRole('combobox', { name: 'Watering equipment placement tool' }).selectOption('s1')
  const grid = page.getByLabel('Editable farm grid')
  await grid.press('ArrowRight')
  await grid.press('Enter')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
  await expect(sprinklerUsed).toHaveText(String(before + 1))

  await openLayouts()
  const dialog = page.getByRole('dialog', { name: 'Farm layouts' })
  await dialog.getByRole('textbox', { name: 'Layout name' }).fill('Smoke test farm')
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  await expect(page.getByRole('heading', { name: 'Smoke test farm' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Smoke test farm' })).toBeVisible()
  await expect(sprinklerUsed).toHaveText(String(before + 1))
  await openLayouts()
  await expect(dialog.getByRole('button', { name: 'Smoke test farm Open', exact: true })).toBeVisible()

  const fresh = await browser.newContext({ baseURL })
  try {
    const blank = await fresh.newPage()
    await blank.goto('./')
    await blank.getByRole('button', { name: 'Layouts', exact: true }).click()
    await expect(blank.getByText('No named layouts saved yet.')).toBeVisible()
  } finally {
    await fresh.close()
  }
})

test('calculates a crafting target and returns to the farm', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Crafting Planner', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Crafting Planner' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Item to add' }).selectOption('s1')
  await page.getByRole('button', { name: 'Add target' }).click()
  await expect(page.getByRole('spinbutton', { name: /sprinkler.*target quantity/i })).toHaveValue('1')
  await expect(page.getByText(/[1-9][0-9]* raw resource units/)).toBeVisible()
  await checkAccessibility(page, 'crafting')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Crafting Planner' })).toBeVisible()
  await page.getByRole('button', { name: 'Farm layout', exact: true }).click()
  await expect(page.getByLabel('Editable farm grid')).toBeVisible()
})

test('recommends crops for a selected date and reloads a saved plan', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Crops', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Seasonal Crop Planner' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Season', exact: true }).selectOption('summer')
  await page.getByRole('spinbutton', { name: 'Current day' }).fill('2')
  await page.getByRole('button', { name: 'Recommend crops' }).click()
  await expect(page.getByText('Recommendation updated.')).toBeVisible()
  await checkAccessibility(page, 'crops')
  await page.getByRole('textbox', { name: 'Plan name' }).fill('Smoke test summer')
  await page.getByRole('button', { name: 'Save crop plan' }).click()
  await expect(page.getByText('Saved Smoke test summer.')).toBeVisible()
  await page.reload()
  const plan = page.getByRole('listitem').filter({ hasText: 'Smoke test summer' })
  await plan.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByRole('combobox', { name: 'Season', exact: true })).toHaveValue('summer')
  await expect(page.getByRole('spinbutton', { name: 'Current day' })).toHaveValue('2')
})
