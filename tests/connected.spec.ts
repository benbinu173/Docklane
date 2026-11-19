import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { randomUUID } from 'node:crypto'
import { fork, type ChildProcess } from 'node:child_process'
import { config } from 'dotenv'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createDatabase } from '@docklane/database'
import { adjustStock, quoteCheckout, createReservedOrder } from '@docklane/domain'
import type { OrderDetail, Role } from '@docklane/contracts'

// Cloud identity and Stripe transport are simulated; all application API,
// identity/session checks, inventory transactions, and persistence are real.
test.skip(process.env.DOCKLANE_LOCAL_E2E !== '1', 'Enable the isolated database browser runner.')
test.use({ reducedMotion: 'reduce', trace: 'off', screenshot: 'off' })
test.describe.configure({ timeout: 120_000 })
config({ path: ['.env.local', '.env'], quiet: true })
const businessId = `browser-${randomUUID()}`,
  sku = `E2E-${randomUUID().slice(0, 8).toUpperCase()}`,
  siteId = `browser-${randomUUID()}`,
  stockId = `${sku}@${siteId}`
let db: ReturnType<typeof createDatabase>, server: ChildProcess, origin: string
const credentials = new Map<Role, { id: string; subject: string; session: string; jwt: string }>()
test.beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL
  if (
    !url ||
    !['postgres:', 'postgresql:'].includes(new URL(url).protocol) ||
    new URL(url).pathname !== '/docklane_test' ||
    !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
  )
    throw new Error('Connected browser checks require loopback docklane_test.')
  db = createDatabase(url)
  await db.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS neon_auth')
  await db.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL)',
  )
  await db.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS neon_auth.session (id text PRIMARY KEY, token text UNIQUE NOT NULL, "userId" text REFERENCES neon_auth."user"(id), "expiresAt" timestamptz NOT NULL)',
  )
  await db.business.create({ data: { id: businessId, name: 'Connected browser fixture' } })
  const keys = await generateKeyPair('EdDSA'),
    issuer = 'https://identity.example.test'
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'browser-key', alg: 'EdDSA' }
  for (const role of ['ADMIN', 'OPERATOR', 'CUSTOMER'] as const) {
    const subject = `${businessId}:${role}`,
      session = randomUUID()
    await db.$executeRaw`INSERT INTO neon_auth."user" (id,name,email) VALUES (${subject},${role},${`${role.toLowerCase()}@example.test`})`
    await db.$executeRaw`INSERT INTO neon_auth.session (id,token,"userId","expiresAt") VALUES (${randomUUID()},${session},${subject},CURRENT_TIMESTAMP + INTERVAL '1 hour')`
    const profile = await db.userProfile.create({
      data: {
        authSubject: subject,
        name: role,
        email: `${role.toLowerCase()}@example.test`,
        role,
        businessId,
      },
    })
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA', kid: 'browser-key' })
      .setSubject(subject)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(keys.privateKey)
    credentials.set(role, { id: profile.id, subject, session, jwt })
  }
  await db.product.create({
    data: {
      sku,
      name: 'Everyday Carry Bag',
      category: 'Accessories',
      pricePaise: 49950,
      image: '/images/weekender.jpg',
      color: '#E9EEE4',
      businessId,
    },
  })
  await db.warehouse.create({
    data: {
      id: siteId,
      code: sku,
      name: 'Browser verification site',
      city: 'Kochi',
      address: 'Synthetic fixture address',
      lead: 'Fixture operator',
      businessId,
    },
  })
  await db.inventoryBalance.create({ data: { id: stockId, sku, warehouseId: siteId } })
  await adjustStock(db, businessId, credentials.get('ADMIN')!.id, randomUUID(), stockId, {
    type: 'INCREASE',
    quantity: 10,
    reason: 'Open isolated browser fixture',
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  })
  server = fork('tests/support/connected-server.ts', {
    execArgv: ['--import', 'tsx'],
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  const port = await command('start', { businessId, issuer, jwk })
  origin = `http://127.0.0.1:${port}`
})
test.afterAll(async () => {
  if (server?.connected) await command('stop')
  await db?.$disconnect()
})
async function command(action: string, fields: Record<string, unknown> = {}) {
  const requestId = randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    const deadline = setTimeout(() => {
      server.off('message', receive)
      reject(new Error('Isolated browser API timed out.'))
    }, 20_000)
    function receive(message: { requestId: string; result?: unknown; error?: string }) {
      if (message.requestId !== requestId) return
      clearTimeout(deadline)
      server.off('message', receive)
      if (message.error) reject(new Error(message.error))
      else resolve(message.result)
    }
    server.on('message', receive)
    server.send({ requestId, action, ...fields })
  })
}
async function session(context: BrowserContext, role: Role) {
  const identity = credentials.get(role)!
  await context.route(/\/(get-session|token|sign-out)(?:\?|$)/, async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = path.endsWith('/token')
      ? { token: identity.jwt }
      : path.endsWith('/sign-out')
        ? { success: true }
        : {
            session: {
              id: identity.session,
              token: identity.session,
              userId: identity.subject,
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            user: {
              id: identity.subject,
              name: role,
              email: `${role.toLowerCase()}@example.test`,
              emailVerified: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
      headers: {
        'access-control-allow-origin': route.request().headers().origin ?? '*',
        'access-control-allow-credentials': 'true',
        'set-auth-jwt': identity.jwt,
      },
    })
  })
  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `${origin}${url.pathname}${url.search}` })
    await route.fulfill({ response })
  })
}
async function submit(page: Page, action: string, reason: string) {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Reason', { exact: true }).fill(reason)
  await dialog.getByRole('button', { name: action, exact: true }).click()
  await expect(dialog).toBeHidden()
}
async function savedOrder(id: string): Promise<OrderDetail> {
  const auth = credentials.get('ADMIN')!
  const response = await fetch(`${origin}/api/v1/orders/${id}`, {
    headers: { Authorization: `Bearer ${auth.jwt}`, 'X-Docklane-Session': auth.session },
  })
  expect(response.status).toBe(200)
  return (await response.json()).data as OrderDetail
}
test('Customer retries a lost reservation response, reloads it, and cancels with one stock release', async ({
  page,
  context,
}) => {
  await session(context, 'CUSTOMER')
  await page.goto(`/account/catalog/${sku}`)
  await page.getByLabel('Quantity', { exact: true }).fill('2')
  await page.getByRole('button', { name: 'Add to bag' }).click()
  await page.goto('/account/checkout')
  await page.getByLabel('Street address', { exact: true }).fill('12 Garden Lane')
  await page.getByLabel('City', { exact: true }).fill('Kochi')
  await page.getByLabel('PIN code', { exact: true }).fill('682001')
  await page.getByRole('button', { name: 'Review order', exact: true }).click()
  let orderId = '',
    lost = false
  await page.route('**/api/v1/orders', async (route) => {
    if (route.request().method() !== 'POST' || lost) {
      await route.fallback()
      return
    }
    lost = true
    const response = await route.fetch({ url: `${origin}/api/v1/orders` })
    expect(response.status()).toBe(201)
    orderId = (await response.json()).data.id
    await route.abort('failed')
  })
  await page.getByRole('button', { name: 'Reserve order', exact: true }).click()
  await page.getByRole('button', { name: 'Retry same reservation', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/account/orders/${orderId}$`))
  await page.reload()
  expect((await savedOrder(orderId)).totalPaise).toBe(99900)
  expect((await db.inventoryBalance.findUniqueOrThrow({ where: { id: stockId } })).reserved).toBe(2)
  await page.getByRole('button', { name: 'Cancel unpaid order', exact: true }).click()
  await page
    .getByLabel('Reason for cancellation', { exact: true })
    .fill('Cancel isolated browser order')
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
  await expect(page.getByText('Cancelled · stock released', { exact: true })).toBeVisible()
  expect(await db.inventoryMovement.count({ where: { orderId, type: 'RESERVE' } })).toBe(1)
  expect(await db.inventoryMovement.count({ where: { orderId, type: 'RELEASE' } })).toBe(1)
  expect((await db.inventoryBalance.findUniqueOrThrow({ where: { id: stockId } })).reserved).toBe(0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})
test('Staff ship a paid order, refund money, and restock only a received return', async ({
  browser,
}) => {
  const items = [{ sku, quantity: 2 }],
    quote = await quoteCheckout(db, businessId, items)
  const order = await createReservedOrder(
    db,
    businessId,
    credentials.get('CUSTOMER')!.id,
    randomUUID(),
    {
      items,
      quoteFingerprint: quote.quoteFingerprint,
      deliveryAddress: {
        line: '12 Garden Lane',
        city: 'Kochi',
        postalCode: '682001',
        country: 'IN',
      },
      idempotencyKey: randomUUID(),
    },
  )
  const customer = credentials.get('CUSTOMER')!
  const checkout = await fetch(`${origin}/api/v1/orders/${order.id}/payment-sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customer.jwt}`,
      'X-Docklane-Session': customer.session,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  const checkoutBody = await checkout.json()
  expect(checkout.status, checkoutBody.error?.code).toBe(200)
  const checkoutId = checkoutBody.data.sessionId
  expect(checkoutId).toBeTruthy()
  const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
  await command('capture', { orderId: order.id })
  const operator = await browser.newContext({ reducedMotion: 'reduce' }),
    admin = await browser.newContext({ reducedMotion: 'reduce' })
  try {
    await session(operator, 'OPERATOR')
    await session(admin, 'ADMIN')
    const page = await operator.newPage()
    await page.goto(`/workspace/orders/${order.id}`)
    await expect(
      page.getByRole('button', { name: 'Request test refund', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Mark items packed', exact: true }).click()
    await submit(page, 'Mark items packed', 'All items checked and packed')
    await page.getByRole('button', { name: 'Record shipment', exact: true }).click()
    await page.getByLabel('Carrier', { exact: true }).fill('Test courier')
    await page.getByLabel('Tracking reference', { exact: true }).fill('DL-TEST-SHIPMENT')
    await submit(page, 'Record shipment', 'Carrier handoff for browser verification')
    expect((await db.inventoryBalance.findUniqueOrThrow({ where: { id: stockId } })).onHand).toBe(8)
    const refundPage = await admin.newPage()
    await refundPage.goto(`/workspace/orders/${order.id}`)
    await refundPage.getByRole('button', { name: 'Request test refund', exact: true }).click()
    await refundPage.getByLabel('Refund amount (₹)').fill('100')
    await submit(refundPage, 'Request a test refund', 'Partial refund for browser verification')
    const refund = await db.refundAttempt.findFirstOrThrow({ where: { paymentId: payment.id } })
    await command('refund', { refundId: refund.id })
    expect((await savedOrder(order.id)).refundTotals.refundedPaise).toBe(10000)
    expect((await db.inventoryBalance.findUniqueOrThrow({ where: { id: stockId } })).onHand).toBe(8)
    await page.reload()
    await page.getByRole('button', { name: 'Receive return', exact: true }).click()
    await page.getByLabel('Received quantity for Everyday Carry Bag').fill('1')
    await submit(page, 'Receive a return', 'One bag physically received')
    expect((await db.inventoryBalance.findUniqueOrThrow({ where: { id: stockId } })).onHand).toBe(8)
    await page.getByRole('button', { name: 'Restock', exact: true }).click()
    await submit(page, 'Restock received items', 'Inspected and ready to sell')
    await page.reload()
    await expect(
      page
        .getByRole('region', { name: 'Order timeline' })
        .getByText('Returned items restocked', { exact: true }),
    ).toBeVisible()
    expect((await db.inventoryBalance.findUniqueOrThrow({ where: { id: stockId } })).onHand).toBe(9)
    expect(await db.inventoryMovement.count({ where: { orderId: order.id, type: 'SHIP' } })).toBe(1)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => document.fonts.ready)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  } finally {
    await operator.close()
    await admin.close()
  }
})
