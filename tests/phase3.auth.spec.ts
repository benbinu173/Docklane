import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { InventoryRecord, ProductRecord, WarehouseRecord } from '@docklane/contracts'

test.use({ trace: 'off', screenshot: 'off', reducedMotion: 'reduce' })
test.describe.configure({ timeout: 180_000 })
type Headers = Record<string, string>
type Fixture = { sku: string; warehouseId?: string; stockId?: string }
let accounts: { email: string; password: string; role: string }[]
const apiUrl = `${process.env.VITE_API_URL ?? 'http://127.0.0.1:4000'}/api/v1`
test.beforeAll(async () => {
  const saved = JSON.parse(await readFile('.local/demo-accounts.json', 'utf8'))
  if (
    process.env.DOCKLANE_AUTH_E2E !== '1' ||
    process.env.ALLOW_DEVELOPMENT_SEED !== 'true' ||
    saved.authUrl !== process.env.NEON_AUTH_BASE_URL
  )
    throw new Error('Use npm run test:auth -- --phase3 with the configured development branch.')
  accounts = saved.accounts
})
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
})
async function login(page: Page, role: string): Promise<Headers> {
  const account = accounts.find((account) => account.role === role)!
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  const request = page.waitForRequest((request) => request.url().endsWith('/api/v1/me'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const headers = (await request).headers()
  await expect(page).toHaveURL(role === 'CUSTOMER' ? /\/account\/orders$/ : /\/workspace$/, {
    timeout: 45_000,
  })
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({
    timeout: 45_000,
  })
  return {
    Authorization: headers.authorization,
    'X-Docklane-Session': headers['x-docklane-session'],
  }
}
async function logout(page: Page) {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/auth\/sign-in/)
}
async function read<T>(request: APIRequestContext, headers: Headers, path: string): Promise<T> {
  const response = await request.get(apiUrl + path, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()).data
}
async function cleanup(request: APIRequestContext, headers: Headers, fixture: Fixture) {
  if (fixture.stockId) {
    const stock = await read<InventoryRecord>(request, headers, `/inventory/${fixture.stockId}`)
    if (stock.onHand)
      expect(
        (
          await request.post(`${apiUrl}/inventory/${stock.id}/adjustments`, {
            headers,
            data: {
              type: 'SET',
              quantity: 0,
              reason: 'Phase 3 browser fixture cleanup',
              expectedVersion: stock.version,
              idempotencyKey: randomUUID(),
            },
          })
        ).status(),
      ).toBe(200)
  }
  const products = await read<ProductRecord[]>(
    request,
    headers,
    `/products?q=${fixture.sku}&archive=all`,
  )
  const product = products.find((product) => product.sku === fixture.sku)
  if (product && !product.archived)
    expect(
      (
        await request.patch(`${apiUrl}/products/${fixture.sku}`, {
          headers,
          data: { archived: true, expectedVersion: product.version },
        })
      ).status(),
    ).toBe(200)
  if (fixture.warehouseId) {
    const warehouse = await read<WarehouseRecord>(
      request,
      headers,
      `/warehouses/${fixture.warehouseId}`,
    )
    if (!warehouse.archived)
      expect(
        (
          await request.patch(`${apiUrl}/warehouses/${warehouse.id}`, {
            headers,
            data: { archived: true, expectedVersion: warehouse.version },
          })
        ).status(),
      ).toBe(200)
  }
}
async function createFixture(request: APIRequestContext, headers: Headers): Promise<Fixture> {
  const sku = `CHECK-${randomUUID().slice(0, 8).toUpperCase()}`
  expect(
    (
      await request.post(`${apiUrl}/products`, {
        headers,
        data: { sku, name: `Browser item ${sku}`, category: 'Verification', pricePaise: 49950 },
      })
    ).status(),
  ).toBe(201)
  const warehouse = await request.post(`${apiUrl}/warehouses`, {
    headers,
    data: {
      name: `Browser site ${sku}`,
      code: sku,
      city: 'Kochi',
      address: 'Development test site, Kochi',
      lead: 'Browser Check',
      priority: 900,
    },
  })
  expect(warehouse.status()).toBe(201)
  const warehouseId = (await warehouse.json()).data.id as string
  const balance = await request.post(`${apiUrl}/inventory`, { headers, data: { sku, warehouseId } })
  expect(balance.status()).toBe(201)
  return { sku, warehouseId, stockId: (await balance.json()).data.id }
}
async function review(page: Page, quantity: number, reason: string, type = 'INCREASE') {
  await page.getByRole('combobox', { name: 'Adjustment type', exact: true }).selectOption(type)
  await page.getByLabel('Quantity', { exact: true }).fill(String(quantity))
  await page.getByLabel('Reason', { exact: true }).fill(reason)
  await page.getByRole('button', { name: 'Review adjustment', exact: true }).click()
  await expect(page.getByLabel('Review stock adjustment')).toBeVisible()
}
async function scan(page: Page) {
  await expect(page.locator('.connected-layout')).toBeVisible({ timeout: 45_000 })
  if (!(await page.getByRole('dialog').count()))
    await expect(page.locator('.connected-layout h1')).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('.connected-spinner')).toHaveCount(0, { timeout: 45_000 })
  await expect(page.locator('.p3-state')).toHaveCount(0, { timeout: 45_000 })
  await page.evaluate(() => document.fonts.ready)
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze()
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
}

