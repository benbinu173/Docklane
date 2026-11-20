import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir } from 'node:fs/promises'

test.use({ trace: 'off', screenshot: 'off', reducedMotion: 'reduce' })
test.describe.configure({ timeout: 120_000 })
type Account = { email: string; password: string; role: string }
let accounts: Account[]
test.beforeAll(async () => {
  const saved = JSON.parse(await readFile('.local/demo-accounts.json', 'utf8'))
  if (
    process.env.DOCKLANE_AUTH_E2E !== '1' ||
    process.env.ALLOW_DEVELOPMENT_SEED !== 'true' ||
    saved.authUrl !== process.env.NEON_AUTH_BASE_URL
  )
    throw new Error('Run the protected browser checks against the configured development branch.')
  accounts = saved.accounts
})
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
})
async function login(page: Page, role = 'ADMIN') {
  const account = accounts.find((a) => a.role === role)!
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  const request = page.waitForRequest((r) => r.url().endsWith('/api/v1/me'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const headers = (await request).headers()
  await expect(page).toHaveURL(role === 'CUSTOMER' ? /\/account\/orders$/ : /\/workspace$/)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  return {
    Authorization: headers.authorization,
    'X-Docklane-Session': headers['x-docklane-session'],
  }
}
async function scan(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze()
  expect(
    result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
test('dashboard queues reconcile with saved lists and filtered context survives a detail round trip', async ({
  page,
  request,
}) => {
  const headers = await login(page)
  const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:4000'
  const response = await request.get(`${apiUrl}/api/v1/workspace`, { headers })
  expect(response.status()).toBe(200)
  const data = (await response.json()).data
  await expect(page.getByRole('heading', { name: 'Make the next move.' })).toBeVisible()
  for (const [key, label] of [
    ['pack', 'Ready to pack'],
    ['ship', 'Ready to ship'],
    ['refund', 'Refunds in progress'],
  ]) {
    const link = page.locator('.p7-attention a').filter({ hasText: label })
    await expect(link.locator('b')).toHaveText(String(data.queues[key]))
  }
  await page
    .locator('.p7-attention')
    .getByRole('link', { name: /Ready to pack/ })
    .click()
  await expect(page.getByRole('combobox', { name: 'Filter order queue' })).toHaveValue('pack')
  const filtered = await request.get(`${apiUrl}/api/v1/orders?queue=pack`, { headers })
  const orders = (await filtered.json()).data
  if (orders.length) {
    await expect(page.locator('tbody tr')).toHaveCount(orders.length)
    await page.getByRole('link', { name: `Open order ${orders[0].number}` }).click()
    await expect(page.getByRole('heading', { name: orders[0].number, exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'All orders', exact: true }).click()
    await expect(page).toHaveURL(/queue=pack/)
  }
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Filter order queue' })).toHaveValue('pack')
})
test('personal order and inventory views survive reload, restore filters, and can be removed', async ({
  page,
}) => {
  await login(page)
  for (const [kind, path, filter, value] of [
    ['orders', '/workspace/orders', 'Filter saved fulfillment status', 'PACKED'],
    ['inventory', '/workspace/inventory', 'Filter stock warehouse', 'kochi'],
  ]) {
    await page.goto(path)
    await expect(page.getByRole('combobox', { name: filter })).toBeVisible()
    await page.getByRole('combobox', { name: filter }).selectOption(value)
    await page.getByRole('button', { name: 'Save view', exact: true }).click()
    await page.getByLabel('View name', { exact: true }).fill(`Phase 7 ${kind} check`)
    await page.getByRole('button', { name: 'Save personal view', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save view', exact: true })).toBeFocused()
    await page.reload()
    const select = page.getByRole('combobox', { name: `Saved ${kind} views` })
    await expect(select.locator('option')).toContainText([`Phase 7 ${kind} check`])
    if (kind === 'orders') await page.getByRole('button', { name: 'Reset order filters' }).click()
    else await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await select.selectOption({ label: `Phase 7 ${kind} check` })
    await expect(page.getByRole('combobox', { name: filter })).toHaveValue(value)
    await page.getByRole('button', { name: 'Remove saved view', exact: true }).click()
    await expect(select.locator('option')).not.toContainText([`Phase 7 ${kind} check`])
  }
})
test('quick search supports keyboard selection, closes with Escape, and returns focus', async ({
  page,
}) => {
  await login(page)
  const trigger = page.getByRole('button', { name: 'Open quick search' })
  await trigger.focus()
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: 'Quick search' })).toBeVisible()
  const input = page.getByRole('combobox', { name: 'Search Docklane' })
  await input.fill('DL-10023')
  await expect(page.locator('[cmdk-item]').filter({ hasText: 'DL-10023' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await input.fill('Inventory')
  await expect(page.locator('[cmdk-item]').filter({ hasText: 'Inventory' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/workspace\/inventory$/)
})
test('saved order filters recover from a failed read without losing input', async ({ page }) => {
  await login(page)
  await page.route('**/api/v1/orders?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Temporary verification outage. Retry this view.',
        },
      }),
    }),
  )
  await page.goto('/workspace/orders?q=DL-10023&payment=CAPTURED')
  await expect(page.getByRole('alert')).toContainText('Temporary verification outage')
  await expect(page.getByRole('textbox', { name: 'Search saved orders' })).toHaveValue('DL-10023')
  await expect(page.getByRole('combobox', { name: 'Filter saved payment status' })).toHaveValue(
    'CAPTURED',
  )
  await page.unroute('**/api/v1/orders?**')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open order DL-10023' })).toBeVisible()
})
test('background refresh pauses for input and dialogs, resumes, and stops after two minutes', async ({
  page,
}) => {
  await login(page)
  await page.clock.install()
  let reads = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/workspace') reads++
  })
  await page.goto('/workspace')
  await expect(page.getByRole('heading', { name: 'Make the next move.' })).toBeVisible()
  await expect(page.locator('.p7-metrics')).toBeVisible()
  // Let session restoration finish before pausing the browser's timers.
  await page.clock.pauseAt(new Date(Date.now() + 1000))
  const initial = reads
  await page.getByRole('combobox', { name: 'Filter overview warehouse' }).focus()
  await page.clock.runFor(31_000)
  expect(reads).toBe(initial)
  const search = page.getByRole('button', { name: 'Open quick search' })
  await search.focus()
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/workspace',
  )
  await page.clock.runFor(31_000)
  await refreshed
  expect(reads).toBe(initial + 1)
  await search.click()
  await expect(page.getByRole('dialog', { name: 'Quick search' })).toBeVisible()
  await page.clock.runFor(31_000)
  expect(reads).toBe(initial + 1)
  await page.keyboard.press('Escape')
  await page.clock.runFor(1)
  await expect(search).toBeFocused()
  // Let React apply the deadline update before advancing through further polling periods.
  await page.clock.runFor(28_000)
  await page.clock.runFor(42_000)
  expect(reads).toBe(initial + 1)
  // Manual refresh stays available after the bounded background window.
  const manual = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/workspace',
  )
  await page.getByRole('button', { name: 'Refresh overview' }).click()
  await manual
  expect(reads).toBe(initial + 2)
})
test('connected overview, order filters and search pass responsive accessibility checks', async ({
  page,
}) => {
  await mkdir('docs/previews', { recursive: true })
  await login(page)
  for (const width of [390, 768, 1366, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto('/workspace')
    await expect(page.getByRole('heading', { name: 'Make the next move.' })).toBeVisible()
    await scan(page)
    if ([390, 1366].includes(width))
      await page.screenshot({ path: `docs/previews/phase7-overview-${width}.png`, fullPage: true })
    await page.goto('/workspace/orders')
    await expect(page.locator('tbody tr').first()).toBeVisible()
    await scan(page)
    if ([390, 1366].includes(width))
      await page.screenshot({ path: `docs/previews/phase7-orders-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Open quick search' }).click()
    await expect(page.getByRole('combobox', { name: 'Search Docklane' })).toBeFocused()
    await scan(page)
    await page.keyboard.press('Escape')
  }
})
test('customer navigation, order filters, collection and keyboard search stay usable', async ({
  page,
}) => {
  await login(page, 'CUSTOMER')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('combobox', { name: 'Filter saved fulfillment status' }),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Filter saved order warehouse' })).toHaveCount(0)
  await scan(page)
  await page.getByRole('button', { name: 'Open quick search' }).click()
  await page.getByRole('combobox', { name: 'Search Docklane' }).fill('Collection')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/account\/catalog$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await scan(page)
})
