import { beforeEach, afterAll, describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { createDatabase } from '@docklane/database'
import { DomainError, adjustStock, normalizeCart } from '@docklane/domain'
import { createApp } from '../../apps/api/src/app.js'
import { seedDevelopment } from '../../scripts/seed-lib.js'
import type { CartItem, CheckoutInput } from '@docklane/contracts'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Order tests require the isolated local docklane_test database.')
const db = createDatabase(url)
const businessId = 'northstar-supply'
const identities = [
  {
    authSubject: 'order-admin',
    name: 'Ben Thomas',
    email: 'admin@docklane.example.test',
    role: 'ADMIN' as const,
  },
  {
    authSubject: 'order-operator',
    name: 'Priya Rao',
    email: 'operator@docklane.example.test',
    role: 'OPERATOR' as const,
  },
  {
    authSubject: 'order-customer',
    name: 'Aditi Menon',
    email: 'aditi.menon@docklane.example.test',
    role: 'CUSTOMER' as const,
  },
  {
    authSubject: 'order-riya',
    name: 'Riya Nair',
    email: 'riya.nair@docklane.example.test',
    role: 'CUSTOMER' as const,
  },
]
const app = createApp({
  db,
  businessId,
  origins: [],
  logLevel: 'silent',
  verifyIdentity: async (subject) => {
    const profile = await db.userProfile.findUnique({ where: { authSubject: subject } })
    if (!profile) throw new DomainError('UNAUTHORIZED', 'Invalid test identity.', 401)
    return { subject, name: profile.name, email: profile.email }
  },
})
const headers = (subject = 'order-customer') => ({
  Authorization: `Bearer ${subject}`,
  'X-Docklane-Session': 'local-test-session',
})
const request = () => supertest(app)
const address = {
  line: '12 Garden Lane',
  city: 'Kochi',
  postalCode: '682001',
  country: 'IN' as const,
}
const sku = 'RESERVE-TEST',
  warehouseId = 'reservation-test',
  balanceId = 'reservation-test-balance'
async function fixture(quantity = 10) {
  await db.product.create({
    data: {
      sku,
      name: 'Reservation proof item',
      category: 'Verification',
      pricePaise: 12500,
      image: '/product-placeholder.svg',
      color: '#E9EEE4',
      businessId,
    },
  })
  await db.warehouse.create({
    data: {
      id: warehouseId,
      code: 'RESERVE-TEST',
      name: 'Reservation site',
      city: 'Kochi',
      address: '12 Test Lane',
      lead: 'Test Lead',
      priority: 0,
      businessId,
    },
  })
  await db.inventoryBalance.create({ data: { id: balanceId, sku, warehouseId } })
  const admin = await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'order-admin' } })
  await adjustStock(db, businessId, admin.id, randomUUID(), balanceId, {
    type: 'INCREASE',
    quantity,
    reason: 'Open isolated reservation fixture',
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  })
}
async function body(items: CartItem[] = [{ sku, quantity: 1 }]): Promise<CheckoutInput> {
  const quote = await request().post('/api/v1/checkout/quote').set(headers()).send({ items })
  expect(quote.status).toBe(200)
  return {
    items,
    deliveryAddress: address,
    quoteFingerprint: quote.body.data.quoteFingerprint,
    idempotencyKey: randomUUID(),
  }
}
const place = (input: CheckoutInput, subject?: string) =>
  request().post('/api/v1/orders').set(headers(subject)).send(input)
const cancel = (id: string, subject?: string, key = randomUUID()) =>
  request()
    .post(`/api/v1/orders/${id}/cancellations`)
    .set(headers(subject))
    .send({ reason: 'Cancel isolated order verification', idempotencyKey: key })
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE public.businesses CASCADE')
  await db.$executeRawUnsafe('TRUNCATE TABLE public.outbox_events')
  await seedDevelopment(db, identities)
  await fixture()
})
afterAll(async () => db.$disconnect())

