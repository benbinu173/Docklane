import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type {
  OrderDetail,
  InventoryRecord,
  ProductRecord,
  WarehouseRecord,
} from '@docklane/contracts'

test.use({ trace: 'off', screenshot: 'off', reducedMotion: 'reduce' })
test.describe.configure({ timeout: 180_000 })
type Headers = Record<string, string>
const apiUrl = `${process.env.VITE_API_URL ?? 'http://127.0.0.1:4000'}/api/v1`
let accounts: { role: string; email: string; password: string }[]
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
async function login(page: Page, role: string) {
  const a = accounts.find((a) => a.role === role)!
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill(a.email)
  await page.getByLabel('Password', { exact: true }).fill(a.password)
  const pending = page.waitForRequest((r) => r.url().endsWith('/api/v1/me'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const h = (await pending).headers()
  await expect(page).toHaveURL(role === 'CUSTOMER' ? /\/account\/orders$/ : /\/workspace$/, {
    timeout: 45_000,
  })
  return { Authorization: h.authorization, 'X-Docklane-Session': h['x-docklane-session'] }
}
async function call<T>(
  request: APIRequestContext,
  headers: Headers,
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const r = await request.fetch(apiUrl + path, { method, headers, ...(data ? { data } : {}) })
  expect(r.ok(), `Verification endpoint ${method} ${path} returned ${r.status()}`).toBe(true)
  return (await r.json()).data as T
}
async function fixture(request: APIRequestContext, admin: Headers, customer: Headers) {
  const sku = `PAY-${randomUUID().slice(0, 8).toUpperCase()}`
  await call(request, admin, '/products', 'POST', {
    sku,
    name: 'Everyday Carry Bag',
    category: 'Accessories',
    pricePaise: 49950,
    image: '/images/weekender.jpg',
  })
  const warehouse = await call<WarehouseRecord>(request, admin, '/warehouses', 'POST', {
    code: sku,
    name: 'Kochi Studio',
    city: 'Kochi',
    address: 'Isolated payment screen verification site',
    lead: 'Browser Check',
    priority: 900,
  })
  const stock = await call<InventoryRecord>(request, admin, '/inventory', 'POST', {
    sku,
    warehouseId: warehouse.id,
  })
  await call(request, admin, `/inventory/${stock.id}/adjustments`, 'POST', {
    type: 'INCREASE',
    quantity: 5,
    reason: 'Open payment browser fixture',
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  })
  const items = [{ sku, quantity: 2 }],
    quote = await call<{ quoteFingerprint: string }>(request, customer, '/checkout/quote', 'POST', {
      items,
    })
  const order = await call<OrderDetail>(request, customer, '/orders', 'POST', {
    items,
    quoteFingerprint: quote.quoteFingerprint,
    deliveryAddress: { line: '12 Garden Lane', city: 'Kochi', postalCode: '682001', country: 'IN' },
    idempotencyKey: randomUUID(),
  })
  return { sku, warehouseId: warehouse.id, stockId: stock.id, order }
}
async function cleanup(
  request: APIRequestContext,
  admin: Headers,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const saved = await call<OrderDetail>(request, admin, `/orders/${f.order.id}`)
  if (saved.orderStatus === 'AWAITING_PAYMENT')
    await call(request, admin, `/orders/${saved.id}/cancellations`, 'POST', {
      reason: 'Clear payment browser fixture',
      idempotencyKey: randomUUID(),
    })
  const stock = await call<InventoryRecord>(request, admin, `/inventory/${f.stockId}`)
  expect(stock.reserved).toBe(0)
  if (stock.onHand)
    await call(request, admin, `/inventory/${stock.id}/adjustments`, 'POST', {
      type: 'SET',
      quantity: 0,
      reason: 'Clear payment fixture stock',
      expectedVersion: stock.version,
      idempotencyKey: randomUUID(),
    })
  const products = await call<ProductRecord[]>(request, admin, `/products?q=${f.sku}&archive=all`),
    product = products.find((p) => p.sku === f.sku)!
  await call(request, admin, `/products/${f.sku}`, 'PATCH', {
    archived: true,
    expectedVersion: product.version,
  })
  const warehouse = await call<WarehouseRecord>(request, admin, `/warehouses/${f.warehouseId}`)
  await call(request, admin, `/warehouses/${warehouse.id}`, 'PATCH', {
    archived: true,
    expectedVersion: warehouse.version,
  })
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
async function capture(page: Page, file: string) {
  await mkdir('docs/previews', { recursive: true })
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' })
}

test('payment screens recover errors and rely on the saved order after a return URL', async ({
  page,
  request,
  browser,
}) => {
  const staff = await browser.newContext(),
    adminPage = await staff.newPage(),
    admin = await login(adminPage, 'ADMIN'),
    customer = await login(page, 'CUSTOMER'),
    f = await fixture(request, admin, customer)
  let order = f.order,
    attempts = 0
  try {
    await page.route('**/api/v1/payments/configuration', (route) =>
      route.fulfill({ json: { data: { enabled: true, testMode: true } } }),
    )
    await page.route(`**/api/v1/orders/${order.id}`, (route) =>
      route.fulfill({ json: { data: order } }),
    )
    await page.route(`**/api/v1/orders/${order.id}/payment-sessions`, (route) => {
      attempts++
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'PAYMENT_PROVIDER_UNAVAILABLE',
            message: 'Checkout could not be confirmed. Retry the same payment.',
            requestId: randomUUID(),
          },
        },
      })
    })
    await page.goto(`/account/orders/${order.id}?payment=return&paid=true`)
    await expect(page.getByRole('heading', { name: 'One last step. Make it yours.' })).toBeVisible()
    await expect(page.getByText('You’re back. Checking the final payment result…')).toBeVisible()
    await page.getByRole('button', { name: 'Continue to test payment' }).click()
    await expect(page.getByRole('alert')).toContainText('Checkout could not be confirmed')
    await page.getByRole('button', { name: 'Resume test checkout' }).click()
    expect(attempts).toBe(2)
    order = {
      ...order,
      payment: { provider: 'stripe_test', sessionStarted: true, refundStatus: null },
    }
    await page.reload()
    await expect(page.getByRole('button', { name: 'Resume test checkout' })).toBeVisible()
    order = {
      ...order,
      orderStatus: 'CONFIRMED',
      paymentStatus: 'CAPTURED',
      confirmedAt: new Date().toISOString(),
      reservations: order.reservations.map((r) => ({ ...r, status: 'ALLOCATED' })),
    }
    await page.getByRole('button', { name: 'Refresh saved result' }).click()
    await expect(
      page.getByRole('heading', { name: 'Payment confirmed. Next stop, fulfillment.' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resume test checkout' })).toHaveCount(0)
    await scan(page)
  } finally {
    await cleanup(request, admin, f)
    await staff.close()
  }
})
test('payment, expiry, and refund states remain accessible at desktop and mobile widths', async ({
  page,
  request,
  browser,
}) => {
  const staff = await browser.newContext(),
    admin = await login(await staff.newPage(), 'ADMIN'),
    customer = await login(page, 'CUSTOMER'),
    f = await fixture(request, admin, customer)
  let order = f.order
  try {
    await page.route('**/api/v1/payments/configuration', (route) =>
      route.fulfill({ json: { data: { enabled: false, testMode: true } } }),
    )
    await page.route(`**/api/v1/orders/${order.id}`, (route) =>
      route.fulfill({ json: { data: order } }),
    )
    for (const width of [390, 768, 1366, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const state of [
        'pending',
        'failed',
        'confirmed',
        'expired',
        'refund-pending',
        'refunded',
      ]) {
        const terminal = ['expired', 'refund-pending', 'refunded'].includes(state)
        order = {
          ...f.order,
          orderStatus: terminal
            ? 'EXPIRED'
            : state === 'confirmed'
              ? 'CONFIRMED'
              : 'AWAITING_PAYMENT',
          paymentStatus:
            state === 'failed'
              ? 'FAILED'
              : state === 'confirmed'
                ? 'CAPTURED'
                : state === 'refund-pending'
                  ? 'REFUND_PENDING'
                  : state === 'refunded'
                    ? 'REFUNDED'
                    : 'PENDING',
          expiredAt: terminal ? new Date().toISOString() : null,
          confirmedAt: state === 'confirmed' ? new Date().toISOString() : null,
          reservations: f.order.reservations.map((r) => ({
            ...r,
            status: terminal ? 'RELEASED' : state === 'confirmed' ? 'ALLOCATED' : 'HELD',
          })),
        }
        await page.goto(`/account/orders/${order.id}`)
        await expect(page.locator('.p5-payment-story h2')).toBeVisible()
        await scan(page)
        if (state === 'pending')
          await expect(
            page.getByRole('button', { name: 'Continue to test payment' }),
          ).toBeDisabled()
        if (
          [390, 1366].includes(width) &&
          ['pending', 'confirmed', 'expired', 'refund-pending'].includes(state)
        )
          await capture(page, `docs/previews/phase5-${state}-${width}.png`)
      }
    }
  } finally {
    await cleanup(request, admin, f)
    await staff.close()
  }
})
test('staff can review recovery tasks while retry controls remain admin-only', async ({ page }) => {
  const id = randomUUID(),
    job = {
      id,
      type: 'STRIPE_COMPENSATION',
      status: 'FAILED',
      attempts: 8,
      lastErrorCode: 'REFUND_RECONCILIATION_REQUIRED',
      availableAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      processedAt: null,
    }
  let retried = false
  await login(page, 'ADMIN')
  await page.route('**/api/v1/operations/jobs?*', (route) =>
    route.fulfill({
      json: {
        data: [{ ...job, status: retried ? 'PENDING' : 'FAILED' }],
        counts: { FAILED: retried ? 0 : 1, PENDING: retried ? 1 : 0 },
        pagination: { page: 1, pages: 1, total: 1 },
      },
    }),
  )
  await page.route(`**/api/v1/operations/jobs/${id}/retries`, (route) => {
    retried = true
    return route.fulfill({ json: { data: { id, status: 'PENDING' } } })
  })
  await page.goto('/workspace/operations')
  await page.getByLabel('Filter background task status').selectOption('FAILED')
  await expect(page).toHaveURL(/status=FAILED/)
  await page.getByRole('button', { name: 'Review retry' }).click()
  await page.getByLabel('Reason for retry').fill('Reviewed test provider response')
  await page.getByRole('button', { name: 'Confirm retry' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(retried).toBe(true)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/auth\/sign-in/)
  await login(page, 'OPERATOR')
  retried = false
  await page.goto('/workspace/operations')
  await expect(page.getByText('Return a late test payment', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review retry' })).toHaveCount(0)
  await scan(page)
  await page.setViewportSize({ width: 1366, height: 900 })
  await capture(page, 'docs/previews/phase5-tasks-1366.png')
  await page.setViewportSize({ width: 390, height: 900 })
  await scan(page)
  await capture(page, 'docs/previews/phase5-tasks-390.png')
})
