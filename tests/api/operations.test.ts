import { beforeEach, afterAll, describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { createDatabase } from '@docklane/database'
import { DomainError } from '@docklane/domain'
import { createApp } from '../../apps/api/src/app.js'
import { seedDevelopment } from '../../scripts/seed-lib.js'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  new URL(url).pathname !== '/docklane_test' ||
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
)
  throw new Error('Operations checks require the isolated local docklane_test database.')
const db = createDatabase(url),
  businessId = 'northstar-supply'
const identities = [
  {
    authSubject: 'ops-admin',
    name: 'Ben Thomas',
    email: 'ops.admin@docklane.example.test',
    role: 'ADMIN' as const,
  },
  {
    authSubject: 'ops-customer',
    name: 'Aditi Menon',
    email: 'ops.customer@docklane.example.test',
    role: 'CUSTOMER' as const,
  },
  {
    authSubject: 'ops-other',
    name: 'Riya Nair',
    email: 'ops.other@docklane.example.test',
    role: 'CUSTOMER' as const,
  },
]
const app = createApp({
  db,
  businessId,
  origins: [],
  logLevel: 'silent',
  verifyIdentity: async (subject) => {
    const profile = identities.find((i) => i.authSubject === subject)
    if (!profile) throw new DomainError('UNAUTHORIZED', 'Invalid test identity.', 401)
    return { subject, name: profile.name, email: profile.email }
  },
})
const headers = (subject = 'ops-admin') => ({
  Authorization: `Bearer ${subject}`,
  'X-Docklane-Session': 'test-session',
})
const api = () => supertest(app)
let customerId: string, otherId: string
const site = 'ops-site'
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE public.businesses CASCADE')
  await seedDevelopment(db, identities)
  customerId = (await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'ops-customer' } }))
    .id
  otherId = (await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'ops-other' } })).id
  await db.warehouse.create({
    data: {
      id: site,
      code: 'OPS-SITE',
      name: 'Operations proof site',
      city: 'Kochi',
      address: 'Test site',
      lead: 'Test lead',
      businessId,
    },
  })
  for (const [sku, onHand, reserved, threshold, archived] of [
    ['OPS-A', 7, 2, 4, false],
    ['OPS-B', 2, 0, 3, false],
    ['OPS-C', 1, 1, 0, false],
    ['OPS-ARCHIVED', 99, 0, 12, true],
  ] as const) {
    await db.product.create({
      data: {
        sku,
        name: sku,
        category: 'Proof',
        image: '/product-placeholder.svg',
        color: '#eef1f4',
        pricePaise: 10000,
        businessId,
        archived,
      },
    })
    await db.inventoryBalance.create({
      data: { id: `${site}:${sku}`, sku, warehouseId: site, onHand, reserved, threshold },
    })
  }
})
afterAll(async () => {
  await db.$disconnect()
})
async function order(number: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return db.order.create({
    data: {
      number,
      businessId,
      customerId,
      customerName: 'Aditi Menon',
      warehouseId: site,
      subtotalPaise: 10000,
      totalPaise: 10000,
      currency: 'INR',
      deliveryAddress: { line: '12 Test Lane', city: 'Kochi', postalCode: '682001', country: 'IN' },
      createdAt: new Date(createdAt),
      ...overrides,
    },
  })
}
describe('operational metrics and discovery on PostgreSQL', () => {
  it('reconciles current stock with inventory, excluding archived products and separating low from out', async () => {
    const overview = await api().get(`/api/v1/workspace?warehouse=${site}`).set(headers())
    expect(overview.status).toBe(200)
    expect(overview.body.data.metrics).toMatchObject({
      availableUnits: 7,
      reservedUnits: 3,
      lowStockLevels: 1,
      outOfStockLevels: 1,
    })
    expect(overview.body.data.warehouses[0]).toMatchObject({ availableUnits: 7, reservedUnits: 3 })
    const stock = await api()
      .get(`/api/v1/inventory?warehouse=${site}&stock=attention`)
      .set(headers())
    expect(stock.body.pagination.total).toBe(2)
    expect(stock.body.summary.low + stock.body.summary.out).toBe(2)
  })
  it('includes both edges of an Indian calendar day and keeps current stock independent of dates', async () => {
    await order('OPS-BEFORE', '2026-11-18T18:29:59.999Z')
    await order('OPS-START', '2026-11-18T18:30:00.000Z')
    await order('OPS-END', '2026-11-19T18:29:59.999Z')
    await order('OPS-AFTER', '2026-11-19T18:30:00.000Z')
    const path = `warehouse=${site}&from=2026-11-19&to=2026-11-19`
    const overview = await api().get(`/api/v1/workspace?${path}`).set(headers())
    expect(overview.body.data.metrics).toMatchObject({
      orders: 2,
      openOrders: 2,
      availableUnits: 7,
    })
    const list = await api().get(`/api/v1/orders?${path}`).set(headers())
    expect(list.body.data.map((o: { number: string }) => o.number).sort()).toEqual([
      'OPS-END',
      'OPS-START',
    ])
  })
  it('uses the same queue definitions in the dashboard and paginated order list', async () => {
    await order('OPS-PAYMENT', '2026-11-19T00:00:00Z')
    await order('OPS-PACK', '2026-11-19T00:00:00Z', {
      orderStatus: 'CONFIRMED',
      paymentStatus: 'CAPTURED',
    })
    await order('OPS-SHIP', '2026-11-19T00:00:00Z', {
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'PACKED',
    })
    await order('OPS-REFUND', '2026-11-19T00:00:00Z', {
      orderStatus: 'CONFIRMED',
      paymentStatus: 'REFUND_PENDING',
    })
    const summary = (await api().get(`/api/v1/workspace?warehouse=${site}`).set(headers())).body
      .data
    expect(summary.queues).toMatchObject({
      open: 4,
      payment: 1,
      pack: 1,
      ship: 1,
      refund: 1,
      returns: 0,
    })
    for (const [queue, count] of Object.entries(summary.queues)) {
      const response = await api()
        .get(`/api/v1/orders?warehouse=${site}&queue=${queue}`)
        .set(headers())
      expect(response.status).toBe(200)
      expect(response.body.pagination.total).toBe(count)
    }
    const filtered = await api()
      .get(`/api/v1/orders?warehouse=${site}&payment=PARTIALLY_REFUNDED&fulfillment=PACKED`)
      .set(headers())
    expect(filtered.body.data.map((o: { number: string }) => o.number)).toEqual(['OPS-SHIP'])
  })
  it('counts captured money once and includes only succeeded refunds for the selected order cohort', async () => {
    const row = await order('OPS-MONEY', '2026-11-19T00:00:00Z', {
      paymentStatus: 'REFUND_PENDING',
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'SHIPPED',
    })
    const payment = await db.payment.create({
      data: {
        orderId: row.id,
        provider: 'test',
        providerIdempotencyKey: randomUUID(),
        amountPaise: 10000,
        status: 'REFUND_PENDING',
        currency: 'INR',
      },
    })
    for (const [amountPaise, status] of [
      [2500, 'SUCCEEDED'],
      [1000, 'REQUESTED'],
      [500, 'FAILED'],
    ] as const)
      await db.refundAttempt.create({
        data: {
          paymentId: payment.id,
          amountPaise,
          status,
          reason: 'Test metric',
          requestedBy: customerId,
          providerIdempotencyKey: randomUUID(),
        },
      })
    const result = await api()
      .get(`/api/v1/workspace?warehouse=${site}&from=2026-11-19&to=2026-11-19`)
      .set(headers())
    expect(result.status).toBe(200)
    expect(result.body.data.metrics).toMatchObject({ capturedPaise: 10000, refundedPaise: 2500 })
    const empty = await api()
      .get(`/api/v1/workspace?warehouse=${site}&from=2026-11-20`)
      .set(headers())
    expect(empty.body.data.metrics).toMatchObject({
      capturedPaise: 0,
      refundedPaise: 0,
      availableUnits: 7,
    })
  })
  it('finds partially restocked receipts and removes only fully inspected quantities from the return queue', async () => {
    const row = await order('OPS-RETURN', '2026-11-19T00:00:00Z', {
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'SHIPPED',
      paymentStatus: 'CAPTURED',
    })
    const item = await db.orderItem.create({
      data: {
        orderId: row.id,
        sku: 'OPS-A',
        name: 'Proof item',
        image: '/product-placeholder.svg',
        quantity: 2,
        unitPricePaise: 5000,
        totalPaise: 10000,
      },
    })
    const receipt = await db.returnReceipt.create({
      data: { orderId: row.id, reason: 'Test inspection', receivedBy: customerId },
    })
    const returned = await db.returnItem.create({
      data: { receiptId: receipt.id, orderItemId: item.id, quantity: 2, restockedQuantity: 1 },
    })
    expect(
      (await api().get(`/api/v1/orders?warehouse=${site}&queue=returns`).set(headers())).body
        .pagination.total,
    ).toBe(1)
    await db.returnItem.update({ where: { id: returned.id }, data: { restockedQuantity: 2 } })
    expect(
      (await api().get(`/api/v1/orders?warehouse=${site}&queue=returns`).set(headers())).body
        .pagination.total,
    ).toBe(0)
  })
  it('restricts quick search to customer-owned orders and hides warehouse records from customers', async () => {
    await order('OPS-OWN', '2026-11-19T00:00:00Z')
    await order('OPS-OTHER', '2026-11-19T00:00:00Z', {
      customerId: otherId,
      customerName: 'Riya Nair',
    })
    const own = await api().get('/api/v1/search?q=OPS').set(headers('ops-customer'))
    expect(own.status).toBe(200)
    expect(
      own.body.data
        .filter((r: { kind: string }) => r.kind === 'Order')
        .map((r: { label: string }) => r.label),
    ).toEqual(['OPS-OWN'])
    expect(own.body.data.some((r: { kind: string }) => r.kind === 'Warehouse')).toBe(false)
    const admin = await api().get('/api/v1/search?q=OPS').set(headers())
    expect(admin.body.data.some((r: { kind: string }) => r.kind === 'Warehouse')).toBe(true)
    expect(admin.body.data.some((r: { label: string }) => r.label === 'OPS-ARCHIVED')).toBe(false)
    expect((await api().get('/api/v1/workspace').set(headers('ops-customer'))).status).toBe(403)
  })
  it('rejects invalid dates, inverted ranges, unknown queues and overly broad search', async () => {
    for (const path of [
      '/workspace?from=2026-02-30',
      '/workspace?from=2026-11-20&to=2026-11-19',
      '/orders?queue=unknown',
      '/orders?from=2026-11-20&to=2026-11-19',
      '/search?q=a',
      `/search?q=${'x'.repeat(101)}`,
    ])
      expect((await api().get(`/api/v1${path}`).set(headers())).status).toBe(400)
  })
  it('bounds recent activity and scopes its order links to the selected warehouse', async () => {
    const row = await order('OPS-ACTIVITY', '2026-11-19T00:00:00Z')
    await db.auditEvent.create({
      data: {
        businessId,
        action: 'ORDER_PACKED',
        entityType: 'Order',
        entityId: row.id,
        actorId: customerId,
        metadata: {},
        createdAt: new Date('2026-11-19T01:00:00Z'),
      },
    })
    await db.auditEvent.create({
      data: {
        businessId,
        action: 'PRODUCT_UPDATED',
        entityType: 'Product',
        entityId: 'OPS-A',
        actorId: customerId,
        metadata: {},
        createdAt: new Date('2026-11-19T02:00:00Z'),
      },
    })
    const result = await api()
      .get(`/api/v1/workspace?warehouse=${site}&from=2026-11-19&to=2026-11-19`)
      .set(headers())
    expect(result.body.data.activity).toHaveLength(1)
    expect(result.body.data.activity[0]).toMatchObject({
      actor: 'Aditi Menon',
      action: 'ORDER_PACKED',
      href: `/workspace/orders/${row.id}`,
    })
  })
})
