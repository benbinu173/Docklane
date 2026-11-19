import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
})

test('inventory combines filters and preserves its view after reload', async ({ page }) => {
  await page.goto('/inventory')
  await page.getByRole('button', { name: /Low stock/, exact: false }).click()
  await page.getByRole('combobox', { name: 'Filter by warehouse' }).click()
  await page.getByRole('option', { name: 'Bengaluru East' }).click()
  await page.getByRole('textbox', { name: 'Search inventory' }).fill('SUN-006')
  await expect(page.locator('.inventory-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.inventory-table tbody')).toContainText('Acetate Sunglasses')
  await expect(page).toHaveURL(/warehouse=bengaluru/)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Search inventory' })).toHaveValue('SUN-006')
  await expect(page.locator('.inventory-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.locator('.result-count')).toHaveText('24 results')
})

test('inventory sorting, pagination, and exports operate on the filtered dataset', async ({
  page,
}) => {
  await page.goto('/inventory')
  await page.getByRole('button', { name: 'Sort by Available', exact: true }).click()
  await expect(page.locator('.inventory-table tbody tr').first()).toContainText('Out of stock')
  await page.getByRole('button', { name: 'Next inventory page' }).click()
  await expect(page.locator('.pagination')).toContainText('Page 2 of 3')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export inventory', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('docklane-inventory-demo.csv')
  const content = await readFile((await download.path())!, 'utf8')
  expect(content.split('\r\n')).toHaveLength(25)
  expect(content).toContain('"Reserved"')
})

test('order details restore focus and packing updates the filtered order list', async ({
  page,
}) => {
  await page.goto('/orders?stage=ready&q=Aditi')
  const trigger = page.getByRole('button', { name: 'Open order DL-2048', exact: true })
  await trigger.click()
  await expect(page.getByRole('dialog', { name: 'DL-2048', exact: true })).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'DL-2048', exact: true })
  await expect(dialog.getByRole('heading', { name: 'DL-2048', exact: true })).toBeInViewport()
  await expect.poll(async () => (await dialog.boundingBox())?.x).toBe(950)
  expect((await dialog.boundingBox())!.y).toBe(0)
  expect((await dialog.boundingBox())!.height).toBe(900)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole('button', { name: 'Mark packed', exact: true }).click()
  await expect(page.getByRole('dialog').locator('.status')).toHaveText('Packed')
  await expect(page.getByRole('button', { name: 'Mark shipped', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByText('No orders match this view', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/stage=ready/)
  await page
    .getByRole('button', { name: /Packed/, exact: false })
    .first()
    .click()
  await expect(page.locator('.orders-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.orders-table tbody')).toContainText('Packed')
})

test('the keyboard command menu opens matching order details and supports deep links', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your day, in motion.' })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search pages, products, and orders' }).fill('Riya Nair')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'DL-2038', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Await payment' })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'DL-2038', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/order=/)
})

test('sample adjustments protect reserved units and propagate to the stock table', async ({
  page,
}) => {
  await page.goto('/inventory?q=AUD-001&warehouse=kochi')
  await page
    .getByRole('button', { name: 'Open Studio Headphones AUD-001 at Kochi', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Studio Headphones', exact: true })
  await expect(
    dialog.getByRole('heading', { name: 'Studio Headphones', exact: true }),
  ).toBeInViewport()
  expect((await dialog.boundingBox())!.y).toBe(0)
  await page.getByRole('button', { name: 'Adjust sample stock', exact: true }).click()
  await page.getByLabel('Quantity change', { exact: true }).fill('-1000')
  await page.getByLabel('Reason', { exact: true }).fill('Sample correction')
  await page.getByRole('button', { name: 'Save demo adjustment' }).click()
  await expect(page.locator('.form-error')).toContainText('reserved units')
  await page.getByLabel('Quantity change', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Save demo adjustment' }).click()
  await expect(page.locator('.stock-detail-numbers')).toContainText('96')
  await page.keyboard.press('Escape')
  await expect(page.locator('.inventory-table tbody')).toContainText('96')
  await page.reload()
  await expect(page.locator('.inventory-table tbody')).toContainText('86')
})

test('loading, empty, and error previews have usable recovery', async ({ page }) => {
  for (const state of ['Loading', 'Empty workspace', 'Unavailable']) {
    await page.goto('/settings')
    await page.getByRole('radio', { name: new RegExp(`^${state}`) }).check()
    await page.getByRole('button', { name: 'View this state in the overview' }).click()
    if (state === 'Loading')
      await expect(page.locator('[aria-label="Loading workspace"]')).toBeVisible()
    else if (state === 'Empty workspace')
      await expect(page.getByText('A fresh start for your operations')).toBeVisible()
    else await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Return to demo', exact: false }).click()
    await expect(page.locator('.fulfillment-flow')).toBeVisible()
  }
})

test('mobile navigation and full-width details remain keyboard usable with reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const navigation = page.getByRole('dialog', { name: 'Main navigation', exact: true })
  expect((await navigation.boundingBox())!.x).toBe(0)
  expect((await navigation.boundingBox())!.y).toBe(0)
  expect((await navigation.boundingBox())!.height).toBe(844)
  await page
    .getByRole('dialog', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: /^Orders/ })
    .click()
  await expect(page.getByRole('dialog', { name: 'Main navigation', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: 'Open order DL-2048', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'DL-2048', exact: true })
  await expect(dialog).toBeVisible()
  expect((await dialog.boundingBox())!.width).toBe(390)
  expect((await dialog.boundingBox())!.x).toBe(0)
  expect((await dialog.boundingBox())!.y).toBe(0)
  expect((await dialog.boundingBox())!.height).toBe(844)
  await expect(dialog.getByRole('heading', { name: 'DL-2048', exact: true })).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open order DL-2048', exact: true })).toBeFocused()
})

test('signature views and order details pass automated accessibility checks', async ({ page }) => {
  for (const path of ['/', '/inventory', '/orders', '/orders?order=DL-2048']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    if (path.includes('order=')) await expect(page.getByRole('dialog')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze()
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      })),
      path,
    ).toEqual([])
  }
})

for (const width of [390, 768, 1366, 1440]) {
  test(`main views fit a ${width}px viewport without page overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    for (const path of [
      '/',
      '/inventory',
      '/orders',
      '/warehouses',
      '/payments',
      '/activity',
      '/settings',
    ]) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
      expect(overflow, `${path} overflows at ${width}px`).toBe(false)
      const brokenImages = await page
        .locator('img')
        .evaluateAll(
          (images) =>
            images.filter(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0,
            ).length,
        )
      expect(brokenImages).toBe(0)
    }
  })
}
