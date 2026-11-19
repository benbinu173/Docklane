import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { OrderDetail, InventoryRecord } from '@docklane/contracts'

test.use({ trace: 'off', screenshot: 'off', reducedMotion: 'reduce' })
test.describe.configure({ mode: 'serial', timeout: 180_000 })
type Headers = Record<string, string>
const apiUrl = `${process.env.VITE_API_URL ?? 'http://127.0.0.1:4000'}/api/v1`
let accounts: { role: string; email: string; password: string }[],
  fixture: {
    sku: string
    balanceId: string
    orders: { orderId: string; number: string; amountPaise: number }[]
  }
test.beforeAll(async () => {
  const saved = JSON.parse(await readFile('.local/demo-accounts.json', 'utf8'))
  if (
    process.env.DOCKLANE_AUTH_E2E !== '1' ||
    process.env.ALLOW_DEVELOPMENT_SEED !== 'true' ||
    saved.authUrl !== process.env.NEON_AUTH_BASE_URL ||
    process.env.NEON_BRANCH_ID !== 'br-autumn-moon-ao9qu3vj'
  )
    throw new Error('Use the guarded development Auth runner.')
  accounts = saved.accounts
  fixture = JSON.parse(await readFile('.local/phase6-fixture.json', 'utf8'))
  if (!/^P6-[A-F0-9]{8}$/.test(fixture.sku) || fixture.orders.length !== 2)
    throw new Error('Prepare the isolated captured Stripe test fixtures first.')
})
async function login(page: Page, role: string) {
  const account = accounts.find((a) => a.role === role)!
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  const pending = page.waitForRequest((r) => r.url().endsWith('/api/v1/me'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const h = (await pending).headers()
  await expect(page).toHaveURL(role === 'CUSTOMER' ? /\/account\/orders$/ : /\/workspace$/, {
    timeout: 45000,
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
  const result = await request.fetch(apiUrl + path, { method, headers, ...(data ? { data } : {}) })
  expect(result.ok(), `${method} ${path} returned ${result.status()}`).toBe(true)
  return (await result.json()).data as T
}
const savedOrder = (request: APIRequestContext, headers: Headers, index = 0) =>
  call<OrderDetail>(request, headers, `/orders/${fixture.orders[index].orderId}`)
async function submit(page: Page, title: string, reason: string) {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Reason', { exact: true }).fill(reason)
  await dialog.getByRole('button', { name: title, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('Admin packs, ships and issues a real partial Stripe test refund', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'ADMIN')
  const order = await savedOrder(request, headers)
  await page.goto(`/workspace/orders/${order.number}`)
  if (!order.shipment) {
    if (!order.packedAt) {
      await page.getByRole('button', { name: 'Mark items packed', exact: true }).click()
      await submit(page, 'Mark items packed', 'All fixture items checked and packed')
    }
    await page.getByRole('button', { name: 'Record shipment', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Carrier', { exact: true }).fill('Docklane Test Courier')
    await dialog.getByLabel('Tracking reference', { exact: true }).fill('DL-P6-SANDBOX')
    await dialog
      .getByLabel('Tracking URL', { exact: false })
      .fill('https://example.test/track/DL-P6-SANDBOX')
    await submit(page, 'Record shipment', 'Carrier handoff for isolated fulfillment verification')
  }
  await expect(page.getByRole('link', { name: 'Track shipment' })).toHaveAttribute(
    'href',
    'https://example.test/track/DL-P6-SANDBOX',
  )
  const shipped = await savedOrder(request, headers),
    stock = await call<InventoryRecord>(request, headers, `/inventory/${fixture.balanceId}`)
  expect(shipped).toMatchObject({ orderStatus: 'COMPLETED', fulfillmentStatus: 'SHIPPED' })
  expect(shipped.reservations.every((r) => r.status === 'CONSUMED')).toBe(true)
  if (!shipped.refunds.length) {
    await page.getByRole('button', { name: 'Request test refund', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Refund amount (₹)').fill('100')
    await submit(page, 'Request a test refund', 'Partial refund for isolated Stripe verification')
  }
  await expect
    .poll(async () => (await savedOrder(request, headers)).refundTotals.refundedPaise, {
      timeout: 60000,
      intervals: [1000, 3000],
    })
    .toBeGreaterThanOrEqual(10000)
  const after = await call<InventoryRecord>(request, headers, `/inventory/${fixture.balanceId}`)
  expect(after.onHand).toBe(stock.onHand)
  expect(after.reserved).toBe(stock.reserved)
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'Refunds', exact: true })
      .getByText('Partial refund for isolated Stripe verification'),
  ).toBeVisible()
})

test('Operator receives and explicitly restocks a return with responsive accessible views', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'OPERATOR')
  let order = await savedOrder(request, headers)
  await page.goto(`/workspace/orders/${order.number}`)
  await expect(page.getByRole('button', { name: 'Request test refund', exact: true })).toHaveCount(
    0,
  )
  if (!order.returns.length) {
    await page.getByRole('button', { name: 'Receive return', exact: true }).click()
    await page.getByLabel('Received quantity for Everyday Carry Bag').fill('1')
    await submit(page, 'Receive a return', 'One bag physically received for inspection')
  }
  order = await savedOrder(request, headers)
  const before = await call<InventoryRecord>(request, headers, `/inventory/${fixture.balanceId}`)
  const first = order.returns.find(
    (r) => r.reason === 'One bag physically received for inspection',
  )!
  if (first.items[0].restockedQuantity === 0) {
    await page.getByRole('button', { name: 'Restock', exact: true }).first().click()
    await submit(page, 'Restock received items', 'Inspected and ready to sell again')
    expect(
      (await call<InventoryRecord>(request, headers, `/inventory/${fixture.balanceId}`)).onHand,
    ).toBe(before.onHand + 1)
  }
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'Order timeline' })
      .getByText('Returned items restocked', { exact: true }),
  ).toBeVisible()
  await mkdir('docs/previews', { recursive: true })
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: 'A smooth handoff.' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: `docs/previews/phase6-order-${width}.png`, fullPage: true })
  }
})

