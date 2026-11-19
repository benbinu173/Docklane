import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type {
  InventoryRecord,
  OrderDetail,
  OrderSummary,
  ProductRecord,
  WarehouseRecord,
} from '@docklane/contracts'

test.use({ trace: 'off', screenshot: 'off', reducedMotion: 'reduce' })
test.describe.configure({ timeout: 180_000 })
type Headers = Record<string, string>
type Fixture = { sku: string; warehouseId: string; stockId: string }
let accounts: { role: string; email: string; password: string }[]
const apiUrl = `${process.env.VITE_API_URL ?? 'http://127.0.0.1:4000'}/api/v1`
test.beforeAll(async () => {
  const saved = JSON.parse(await readFile('.local/demo-accounts.json', 'utf8'))
  if (
    process.env.DOCKLANE_AUTH_E2E !== '1' ||
    process.env.ALLOW_DEVELOPMENT_SEED !== 'true' ||
    saved.authUrl !== process.env.NEON_AUTH_BASE_URL
  )
    throw new Error('Use the guarded development Auth runner.')
  accounts = saved.accounts
})
async function login(page: Page, role: string): Promise<Headers> {
  const account = accounts.find((account) => account.role === role)!
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  const pending = page.waitForRequest((request) => request.url().endsWith('/api/v1/me'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const headers = (await pending).headers()
  await expect(page).toHaveURL(role === 'CUSTOMER' ? /\/account\/orders$/ : /\/workspace$/, {
    timeout: 45_000,
  })
  return {
    Authorization: headers.authorization,
    'X-Docklane-Session': headers['x-docklane-session'],
  }
}
async function call<T>(
  request: APIRequestContext,
  headers: Headers,
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(apiUrl + path, {
    headers,
    method,
    ...(data ? { data } : {}),
  })
  expect(
    response.ok(),
    `Verification endpoint ${method} ${path} returned ${response.status()}`,
  ).toBe(true)
  return (await response.json()).data as T
}
async function fixture(request: APIRequestContext, headers: Headers): Promise<Fixture> {
  const sku = `BAG-${randomUUID().slice(0, 8).toUpperCase()}`
  await call(request, headers, '/products', 'POST', {
    sku,
    name: 'Everyday Carry Bag',
    category: 'Accessories',
    pricePaise: 49950,
    image: '/images/weekender.jpg',
  })
  const site = await call<WarehouseRecord>(request, headers, '/warehouses', 'POST', {
    code: sku,
    name: 'Kochi Studio',
    city: 'Kochi',
    address: 'Isolated checkout verification site',
    lead: 'Browser Check',
    priority: 900,
  })
  const stock = await call<InventoryRecord>(request, headers, '/inventory', 'POST', {
    sku,
    warehouseId: site.id,
  })
  await call(request, headers, `/inventory/${stock.id}/adjustments`, 'POST', {
    type: 'INCREASE',
    quantity: 10,
    reason: 'Open checkout browser fixture',
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  })
  return { sku, warehouseId: site.id, stockId: stock.id }
}
async function cleanup(request: APIRequestContext, headers: Headers, f: Fixture) {
  const orders = await call<OrderSummary[]>(
    request,
    headers,
    `/orders?warehouse=${f.warehouseId}&pageSize=100`,
  )
  for (const order of orders)
    if (order.orderStatus === 'AWAITING_PAYMENT')
      await call(request, headers, `/orders/${order.id}/cancellations`, 'POST', {
        reason: 'Clear checkout browser fixture hold',
        idempotencyKey: randomUUID(),
      })
  const stock = await call<InventoryRecord>(request, headers, `/inventory/${f.stockId}`)
  expect(stock.reserved).toBe(0)
  if (stock.onHand)
    await call(request, headers, `/inventory/${stock.id}/adjustments`, 'POST', {
      type: 'SET',
      quantity: 0,
      reason: 'Clear checkout browser fixture',
      expectedVersion: stock.version,
      idempotencyKey: randomUUID(),
    })
  const products = await call<ProductRecord[]>(
      request,
      headers,
      `/products?q=${f.sku}&archive=all`,
    ),
    product = products.find((product) => product.sku === f.sku)!
  expect(product.name).toBe('Everyday Carry Bag')
  if (!product.archived)
    await call(request, headers, `/products/${f.sku}`, 'PATCH', {
      archived: true,
      expectedVersion: product.version,
    })
  const site = await call<WarehouseRecord>(request, headers, `/warehouses/${f.warehouseId}`)
  if (!site.archived)
    await call(request, headers, `/warehouses/${site.id}`, 'PATCH', {
      archived: true,
      expectedVersion: site.version,
    })
}
async function bag(page: Page, f: Fixture, quantity = 2) {
  await page.goto(`/account/catalog/${f.sku}`)
  await page.getByLabel('Quantity', { exact: true }).fill(String(quantity))
  await page.getByRole('button', { name: 'Add to bag' }).click()
  await page.goto('/account/cart')
  await expect(page.getByRole('heading', { name: 'A bag full of good things.' })).toBeVisible()
  await expect(page.locator('.p4-bag-item')).toHaveCount(1)
}
async function review(page: Page) {
  await page.goto('/account/checkout')
  await page.getByLabel('Street address', { exact: true }).fill('12 Garden Lane')
  await page.getByLabel('City', { exact: true }).fill('Kochi')
  await page.getByLabel('PIN code', { exact: true }).fill('682001')
  await page.getByRole('button', { name: 'Review order', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Looks good. Let’s hold it.' })).toBeVisible()
}
async function reserve(page: Page): Promise<OrderDetail> {
  const result = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/orders') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Reserve order', exact: true }).click()
  const response = await result
  expect(response.status()).toBe(201)
  const order = (await response.json()).data as OrderDetail
  await expect(page).toHaveURL(new RegExp(`/account/orders/${order.id}$`))
  return order
}
async function scan(page: Page) {
  await expect(page.locator('.p3-state')).toHaveCount(0, { timeout: 45_000 })
  await expect(page.locator('.connected-spinner')).toHaveCount(0, { timeout: 45_000 })
  await page.evaluate(() => document.fonts.ready)
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze()
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
async function capture(page: Page, path: string) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  })
  await page.mouse.move(0, 0)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await page.screenshot({ path, fullPage: true })
}
test('Customer bag survives reload, reserves server-priced stock, and cancels with one release', async ({
  page,
  browser,
  request,
}) => {
  const admin = await browser.newPage(),
    headers = await login(admin, 'ADMIN'),
    f = await fixture(request, headers)
  try {
    await login(page, 'CUSTOMER')
    await bag(page, f)
    await page.reload()
    await expect(page.locator('.p4-bag-quantity input')).toHaveValue('2')
    await review(page)
    const order = await reserve(page)
    expect(order.totalPaise).toBe(99900)
    expect(order.deliveryAddress).toMatchObject({ city: 'Kochi', postalCode: '682001' })
    expect(order.paymentStatus).toBe('PENDING')
    expect(
      (await call<InventoryRecord>(request, headers, `/inventory/${f.stockId}`)).reserved,
    ).toBe(2)
    await admin.goto(`/workspace/orders?q=${order.number}&warehouse=${f.warehouseId}`)
    await expect(
      admin.getByRole('link', { name: `Open order ${order.number}`, exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Cancel unpaid order', exact: true }).click()
    await page.getByLabel('Reason for cancellation', { exact: true }).fill('Changed my plans')
    await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
    await expect(page.getByText('Cancelled · stock released', { exact: true })).toBeVisible()
    expect(
      (await call<InventoryRecord>(request, headers, `/inventory/${f.stockId}`)).reserved,
    ).toBe(0)
  } finally {
    await cleanup(request, headers, f)
    await admin.close()
  }
})
test('A lost order response survives reload, retries once, and preserves later bag additions', async ({
  page,
  browser,
  request,
}) => {
  const admin = await browser.newPage(),
    headers = await login(admin, 'ADMIN'),
    f = await fixture(request, headers)
  try {
    await login(page, 'CUSTOMER')
    await bag(page, f)
    await review(page)
    let created: OrderDetail | undefined,
      originalKey = ''
    await page.route('**/api/v1/orders', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      originalKey = route.request().postDataJSON().idempotencyKey
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      created = (await response.json()).data
      await route.abort('failed')
    })
    await page.getByRole('button', { name: 'Reserve order', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Retry same reservation', exact: true }),
    ).toBeVisible()
    await page.unroute('**/api/v1/orders')
    await page.goto(`/account/catalog/${f.sku}`)
    await page.getByRole('button', { name: 'Add to bag' }).click()
    await page.goto('/account/checkout')
    await page.reload()
    const retry = page.waitForRequest(
      (request) => request.url().endsWith('/api/v1/orders') && request.method() === 'POST',
    )
    await page.getByRole('button', { name: 'Retry same reservation', exact: true }).click()
    expect((await retry).postDataJSON().idempotencyKey).toBe(originalKey)
    await expect(page).toHaveURL(new RegExp(`/account/orders/${created!.id}$`))
    await page.goto('/account/cart')
    await expect(page.locator('.p4-bag-quantity input')).toHaveValue('1')
    expect(
      (await call<InventoryRecord>(request, headers, `/inventory/${f.stockId}`)).reserved,
    ).toBe(2)
    expect(
      await call<OrderSummary[]>(request, headers, `/orders?warehouse=${f.warehouseId}`),
    ).toHaveLength(1)
  } finally {
    await cleanup(request, headers, f)
    await admin.close()
  }
})
test('A changed price requires another review and unavailable quantities block checkout', async ({
  page,
  browser,
  request,
}) => {
  const admin = await browser.newPage(),
    headers = await login(admin, 'ADMIN'),
    f = await fixture(request, headers)
  try {
    await login(page, 'CUSTOMER')
    await bag(page, f, 11)
    await expect(page.getByRole('link', { name: 'Continue to delivery' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await page.locator('.p4-bag-quantity input').fill('2')
    await review(page)
    const products = await call<ProductRecord[]>(request, headers, `/products?q=${f.sku}`)
    await call(request, headers, `/products/${f.sku}`, 'PATCH', {
      pricePaise: 59950,
      expectedVersion: products[0].version,
    })
    await page.getByRole('button', { name: 'Reserve order', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Refresh the order review')
    expect(
      (await call<InventoryRecord>(request, headers, `/inventory/${f.stockId}`)).reserved,
    ).toBe(0)
    await expect(page.locator('.p4-totals')).toContainText('1,199')
    const order = await reserve(page)
    expect(order.totalPaise).toBe(119900)
  } finally {
    await cleanup(request, headers, f)
    await admin.close()
  }
})
test('Bag, delivery, review, order journey, and cancellation pass responsive accessibility checks', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(360_000)
  await mkdir('docs/previews', { recursive: true })
  const admin = await browser.newPage(),
    headers = await login(admin, 'ADMIN'),
    f = await fixture(request, headers)
  try {
    await login(page, 'CUSTOMER')
    await bag(page, f)
    for (const width of [390, 768, 1366, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
      await page.goto('/account/cart')
      await expect(page.locator('.p4-summary')).toBeVisible()
      await scan(page)
      if ([390, 1366].includes(width)) await capture(page, `docs/previews/phase4-bag-${width}.png`)
      await page.goto('/account/checkout')
      await expect(page.getByLabel('Street address', { exact: true })).toBeVisible()
      await scan(page)
      if ([390, 1366].includes(width))
        await capture(page, `docs/previews/phase4-delivery-${width}.png`)
      await page.getByRole('button', { name: 'Review order', exact: true }).click()
      await expect(page.getByLabel('Street address', { exact: true })).toHaveAttribute(
        'aria-invalid',
        'true',
      )
      await scan(page)
      await review(page)
      await scan(page)
      if ([390, 1366].includes(width))
        await capture(page, `docs/previews/phase4-review-${width}.png`)
    }
    const order = await reserve(page)
    for (const width of [390, 768, 1366, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
      await page.goto(`/account/orders/${order.id}`)
      await expect(
        page.getByRole('button', { name: 'Cancel unpaid order', exact: true }),
      ).toBeVisible()
      await scan(page)
      if ([390, 1366].includes(width))
        await capture(page, `docs/previews/phase4-order-${width}.png`)
      await page.getByRole('button', { name: 'Cancel unpaid order', exact: true }).click()
      await scan(page)
      await page.keyboard.press('Escape')
    }
  } finally {
    await cleanup(request, headers, f)
    await admin.close()
  }
})
