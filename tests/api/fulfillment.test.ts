import { beforeEach, afterAll, describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { createDatabase } from '@docklane/database'
import {
  createReservedOrder,
  quoteCheckout,
  startPayment,
  reconcilePayment,
  packOrder,
  shipOrder,
  cancelUnpaidOrder,
  receiveReturn,
  restockReturn,
  requestRefund,
  compensatePayment,
  processOutboxEvent,
  expireOrder,
  DomainError,
} from '@docklane/domain'
import { createApp } from '../../apps/api/src/app.js'
import { seedDevelopment } from '../../scripts/seed-lib.js'
import { TestPaymentProvider } from './payment-provider.fixture.js'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Fulfillment checks require isolated local docklane_test.')
const db = createDatabase(url),
  businessId = 'northstar-supply'
const identities = [
  {
    authSubject: 'ful-admin',
    name: 'Ben Thomas',
    email: 'admin@ful.example.test',
    role: 'ADMIN' as const,
  },
  {
    authSubject: 'ful-operator',
    name: 'Priya Rao',
    email: 'operator@ful.example.test',
    role: 'OPERATOR' as const,
  },
  {
    authSubject: 'ful-customer',
    name: 'Aditi Menon',
    email: 'customer@ful.example.test',
    role: 'CUSTOMER' as const,
  },
  {
    authSubject: 'ful-other',
    name: 'Riya Nair',
    email: 'other@ful.example.test',
    role: 'CUSTOMER' as const,
  },
]
let provider: TestPaymentProvider
const actor = async (role = 'admin') =>
  (await db.userProfile.findUniqueOrThrow({ where: { authSubject: `ful-${role}` } })).id
const headers = (role = 'admin') => ({
  Authorization: `Bearer ful-${role}`,
  'X-Docklane-Session': 'synthetic-session',
})
const app = () =>
  createApp({
    db,
    businessId,
    origins: [],
    logLevel: 'silent',
    verifyIdentity: async (subject) => {
      const p = await db.userProfile.findUnique({ where: { authSubject: subject } })
      if (!p) throw new DomainError('UNAUTHORIZED', 'Invalid fixture identity.', 401)
      return { subject, name: p.name, email: p.email }
    },
    payments: {
      provider,
      returnOrigin: 'http://127.0.0.1:5173',
      verifyWebhook: () => {
        throw new Error('Unused fixture webhook')
      },
    },
  })
const operation = () => ({
  reason: 'Checked by fulfillment verification',
  idempotencyKey: randomUUID(),
})
const shipment = () => ({
  ...operation(),
  carrier: 'Test Carrier',
  trackingReference: 'TRACK-TEST-01',
  trackingUrl: 'https://example.test/tracking',
})
const command = (id: string, path: string, body: object, role = 'admin') =>
  supertest(app()).post(`/api/v1/orders/${id}/${path}`).set(headers(role)).send(body)
async function reserve(paid = true) {
  const customer = await actor('customer'),
    items = [
      { sku: 'AUD-001', quantity: 2 },
      { sku: 'BOT-004', quantity: 1 },
    ],
    quote = await quoteCheckout(db, businessId, items)
  const order = await createReservedOrder(db, businessId, customer, randomUUID(), {
    items,
    quoteFingerprint: quote.quoteFingerprint,
    deliveryAddress: { line: '12 Garden Lane', city: 'Kochi', postalCode: '682001', country: 'IN' },
    idempotencyKey: randomUUID(),
  })
  if (paid) {
    const session = await startPayment(
      db,
      businessId,
      customer,
      order.id,
      'http://127.0.0.1:5173',
      provider,
    )
    provider.pay(session.sessionId)
    const p = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    await reconcilePayment(db, businessId, p.id, provider)
  }
  return order
}
async function shipped() {
  const order = await reserve(),
    admin = await actor()
  await packOrder(db, businessId, admin, randomUUID(), order.id, operation())
  await shipOrder(db, businessId, admin, randomUUID(), order.id, shipment())
  return order
}
async function balances(orderId: string) {
  const r = await db.stockReservation.findMany({ where: { orderId } })
  return db.inventoryBalance.findMany({
    where: { id: { in: r.map((r) => r.balanceId) } },
    orderBy: { sku: 'asc' },
  })
}
async function refund(orderId: string, amountPaise: number) {
  const order = await requestRefund(db, businessId, await actor(), randomUUID(), orderId, {
    ...operation(),
    amountPaise,
  })
  return order.payment!.refunds[0]
}
async function failAudit(action: string, work: () => Promise<void>) {
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_phase6_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'Injected fulfillment audit failure'; END IF; RETURN NEW; END; $$`,
  )
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_phase6_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_phase6_audit()',
  )
  try {
    await work()
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_phase6_audit ON audit_events')
    await db.$executeRawUnsafe('DROP FUNCTION fail_phase6_audit()')
  }
}
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE public.businesses CASCADE')
  await db.$executeRawUnsafe('TRUNCATE TABLE public.outbox_events, public.webhook_receipts')
  await seedDevelopment(db, identities)
  provider = new TestPaymentProvider()
})
afterAll(async () => db.$disconnect())

describe('Phase 6 fulfillment, refunds and returns on PostgreSQL', () => {
  it('packs and ships once across concurrent retries and rejects changed retry payloads', async () => {
    const order = await reserve(),
      before = await balances(order.id),
      pack = operation()
    expect((await command(order.id, 'shipments', shipment())).body.error.code).toBe('PACK_REQUIRED')
    expect(
      (
        await Promise.all([
          command(order.id, 'packing', pack),
          command(order.id, 'packing', pack),
          command(order.id, 'packing', operation(), 'operator'),
        ])
      ).map((r) => r.status),
    ).toEqual([200, 200, 200])
    expect(
      (await command(order.id, 'packing', { ...pack, reason: 'Different reason' })).status,
    ).toBe(409)
    const input = shipment()
    expect(
      (
        await Promise.all([
          command(order.id, 'shipments', input),
          command(order.id, 'shipments', input),
          command(order.id, 'shipments', { ...input, idempotencyKey: randomUUID() }, 'operator'),
        ])
      ).map((r) => r.status),
    ).toEqual([200, 200, 200])
    const after = await balances(order.id)
    for (const [index, b] of before.entries()) {
      const quantity = order.items.find((i) => i.sku === b.sku)!.quantity
      expect(after[index]).toMatchObject({
        onHand: b.onHand - quantity,
        reserved: b.reserved - quantity,
        version: b.version + 1,
      })
    }
    expect(await db.shipment.count({ where: { orderId: order.id } })).toBe(1)
    expect(await db.inventoryMovement.count({ where: { orderId: order.id, type: 'SHIP' } })).toBe(2)
    expect(
      await db.auditEvent.count({ where: { entityId: order.id, action: 'ORDER_PACKED' } }),
    ).toBe(1)
    expect(
      await db.auditEvent.count({ where: { entityId: order.id, action: 'ORDER_SHIPPED' } }),
    ).toBe(1)
    expect(
      (await command(order.id, 'shipments', { ...shipment(), trackingReference: 'OTHER' })).body
        .error.code,
    ).toBe('SHIPMENT_ALREADY_RECORDED')
  })
  it('refuses unpaid, expired, cancelled, fully refunded and pending-refund shipments', async () => {
    const unpaid = await reserve(false)
    expect((await command(unpaid.id, 'packing', operation())).status).toBe(409)
    await db.order.update({ where: { id: unpaid.id }, data: { expiresAt: new Date(0) } })
    await expireOrder(db, businessId, unpaid.id)
    expect((await command(unpaid.id, 'shipments', shipment())).status).toBe(409)
    const cancelled = await reserve()
    await cancelUnpaidOrder(db, businessId, await actor(), randomUUID(), cancelled.id, operation())
    expect((await command(cancelled.id, 'shipments', shipment())).status).toBe(409)
    const paid = await reserve()
    await command(paid.id, 'packing', operation())
    const r = await refund(paid.id, paid.totalPaise)
    expect((await command(paid.id, 'shipments', shipment())).status).toBe(409)
    await compensatePayment(db, businessId, r.id, provider)
    expect((await command(paid.id, 'shipments', shipment())).status).toBe(409)
  })
  it('enforces staff operations, admin refunds, active roles and customer timeline ownership', async () => {
    const order = await shipped(),
      paths = [
        ['packing', operation()],
        ['shipments', shipment()],
        ['returns', { ...operation(), items: [{ sku: 'AUD-001', quantity: 1 }] }],
        ['returns/' + randomUUID() + '/restocks', { ...operation(), quantity: 1 }],
        ['refunds', { ...operation(), amountPaise: 100 }],
        ['refunds/' + randomUUID() + '/reconciliation', operation()],
      ] as const
    for (const [path, input] of paths)
      expect((await command(order.id, path, input, 'customer')).status).toBe(403)
    expect(
      (await command(order.id, 'refunds', { ...operation(), amountPaise: 100 }, 'operator')).status,
    ).toBe(403)
    expect(
      (await command('------------------------------------', 'packing', operation())).status,
    ).toBe(404)
    expect(
      (await supertest(app()).get(`/api/v1/orders/${order.id}/timeline`).set(headers('other')))
        .status,
    ).toBe(404)
    const timeline = await supertest(app())
      .get(`/api/v1/orders/${order.id}/timeline`)
      .set(headers('customer'))
    expect(timeline.status).toBe(200)
    expect(
      timeline.body.data.some(
        (e: { action: string; actor: string }) =>
          e.action === 'ORDER_SHIPPED' && e.actor === 'Ben Thomas',
      ),
    ).toBe(true)
    await db.userProfile.update({ where: { id: await actor('operator') }, data: { active: false } })
    expect(
      (
        await command(
          order.id,
          'returns',
          { ...operation(), items: [{ sku: 'AUD-001', quantity: 1 }] },
          'operator',
        )
      ).status,
    ).toBe(403)
  })
  it('rolls back shipment, stock consumption, audit and retry record together', async () => {
    const order = await reserve(),
      admin = await actor()
    await packOrder(db, businessId, admin, randomUUID(), order.id, operation())
    const before = await balances(order.id),
      input = shipment()
    await failAudit('ORDER_SHIPPED', async () => {
      await expect(
        shipOrder(db, businessId, admin, randomUUID(), order.id, input),
      ).rejects.toThrow()
      expect(await balances(order.id)).toEqual(before)
      expect(await db.shipment.count({ where: { orderId: order.id } })).toBe(0)
      expect(await db.idempotencyRecord.count({ where: { key: input.idempotencyKey } })).toBe(0)
    })
    await shipOrder(db, businessId, admin, randomUUID(), order.id, input)
    expect(await db.inventoryMovement.count({ where: { orderId: order.id, type: 'SHIP' } })).toBe(2)
  })
  it('serializes shipment against cancellation with a single stock outcome', async () => {
    const order = await reserve()
    await command(order.id, 'packing', operation())
    const result = await Promise.all([
      command(order.id, 'shipments', shipment()),
      command(order.id, 'cancellations', operation(), 'customer'),
    ])
    expect(result.map((r) => r.status).sort()).toEqual([200, 409])
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } }),
      reservations = await db.stockReservation.findMany({ where: { orderId: order.id } })
    expect(
      reservations.every(
        (r) => r.status === (saved.fulfillmentStatus === 'SHIPPED' ? 'CONSUMED' : 'RELEASED'),
      ),
    ).toBe(true)
    expect(
      await db.inventoryMovement.count({
        where: { orderId: order.id, type: { in: ['SHIP', 'RELEASE'] } },
      }),
    ).toBe(2)
  })
  it('receives without restocking and bounds concurrent receipts to shipped quantities', async () => {
    const order = await shipped(),
      before = await balances(order.id),
      input = { ...operation(), items: [{ sku: 'AUD-001', quantity: 2 }] }
    expect(
      (
        await command(order.id, 'returns', {
          ...operation(),
          items: [{ sku: 'BOT-004', quantity: 2 }],
        })
      ).body.error.code,
    ).toBe('RETURN_QUANTITY_EXCEEDED')
    expect(
      (
        await command(order.id, 'returns', {
          ...operation(),
          items: [{ sku: 'OTHER', quantity: 1 }],
        })
      ).status,
    ).toBe(409)
    const result = await Promise.all([
      command(order.id, 'returns', input),
      command(order.id, 'returns', { ...input, idempotencyKey: randomUUID() }, 'operator'),
    ])
    expect(result.map((r) => r.status).sort()).toEqual([201, 409])
    expect((await command(order.id, 'returns', input)).status).toBe(201)
    expect(await balances(order.id)).toEqual(before)
    expect(await db.returnItem.count({ where: { receipt: { orderId: order.id } } })).toBe(1)
    expect(
      (await command(order.id, 'returns', { ...input, items: [...input.items, ...input.items] }))
        .status,
    ).toBe(400)
  })
  it('refuses returns before shipment', async () => {
    const order = await reserve()
    expect(
      (
        await command(order.id, 'returns', {
          ...operation(),
          items: [{ sku: 'AUD-001', quantity: 1 }],
        })
      ).body.error.code,
    ).toBe('RETURN_UNAVAILABLE')
  })
  it('restocks received items once across concurrent commands and preserves stock history', async () => {
    const order = await shipped(),
      admin = await actor()
    await receiveReturn(db, businessId, admin, randomUUID(), order.id, {
      ...operation(),
      items: [{ sku: 'AUD-001', quantity: 2 }],
    })
    const item = await db.returnItem.findFirstOrThrow({
        where: { receipt: { orderId: order.id } },
      }),
      before = await balances(order.id),
      input = { ...operation(), quantity: 2 }
    const results = await Promise.all([
      command(order.id, `returns/${item.id}/restocks`, input),
      command(
        order.id,
        `returns/${item.id}/restocks`,
        { ...input, idempotencyKey: randomUUID() },
        'operator',
      ),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await command(order.id, `returns/${item.id}/restocks`, input)).status).toBe(200)
    expect(
      (await db.returnItem.findUniqueOrThrow({ where: { id: item.id } })).restockedQuantity,
    ).toBe(2)
    expect((await balances(order.id)).find((b) => b.sku === 'AUD-001')!.onHand).toBe(
      before.find((b) => b.sku === 'AUD-001')!.onHand + 2,
    )
    expect(await db.inventoryMovement.count({ where: { orderId: order.id, type: 'RETURN' } })).toBe(
      1,
    )
    const movement = await db.inventoryMovement.findFirstOrThrow({
      where: { orderId: order.id, type: 'RETURN' },
    })
    expect(movement.actorId).toBe(admin)
    expect(movement.reason).toBe(input.reason)
    expect(
      (await command(order.id, `returns/${item.id}/restocks`, { ...input, quantity: 1 })).status,
    ).toBe(409)
  })
  it('supports partial restocks and rejects a receipt belonging to another order', async () => {
    const order = await shipped(),
      other = await shipped(),
      admin = await actor()
    await receiveReturn(db, businessId, admin, randomUUID(), order.id, {
      ...operation(),
      items: [{ sku: 'AUD-001', quantity: 2 }],
    })
    const item = await db.returnItem.findFirstOrThrow({ where: { receipt: { orderId: order.id } } })
    expect(
      (await command(other.id, `returns/${item.id}/restocks`, { ...operation(), quantity: 1 }))
        .status,
    ).toBe(404)
    await restockReturn(db, businessId, admin, randomUUID(), order.id, item.id, {
      ...operation(),
      quantity: 1,
    })
    await restockReturn(db, businessId, admin, randomUUID(), order.id, item.id, {
      ...operation(),
      quantity: 1,
    })
    expect(
      (await db.returnItem.findUniqueOrThrow({ where: { id: item.id } })).restockedQuantity,
    ).toBe(2)
  })
  it('rolls back return receipts and restocking when their audit cannot be saved', async () => {
    const order = await shipped(),
      admin = await actor(),
      receipt = { ...operation(), items: [{ sku: 'AUD-001', quantity: 1 }] }
    await failAudit('RETURN_RECEIVED', async () => {
      await expect(
        receiveReturn(db, businessId, admin, randomUUID(), order.id, receipt),
      ).rejects.toThrow()
      expect(await db.returnReceipt.count({ where: { orderId: order.id } })).toBe(0)
    })
    await receiveReturn(db, businessId, admin, randomUUID(), order.id, receipt)
    const item = await db.returnItem.findFirstOrThrow({
        where: { receipt: { orderId: order.id } },
      }),
      before = await balances(order.id),
      restock = { ...operation(), quantity: 1 }
    await failAudit('RETURN_RESTOCKED', async () => {
      await expect(
        restockReturn(db, businessId, admin, randomUUID(), order.id, item.id, restock),
      ).rejects.toThrow()
      expect(await balances(order.id)).toEqual(before)
      expect(
        (await db.returnItem.findUniqueOrThrow({ where: { id: item.id } })).restockedQuantity,
      ).toBe(0)
    })
    await restockReturn(db, businessId, admin, randomUUID(), order.id, item.id, restock)
  })
  it('reserves concurrent refund amounts without exceeding captured payment', async () => {
    const order = await shipped(),
      before = await balances(order.id),
      input = { ...operation(), amountPaise: order.totalPaise - 100 }
    const results = await Promise.all([
      command(order.id, 'refunds', input),
      command(order.id, 'refunds', { ...input, idempotencyKey: randomUUID() }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([202, 409])
    expect((await command(order.id, 'refunds', input)).status).toBe(202)
    expect(await db.refundAttempt.count({ where: { payment: { orderId: order.id } } })).toBe(1)
    expect(await balances(order.id)).toEqual(before)
    expect((await command(order.id, 'refunds', { ...input, amountPaise: 1 })).body.error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    )
  })
  it('reconciles partial then full refunds without restocking or regressing shipped orders', async () => {
    const order = await shipped(),
      before = await balances(order.id),
      first = await refund(order.id, 100)
    await Promise.all([
      compensatePayment(db, businessId, first.id, provider),
      compensatePayment(db, businessId, first.id, provider),
    ])
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'PARTIALLY_REFUNDED',
    )
    const second = await refund(order.id, order.totalPaise - 100)
    await compensatePayment(db, businessId, second.id, provider)
    await compensatePayment(db, businessId, first.id, provider)
    const saved = await supertest(app()).get(`/api/v1/orders/${order.id}`).set(headers())
    expect(saved.body.data).toMatchObject({
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'SHIPPED',
      paymentStatus: 'REFUNDED',
      refundTotals: { refundedPaise: order.totalPaise, pendingPaise: 0, availablePaise: 0 },
    })
    expect(provider.refunds.size).toBe(2)
    expect(await balances(order.id)).toEqual(before)
    expect(
      await db.auditEvent.count({ where: { entityId: order.id, action: 'REFUND_SUCCEEDED' } }),
    ).toBe(2)
  })
  it('allows shipment after a completed partial refund', async () => {
    const order = await reserve(),
      r = await refund(order.id, 100)
    await compensatePayment(db, businessId, r.id, provider)
    expect((await command(order.id, 'packing', operation())).status).toBe(200)
    expect((await command(order.id, 'shipments', shipment())).status).toBe(200)
  })
  it('recovers a lost partial-refund response using the same provider operation', async () => {
    const order = await shipped(),
      r = await refund(order.id, 100)
    provider.failRefundAfterSave = true
    await expect(compensatePayment(db, businessId, r.id, provider)).rejects.toMatchObject({
      code: 'CONNECTION_LOST',
    })
    expect((await db.refundAttempt.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      'PROCESSING',
    )
    await compensatePayment(db, businessId, r.id, provider)
    expect(provider.refunds.size).toBe(1)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'PARTIALLY_REFUNDED',
    )
  })
  it('retains exhausted ambiguous refunds as reserved capacity for admin reconciliation', async () => {
    const order = await shipped(),
      r = await refund(order.id, order.totalPaise),
      event = await db.outboxEvent.findFirstOrThrow({
        where: { type: 'STRIPE_COMPENSATION', payload: { path: ['refundId'], equals: r.id } },
      })
    await db.refundAttempt.update({
      where: { id: r.id },
      data: { createdAt: new Date(Date.now() - 24 * 3600_000) },
    })
    await expect(processOutboxEvent(db, businessId, event.id, provider)).rejects.toMatchObject({
      code: 'REFUND_RECONCILIATION_REQUIRED',
    })
    expect((await db.refundAttempt.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      'RECONCILIATION_REQUIRED',
    )
    expect(provider.refunds.size).toBe(0)
    expect((await command(order.id, 'refunds', { ...operation(), amountPaise: 1 })).status).toBe(
      409,
    )
    expect(
      (await command(order.id, `refunds/${r.id}/reconciliation`, operation(), 'operator')).status,
    ).toBe(403)
    const input = operation()
    expect((await command(order.id, `refunds/${r.id}/reconciliation`, input)).status).toBe(202)
    expect((await command(order.id, `refunds/${r.id}/reconciliation`, input)).status).toBe(202)
  })
  it('releases refund capacity only for a definitive failed provider refund', async () => {
    const order = await shipped(),
      r = await refund(order.id, order.totalPaise),
      create = provider.refund.bind(provider)
    provider.refund = async (...args) => {
      const result = await create(...args)
      result.status = 'failed'
      provider.refunds.set(result.id, result)
      return result
    }
    await expect(compensatePayment(db, businessId, r.id, provider)).rejects.toMatchObject({
      code: 'REFUND_FAILED',
    })
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'CAPTURED',
    )
    provider.refund = create
    const retry = await refund(order.id, order.totalPaise)
    await compensatePayment(db, businessId, retry.id, provider)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'REFUNDED',
    )
    await expect(compensatePayment(db, businessId, r.id, provider)).rejects.toMatchObject({
      code: 'REFUND_FAILED',
    })
  })
  it('cancels paid packed orders and compensates only capacity not already reserved', async () => {
    const order = await reserve(),
      before = await balances(order.id)
    await command(order.id, 'packing', operation())
    const first = await refund(order.id, 100)
    const input = operation()
    const results = await Promise.all([
      command(order.id, 'cancellations', input, 'customer'),
      command(order.id, 'cancellations', input, 'customer'),
    ])
    expect(results.map((r) => r.status)).toEqual([200, 200])
    const attempts = await db.refundAttempt.findMany({ where: { payment: { orderId: order.id } } })
    expect(attempts).toHaveLength(2)
    expect(attempts.reduce((sum, r) => sum + r.amountPaise, 0)).toBe(order.totalPaise)
    await compensatePayment(db, businessId, first.id, provider)
    for (const r of attempts) await compensatePayment(db, businessId, r.id, provider)
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      orderStatus: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      fulfillmentStatus: 'UNFULFILLED',
    })
    const after = await balances(order.id)
    for (const [index, b] of before.entries()) expect(after[index].onHand).toBe(b.onHand)
    expect(
      await db.inventoryMovement.count({ where: { orderId: order.id, type: 'RELEASE' } }),
    ).toBe(2)
  })
  it('cancellation after a successful partial refund refunds only the remainder', async () => {
    const order = await reserve(),
      r = await refund(order.id, 100)
    await compensatePayment(db, businessId, r.id, provider)
    await command(order.id, 'cancellations', operation(), 'operator')
    const attempts = await db.refundAttempt.findMany({ where: { payment: { orderId: order.id } } })
    expect(attempts.find((r) => r.purpose === 'CANCELLATION')!.amountPaise).toBe(
      order.totalPaise - 100,
    )
  })
  it('rolls back paid cancellation and refund reservations on audit failure', async () => {
    const order = await reserve(),
      before = await balances(order.id),
      input = operation(),
      admin = await actor()
    await failAudit('ORDER_CANCELLED', async () => {
      await expect(
        cancelUnpaidOrder(db, businessId, admin, randomUUID(), order.id, input),
      ).rejects.toThrow()
      expect(await balances(order.id)).toEqual(before)
      expect(await db.refundAttempt.count({ where: { payment: { orderId: order.id } } })).toBe(0)
    })
    await failAudit('REFUND_REQUESTED', async () => {
      await expect(
        requestRefund(db, businessId, admin, randomUUID(), order.id, {
          ...operation(),
          amountPaise: 100,
        }),
      ).rejects.toThrow()
      expect(await db.refundAttempt.count({ where: { payment: { orderId: order.id } } })).toBe(0)
      expect(await db.outboxEvent.count({ where: { type: 'STRIPE_COMPENSATION' } })).toBe(0)
    })
  })
  it('rejects unsafe tracking URLs, invalid amounts and unassociated provider refunds', async () => {
    const order = await shipped()
    expect(
      (await command(order.id, 'shipments', { ...shipment(), trackingUrl: 'javascript:alert(1)' }))
        .status,
    ).toBe(400)
    expect((await command(order.id, 'refunds', { ...operation(), amountPaise: 0 })).status).toBe(
      400,
    )
    const r = await refund(order.id, 100),
      intent = provider.intents.get(
        r.paymentId
          ? (await db.payment.findUniqueOrThrow({ where: { id: r.paymentId } })).providerReference!
          : '',
      )!
    intent.currency = 'usd'
    await expect(compensatePayment(db, businessId, r.id, provider)).rejects.toMatchObject({
      code: 'REFUND_ASSOCIATION_INVALID',
    })
    expect(provider.refunds.size).toBe(0)
  })
})