test('Admin completes the remaining test refund and repeated requests preserve one operation', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'ADMIN')
  let order = await savedOrder(request, headers)
  await page.goto(`/workspace/orders/${order.number}`)
  if (order.refundTotals.availablePaise > 0) {
    await page.getByRole('button', { name: 'Request test refund', exact: true }).click()
    await submit(page, 'Request a test refund', 'Remaining refund for isolated Stripe verification')
  }
  await expect
    .poll(async () => (await savedOrder(request, headers)).paymentStatus, {
      timeout: 60000,
      intervals: [1000, 3000],
    })
    .toBe('REFUNDED')
  order = await savedOrder(request, headers)
  expect(order.refundTotals.refundedPaise).toBe(fixture.orders[0].amountPaise)
  expect(order.refunds.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(2)
  const stock = await call<InventoryRecord>(request, headers, `/inventory/${fixture.balanceId}`)
  const over = await request.post(`${apiUrl}/orders/${order.id}/refunds`, {
    headers,
    data: {
      amountPaise: 1,
      reason: 'Verify captured amount boundary',
      idempotencyKey: randomUUID(),
    },
  })
  expect(over.status()).toBe(409)
  expect(
    (await call<InventoryRecord>(request, headers, `/inventory/${fixture.balanceId}`)).onHand,
  ).toBe(stock.onHand)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your test payment, returned.' })).toBeVisible()
})

test('Customer cancels an unshipped paid order and the worker refunds it without staff controls', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'CUSTOMER')
  const order = await savedOrder(request, headers, 1)
  await page.goto(`/account/orders/${order.number}`)
  await expect(page.getByRole('button', { name: 'Mark items packed', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Request test refund', exact: true })).toHaveCount(
    0,
  )
  if (order.orderStatus === 'CONFIRMED') {
    await page.getByRole('button', { name: 'Cancel unshipped order', exact: true }).click()
    await page
      .getByLabel('Reason for cancellation')
      .fill('Cancel isolated paid order before shipment')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm cancellation', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toBeHidden()
  }
  await expect
    .poll(async () => (await savedOrder(request, headers, 1)).paymentStatus, {
      timeout: 60000,
      intervals: [1000, 3000],
    })
    .toBe('REFUNDED')
  const cancelled = await savedOrder(request, headers, 1)
  expect(cancelled.orderStatus).toBe('CANCELLED')
  expect(cancelled.reservations.every((r) => r.status === 'RELEASED')).toBe(true)
  await page.reload()
  await page.setViewportSize({ width: 390, height: 900 })
  await expect(page.getByRole('heading', { name: 'Your test payment, returned.' })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test('a lost restock response reuses the saved request and restores stock once', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'OPERATOR')
  const retryFixture = JSON.parse(await readFile('.local/phase6-retry.json', 'utf8'))
  if (retryFixture.sku !== fixture.sku) throw new Error('Retry fixture association failed.')
  let order = await call<OrderDetail>(request, headers, `/orders/${retryFixture.orderId}`)
  await page.goto(`/workspace/orders/${order.number}`)
  let receipt = order.returns.find((r) => r.reason === 'Second bag received for retry verification')
  if (!receipt) {
    await page.getByRole('button', { name: 'Receive return', exact: true }).click()
    await page.getByLabel('Received quantity for Everyday Carry Bag').fill('1')
    await submit(page, 'Receive a return', 'Second bag received for retry verification')
    order = await call<OrderDetail>(request, headers, `/orders/${retryFixture.orderId}`)
    receipt = order.returns.find((r) => r.reason === 'Second bag received for retry verification')
  }
  expect(receipt).toBeDefined()
  const item = receipt!.items[0],
    before = await call<InventoryRecord>(request, headers, `/inventory/${fixture.balanceId}`)
  if (item.restockedQuantity === 0) {
    const payloads: { idempotencyKey: string; quantity: number; reason: string }[] = []
    await page.route(`**/api/v1/orders/${order.id}/returns/${item.id}/restocks`, async (route) => {
      payloads.push(route.request().postDataJSON())
      if (payloads.length === 1) {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await route.abort()
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Restock', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('Reason', { exact: true })
      .fill('Inspect and restock once after a lost response')
    await dialog.getByRole('button', { name: 'Restock received items', exact: true }).click()
    await expect(
      dialog.getByRole('button', { name: 'Retry saved request', exact: true }),
    ).toBeVisible()
    await expect(dialog.getByLabel('Reason', { exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Retry saved request', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(payloads).toHaveLength(2)
    expect(payloads[1]).toEqual(payloads[0])
    expect(
      (await call<InventoryRecord>(request, headers, `/inventory/${fixture.balanceId}`)).onHand,
    ).toBe(before.onHand + 1)
    await writeFile(
      '.local/phase6-retry-result.json',
      JSON.stringify(
        {
          status: 'passed',
          requests: 2,
          sameRequest: true,
          stockAddedOnce: true,
          orderId: order.id,
        },
        null,
        2,
      ),
    )
  }
  const saved = await call<OrderDetail>(request, headers, `/orders/${retryFixture.orderId}`)
  expect(
    saved.returns.flatMap((r) => r.items).reduce((sum, i) => sum + i.restockedQuantity, 0),
  ).toBe(1)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Restock', exact: true })).toHaveCount(0)
})