test('Admin creates catalog and warehouse records, saves stock, edits details, and archives safely', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'ADMIN'),
    fixture: Fixture = { sku: `UI-${randomUUID().slice(0, 8).toUpperCase()}` }
  const productName = `Field notes ${fixture.sku}`,
    siteName = `Harbour ${fixture.sku}`
  try {
    await page.getByRole('link', { name: 'Products', exact: true }).click()
    await page.getByRole('button', { name: 'New product', exact: true }).click()
    await page.getByLabel('Product name', { exact: true }).fill(productName)
    await page.getByLabel('SKU', { exact: true }).fill(fixture.sku)
    await page.getByLabel('Category', { exact: true }).fill('Stationery')
    await page.getByLabel('Price (INR)', { exact: true }).fill('499.50')
    await page.getByRole('button', { name: 'Create product', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Search saved products' }).fill(fixture.sku)
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody tr')).toContainText('₹499.5')
    await page.getByRole('button', { name: `Edit ${productName}`, exact: true }).click()
    await expect(page.getByLabel('SKU', { exact: true })).toHaveAttribute('readonly', '')
    await page.getByLabel('Price (INR)', { exact: true }).fill('599.25')
    await page.getByRole('button', { name: 'Save product', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('link', { name: 'Warehouses', exact: true }).click()
    await page.getByRole('button', { name: 'New warehouse', exact: true }).click()
    await page.getByLabel('Warehouse name', { exact: true }).fill(siteName)
    await page.getByLabel('Site code', { exact: true }).fill(fixture.sku)
    await page.getByLabel('City', { exact: true }).fill('Kochi')
    await page
      .getByLabel('Street address', { exact: true })
      .fill('Phase 3 verification site, Kochi')
    await page.getByLabel('Site lead', { exact: true }).fill('Browser Check')
    await page.getByRole('button', { name: 'Create warehouse', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const sites = await read<WarehouseRecord[]>(request, headers, `/warehouses?q=${fixture.sku}`)
    fixture.warehouseId = sites[0].id
    await page.getByRole('link', { name: 'Inventory', exact: true }).click()
    await page.getByRole('button', { name: 'Track stock', exact: true }).click()
    await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption(fixture.sku)
    await page
      .getByRole('combobox', { name: 'Warehouse', exact: true })
      .selectOption(fixture.warehouseId)
    await page.getByRole('button', { name: 'Create stock level', exact: true }).click()
    await expect(page.getByRole('dialog', { name: productName })).toBeVisible()
    fixture.stockId = new URL(page.url()).searchParams.get('stockId')!
    await expect(page.locator('.p3-stock-counts dd')).toHaveText(['0', '0', '0'])
    await review(page, 12, 'Opening supplier delivery')
    await page.getByRole('button', { name: 'Confirm adjustment', exact: true }).click()
    await expect(page.locator('.p3-stock-counts dd')).toHaveText(['12', '0', '12'])
    await expect(page.locator('.p3-history')).toContainText('Opening supplier delivery')
    await page.locator('.p3-threshold summary').click()
    await page.getByLabel('Threshold', { exact: true }).fill('15')
    await page
      .getByLabel('Reason for threshold change', { exact: true })
      .fill('Weekly replenishment target')
    await page.getByRole('button', { name: 'Save threshold', exact: true }).click()
    await expect(page.locator('.p3-threshold summary')).toContainText('15 units')
    await page.reload()
    await expect(page.locator('.p3-stock-counts dd')).toHaveText(['12', '0', '12'])
    await expect(page.locator('.p3-history')).toContainText('Opening supplier delivery')
    await page.keyboard.press('Escape')
    await page.goto(`/workspace/warehouses/${fixture.warehouseId}`)
    await expect(page.getByRole('heading', { name: siteName, exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Warehouse stock', exact: true })).toContainText(
      productName,
    )
    await page.getByRole('button', { name: 'Edit warehouse', exact: true }).click()
    await page.getByLabel('Site lead', { exact: true }).fill('Updated Site Lead')
    await page.getByRole('button', { name: 'Save warehouse', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.p3-site-detail')).toContainText('Updated Site Lead')
    await page.getByRole('button', { name: 'Archive warehouse', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Archive warehouse', exact: true })
      .click()
    await expect(page.getByRole('alert')).toContainText('Clear stock')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(`/workspace/inventory?stockId=${fixture.stockId}`)
    await review(page, 0, 'Physical stock cleared for archive', 'SET')
    await page.getByRole('button', { name: 'Confirm adjustment', exact: true }).click()
    await expect(page.locator('.p3-stock-counts dd')).toHaveText(['0', '0', '0'])
    await page.keyboard.press('Escape')
    await page.goto(`/workspace/products?q=${fixture.sku}`)
    await page.getByRole('button', { name: `Archive ${productName}`, exact: true }).click()
    await page.getByRole('button', { name: 'Archive product', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Filter product status' }).selectOption('archived')
    await page.getByRole('button', { name: `Restore ${productName}`, exact: true }).click()
    await page.getByRole('button', { name: 'Restore product', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goto(`/workspace/warehouses/${fixture.warehouseId}`)
    await page.getByRole('button', { name: 'Archive warehouse', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Archive warehouse', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Restore warehouse', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Restore warehouse', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Restore warehouse', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(
      (await read<{ pricePaise: number }>(request, headers, `/catalog/${fixture.sku}`)).pricePaise,
    ).toBe(59925)
  } finally {
    await cleanup(request, headers, fixture)
    await logout(page)
  }
})

test('Stale edits can reload and a lost adjustment response retries without adding stock twice', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'ADMIN'),
    fixture = await createFixture(request, headers)
  try {
    await page.goto(`/workspace/inventory?stockId=${fixture.stockId}`)
    await expect(page.locator('.p3-stock-counts dd')).toHaveText(['0', '0', '0'])
    expect(
      (
        await request.post(`${apiUrl}/inventory/${fixture.stockId}/adjustments`, {
          headers,
          data: {
            type: 'INCREASE',
            quantity: 4,
            reason: 'Concurrent supplier delivery',
            expectedVersion: 0,
            idempotencyKey: randomUUID(),
          },
        })
      ).status(),
    ).toBe(200)
    await review(page, 2, 'Stale browser correction')
    await page.getByRole('button', { name: 'Confirm adjustment', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('changed while you were editing')
    await page.getByRole('button', { name: 'Reload latest count', exact: true }).click()
    await expect(page.locator('.p3-stock-counts dd')).toHaveText(['4', '0', '4'])
    let commands = 0
    await page.route(`**/api/v1/inventory/${fixture.stockId}/adjustments`, async (route) => {
      commands++
      if (commands === 1) {
        await route.fetch()
        await route.abort('failed')
      } else await route.continue()
    })
    await review(page, 3, 'Retry after a lost response')
    await page.getByRole('button', { name: 'Confirm adjustment', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm adjustment', exact: true }).click()
    await expect(page.locator('.p3-stock-counts dd')).toHaveText(['7', '0', '7'])
    expect(commands).toBe(2)
    await page.unroute(`**/api/v1/inventory/${fixture.stockId}/adjustments`)
    const movements = await read<{ reason: string }[]>(
      request,
      headers,
      `/inventory/${fixture.stockId}/movements`,
    )
    expect(
      movements.filter((movement) => movement.reason === 'Retry after a lost response'),
    ).toHaveLength(1)
  } finally {
    await cleanup(request, headers, fixture)
    await logout(page)
  }
})

test('Operator saves counts, composes filters, and cannot consume reserved stock or manage catalog', async ({
  page,
  request,
}) => {
  let headers = await login(page, 'ADMIN')
  const fixture = await createFixture(request, headers)
  await logout(page)
  headers = await login(page, 'OPERATOR')
  try {
    await page.goto('/workspace/products')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New product', exact: true })).toHaveCount(0)
    expect(
      (
        await request.post(`${apiUrl}/products`, {
          headers,
          data: { sku: 'DENIED-001', name: 'Denied item', category: 'Test', pricePaise: 100 },
        })
      ).status(),
    ).toBe(403)
    await page.goto('/workspace/warehouses')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New warehouse', exact: true })).toHaveCount(0)
    await page.goto(`/workspace/inventory?stockId=${fixture.stockId}`)
    await review(page, 6, 'Operator counted received goods')
    await page.getByRole('button', { name: 'Confirm adjustment', exact: true }).click()
    await expect(page.locator('.p3-stock-counts dd')).toHaveText(['6', '0', '6'])
    await page.keyboard.press('Escape')
    await page.goto('/workspace/inventory')
    await page.getByRole('textbox', { name: 'Search saved inventory' }).fill('AUD-001')
    await page.getByRole('combobox', { name: 'Filter stock warehouse' }).selectOption('kochi')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Search saved inventory' })).toHaveValue(
      'AUD-001',
    )
    await expect(page.getByRole('combobox', { name: 'Filter stock warehouse' })).toHaveValue(
      'kochi',
    )
    await page.getByRole('button', { name: /^Open stock .*AUD-001 at / }).click()
    await review(page, 0, 'Reserved stock guard verification', 'SET')
    await expect(page.getByRole('alert')).toContainText('reserved stock')
    await expect(
      page.getByRole('button', { name: 'Confirm adjustment', exact: true }),
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^Open stock .*AUD-001 at / })).toBeFocused()
  } finally {
    await logout(page)
    headers = await login(page, 'ADMIN')
    await cleanup(request, headers, fixture)
    await logout(page)
  }
})

test('Customer browses saved catalog prices and categories with no staff inventory access', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'CUSTOMER')
  await page.getByRole('link', { name: 'Collection', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Small finds. Good everyday.' })).toBeVisible()
  const products = await read<
    { sku: string; pricePaise: number; category: string; name: string }[]
  >(request, headers, '/catalog')
  const product = products[0]
  await page.getByRole('textbox', { name: 'Search catalog' }).fill(product.sku)
  await expect(page.locator('.p3-shop-product')).toHaveCount(1)
  await page.getByRole('button', { name: product.category, exact: true }).click()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Search catalog' })).toHaveValue(product.sku)
  await expect(page.locator('.p3-shop-product')).toHaveCount(1)
  await page.locator('.p3-shop-product').click()
  await expect(page.getByRole('heading', { name: product.name, exact: true })).toBeVisible()
  const displayPrice = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(product.pricePaise / 100)
  await expect(page.locator('.p3-detail-price')).toHaveText(displayPrice)
  await expect(page.getByRole('button', { name: 'Add to bag' })).toBeVisible()
  expect((await request.get(`${apiUrl}/inventory`, { headers })).status()).toBe(403)
  expect((await request.get(`${apiUrl}/products`, { headers })).status()).toBe(403)
  await page.goto('/workspace/inventory')
  await expect(page).toHaveURL(/\/account\/orders$/)
  await logout(page)
})

test('An authenticated account can retry a failed API lookup without re-entering its password', async ({
  page,
}) => {
  const account = accounts.find((account) => account.role === 'ADMIN')!
  await page.route('**/api/v1/me', (route) => route.abort('failed'))
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable', {
    timeout: 30_000,
  })
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(account.email)
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await page.unroute('**/api/v1/me')
  await page.getByRole('button', { name: 'Retry opening account', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 45_000 })
  await expect(page.getByRole('heading', { name: 'Your day, moving forward.' })).toBeVisible()
  await logout(page)
})

test('Inventory, editors, explorer, and catalog pass responsive accessibility checks', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000)
  await mkdir('docs/previews', { recursive: true })
  const headers = await login(page, 'ADMIN')
  const stocks = await read<InventoryRecord[]>(
    request,
    headers,
    '/inventory?q=AUD-001&warehouse=kochi',
  )
  for (const width of [390, 768, 1366, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
    for (const [path, name] of [
      ['/workspace/inventory', 'inventory'],
      ['/workspace/products', 'products'],
      ['/workspace/warehouses', 'warehouses'],
      ['/workspace/warehouses/kochi', 'warehouse-detail'],
    ]) {
      await page.goto(path)
      await page.getByRole('heading', { level: 1 }).waitFor()
      await scan(page)
      if ([390, 1366].includes(width))
        await page.screenshot({ path: `docs/previews/phase3-${name}-${width}.png`, fullPage: true })
    }
    await page.goto(`/workspace/inventory?stockId=${stocks[0].id}`)
    await page.getByRole('dialog').getByRole('heading', { name: stocks[0].product.name }).waitFor()
    await expect(page.locator('.p3-stock-counts dd')).toHaveCount(3)
    await scan(page)
    if ([390, 1366].includes(width))
      await page.screenshot({ path: `docs/previews/phase3-stock-drawer-${width}.png` })
    await page.keyboard.press('Escape')
    await page.goto('/workspace/products')
    await page.getByRole('button', { name: 'New product', exact: true }).click()
    await scan(page)
    await page.keyboard.press('Escape')
    await page.goto('/workspace/warehouses')
    await page.getByRole('button', { name: 'New warehouse', exact: true }).click()
    await scan(page)
    await page.keyboard.press('Escape')
  }
  await logout(page)
  await login(page, 'CUSTOMER')
  for (const width of [390, 768, 1366, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
    await page.goto('/account/catalog')
    await expect(page.locator('.p3-shop-product').first()).toBeVisible()
    await scan(page)
    if ([390, 1366].includes(width))
      await page.screenshot({ path: `docs/previews/phase3-catalog-${width}.png`, fullPage: true })
    await page.locator('.p3-shop-product').first().click()
    await expect(page.locator('.p3-product-detail')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await scan(page)
  }
  await logout(page)
})