describe('Phase 4 reservation engine on PostgreSQL', () => {
  it('reserves exactly 10 of 50 simultaneous distinct-customer requests without overselling', async () => {
    const input = await body()
    const subjects = Array.from({ length: 50 }, (_, i) => `race-${i}`)
    await db.userProfile.createMany({
      data: subjects.map((authSubject) => ({
        authSubject,
        name: authSubject,
        email: `${authSubject}@example.test`,
        businessId,
      })),
    })
    const results = await Promise.all(
      subjects.map((subject) => place({ ...input, idempotencyKey: randomUUID() }, subject)),
    )
    expect(results.filter((response) => response.status === 201)).toHaveLength(10)
    expect(
      results.filter(
        (response) => response.status === 409 && response.body.error.code === 'INSUFFICIENT_STOCK',
      ),
    ).toHaveLength(40)
    expect(
      new Set(
        results
          .filter((response) => response.status === 201)
          .map((response) => response.body.data.id),
      ).size,
    ).toBe(10)
    expect(await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).toMatchObject(
      { onHand: 10, reserved: 10, version: 11 },
    )
    expect(await db.stockReservation.count({ where: { balanceId, status: 'HELD' } })).toBe(10)
    expect(await db.inventoryMovement.count({ where: { balanceId, type: 'RESERVE' } })).toBe(10)
    expect(await db.outboxEvent.count({ where: { type: 'ORDER_RESERVATION_EXPIRY' } })).toBe(10)
    const sums = await db.inventoryMovement.aggregate({
      where: { balanceId },
      _sum: { deltaOnHand: true, deltaReserved: true },
    })
    expect(sums._sum).toEqual({ deltaOnHand: 10, deltaReserved: 10 })
  })
  it('creates one order for concurrent identical keys and normalizes duplicate/reordered lines', async () => {
    const input = await body([
      { sku, quantity: 1 },
      { sku, quantity: 2 },
    ])
    const results = await Promise.all([
      place(input),
      place({ ...input, items: [{ sku, quantity: 3 }] }),
      place(input),
    ])
    expect(results.map((result) => result.status)).toEqual([201, 201, 201])
    expect(new Set(results.map((result) => result.body.data.id)).size).toBe(1)
    expect(results[0].body.data.items).toHaveLength(1)
    expect(results[0].body.data.items[0].quantity).toBe(3)
    expect(await db.inventoryMovement.count({ where: { balanceId, type: 'RESERVE' } })).toBe(1)
    expect(
      (await place({ ...input, deliveryAddress: { ...address, line: '14 Changed Lane' } })).body
        .error.code,
    ).toBe('IDEMPOTENCY_CONFLICT')
    expect((await place({ ...input, items: [{ sku, quantity: 4 }] })).body.error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    )
  })
  it('rejects partial multi-item reservations and stock spread across different warehouses', async () => {
    const input = await body([
      { sku, quantity: 1 },
      { sku: 'AUD-001', quantity: 1 },
    ])
    const result = await place(input)
    expect(result.body.error.code).toBe('INSUFFICIENT_STOCK')
    expect(
      (await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).reserved,
    ).toBe(0)
    expect(await db.stockReservation.count({ where: { balanceId } })).toBe(0)
    expect(await db.idempotencyRecord.count({ where: { key: input.idempotencyKey } })).toBe(0)
  })
  it('chooses one site deterministically and falls back when its stock is depleted', async () => {
    await db.warehouse.create({
      data: {
        id: 'reservation-second',
        code: 'RESERVE-SECOND',
        name: 'Second site',
        city: 'Mumbai',
        address: '14 Test Lane',
        lead: 'Test Lead',
        priority: 2,
        businessId,
      },
    })
    await db.inventoryBalance.create({
      data: { id: 'reservation-second-balance', sku, warehouseId: 'reservation-second' },
    })
    const admin = await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'order-admin' } })
    await adjustStock(db, businessId, admin.id, randomUUID(), 'reservation-second-balance', {
      type: 'INCREASE',
      quantity: 10,
      reason: 'Open second fixture',
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    })
    const input = await body([{ sku, quantity: 10 }])
    const results = await Promise.all([
      place(input),
      place({ ...input, idempotencyKey: randomUUID() }, 'order-riya'),
    ])
    expect(results.map((result) => result.status)).toEqual([201, 201])
    expect(results.map((result) => result.body.data.warehouse.id).sort()).toEqual(
      ['reservation-second', warehouseId].sort(),
    )
  })
  it('requires a fresh server-price review, rejects client prices, and preserves order snapshots', async () => {
    const input = await body()
    await db.product.update({ where: { sku }, data: { pricePaise: 15000 } })
    expect((await place(input)).body.error.code).toBe('PRICE_CHANGED')
    expect(await db.stockReservation.count({ where: { balanceId } })).toBe(0)
    expect((await place({ ...(await body()), totalPaise: 1 } as CheckoutInput)).status).toBe(400)
    const order = (await place(await body())).body.data
    await db.product.update({ where: { sku }, data: { pricePaise: 20000, name: 'Changed title' } })
    const detail = await request().get(`/api/v1/orders/${order.id}`).set(headers())
    expect(detail.body.data.items[0]).toMatchObject({
      unitPricePaise: 15000,
      name: 'Reservation proof item',
    })
    expect(detail.body.data.totalPaise).toBe(15000)
  })
  it('rejects invalid quantities, duplicate totals, addresses, and archived products/sites', async () => {
    const input = await body()
    for (const quantity of [0, -1, 1.5, 100])
      expect((await place({ ...input, items: [{ sku, quantity }] })).status).toBe(400)
    expect(() =>
      normalizeCart([
        { sku, quantity: 99 },
        { sku, quantity: 1 },
      ]),
    ).toThrow()
    expect(
      (await place({ ...input, deliveryAddress: { ...address, postalCode: '123' } })).status,
    ).toBe(400)
    await db.product.update({ where: { sku }, data: { archived: true } })
    expect((await place(input)).body.error.code).toBe('PRODUCT_UNAVAILABLE')
    await db.product.update({ where: { sku }, data: { archived: false } })
    await db.warehouse.update({ where: { id: warehouseId }, data: { archived: true } })
    expect((await place(input)).body.error.code).toBe('INSUFFICIENT_STOCK')
  })
  it('rolls back orders, items, stock, movements, outbox, and retry records on audit failure', async () => {
    const input = await body(),
      previous = await db.order.count()
    await db.$executeRawUnsafe(
      "CREATE FUNCTION fail_test_order_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'ORDER_RESERVED' THEN RAISE EXCEPTION 'Injected order audit failure'; END IF; RETURN NEW; END; $$",
    )
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_test_order_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_test_order_audit()',
    )
    try {
      expect((await place(input)).status).toBe(500)
      expect(await db.order.count()).toBe(previous)
      expect(await db.stockReservation.count({ where: { balanceId } })).toBe(0)
      expect(await db.inventoryMovement.count({ where: { balanceId, type: 'RESERVE' } })).toBe(0)
      expect(await db.outboxEvent.count()).toBe(0)
      expect(await db.idempotencyRecord.count({ where: { key: input.idempotencyKey } })).toBe(0)
      expect(
        (await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).reserved,
      ).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_test_order_audit ON audit_events')
      await db.$executeRawUnsafe('DROP FUNCTION fail_test_order_audit()')
    }
    expect((await place(input)).status).toBe(201)
  })
  it('uses a database-timed 30-minute hold and writes durable expiry work', async () => {
    const result = await place(await body())
    const order = result.body.data
    expect(new Date(order.expiresAt).getTime() - new Date(order.createdAt).getTime()).toBeCloseTo(
      30 * 60000,
      -1,
    )
    const outbox = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'ORDER_RESERVATION_EXPIRY' },
    })
    expect(outbox.payload).toEqual({ businessId, orderId: order.id })
    expect(outbox.availableAt.toISOString()).toBe(order.expiresAt)
    expect(order.reservations).toEqual([
      { sku, quantity: 1, status: 'HELD', expiresAt: order.expiresAt },
    ])
    const skus = ['AUD-001', 'BOT-004']
    const before = await db.inventoryBalance.findMany({
      where: { warehouseId: 'kochi', sku: { in: skus } },
    })
    const multi = await place(
      await body([
        { sku: skus[0], quantity: 2 },
        { sku: skus[1], quantity: 3 },
      ]),
    )
    expect(multi.status).toBe(201)
    expect(multi.body.data.warehouse.id).toBe('kochi')
    expect(
      multi.body.data.items.map((item: { sku: string; quantity: number }) => ({
        sku: item.sku,
        quantity: item.quantity,
      })),
    ).toEqual([
      { sku: skus[0], quantity: 2 },
      { sku: skus[1], quantity: 3 },
    ])
    expect(multi.body.data.totalPaise).toBe(1_239_500)
    expect(multi.body.data.reservations).toHaveLength(2)
    expect(
      await db.inventoryMovement.count({ where: { orderId: multi.body.data.id, type: 'RESERVE' } }),
    ).toBe(2)
    expect((await cancel(multi.body.data.id)).status).toBe(200)
    const after = await db.inventoryBalance.findMany({
      where: { warehouseId: 'kochi', sku: { in: skus } },
    })
    for (const balance of before)
      expect(after.find((saved) => saved.id === balance.id)).toMatchObject({
        onHand: balance.onHand,
        reserved: balance.reserved,
      })
    expect(
      await db.inventoryMovement.count({ where: { orderId: multi.body.data.id, type: 'RELEASE' } }),
    ).toBe(2)
  })
  it('rolls back cancellation releases when its audit fails and safely retries', async () => {
    const order = (await place(await body())).body.data
    const key = randomUUID()
    await db.$executeRawUnsafe(
      "CREATE FUNCTION fail_test_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'ORDER_CANCELLED' THEN RAISE EXCEPTION 'Injected cancellation audit failure'; END IF; RETURN NEW; END; $$",
    )
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_test_cancel_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_test_cancel_audit()',
    )
    try {
      expect((await cancel(order.id, undefined, key)).status).toBe(500)
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).orderStatus).toBe(
        'AWAITING_PAYMENT',
      )
      expect(
        (await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).reserved,
      ).toBe(1)
      expect(
        await db.stockReservation.count({ where: { orderId: order.id, status: 'HELD' } }),
      ).toBe(1)
      expect(
        await db.inventoryMovement.count({ where: { orderId: order.id, type: 'RELEASE' } }),
      ).toBe(0)
      expect(await db.idempotencyRecord.count({ where: { key } })).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_test_cancel_audit ON audit_events')
      await db.$executeRawUnsafe('DROP FUNCTION fail_test_cancel_audit()')
    }
    expect((await cancel(order.id, undefined, key)).status).toBe(200)
    expect(
      await db.inventoryMovement.count({ where: { orderId: order.id, type: 'RELEASE' } }),
    ).toBe(1)
  })
  it('serializes cancellations and releases stock once while replaying creation without a new hold', async () => {
    const input = await body(),
      order = (await place(input)).body.data
    const key = randomUUID()
    const results = await Promise.all([
      cancel(order.id, undefined, key),
      cancel(order.id),
      cancel(order.id, 'order-operator'),
    ])
    expect(results.map((result) => result.status)).toEqual([200, 200, 200])
    expect(
      await db.inventoryMovement.count({ where: { orderId: order.id, type: 'RELEASE' } }),
    ).toBe(1)
    expect(
      await db.auditEvent.count({ where: { entityId: order.id, action: 'ORDER_CANCELLED' } }),
    ).toBe(1)
    expect(
      (await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).reserved,
    ).toBe(0)
    expect((await cancel(order.id, undefined, key)).body.data.id).toBe(order.id)
    expect((await place(input)).body.data.orderStatus).toBe('CANCELLED')
    expect(await db.inventoryMovement.count({ where: { balanceId, type: 'RESERVE' } })).toBe(1)
  })
  it('protects holds from concurrent physical counts and refuses customer access to other orders', async () => {
    const input = await body(),
      admin = await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'order-admin' } })
    const results = await Promise.allSettled([
      place(input),
      adjustStock(db, businessId, admin.id, randomUUID(), balanceId, {
        type: 'SET',
        quantity: 0,
        reason: 'Concurrent physical count',
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      }),
    ])
    expect(results).toHaveLength(2)
    const balance = await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })
    expect(balance.onHand).toBeGreaterThanOrEqual(balance.reserved)
    if (balance.reserved) expect(balance.onHand).toBe(10)
    if (!balance.onHand) expect(balance.reserved).toBe(0)
    // Use a seeded own order to verify read/cancel ownership independently of the race winner.
    const owned = await db.order.findFirstOrThrow({
      where: { customer: { authSubject: 'order-customer' } },
    })
    expect(
      (await request().get(`/api/v1/orders/${owned.id}`).set(headers('order-riya'))).status,
    ).toBe(404)
    expect((await cancel(owned.id, 'order-riya')).status).toBe(404)
    expect((await place(input, 'order-admin')).status).toBe(403)
    expect((await place(input, 'order-operator')).status).toBe(403)
  })
})
