import { beforeEach, afterAll, describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { createDatabase } from '@docklane/database'
import { DomainError } from '@docklane/domain'
import { createApp } from '../../apps/api/src/app.js'
import { seedDevelopment, type SeedIdentity } from '../../scripts/seed-lib.js'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Inventory tests require the isolated local docklane_test database.')
const db = createDatabase(url)
const businessId = 'northstar-supply'
const identities: SeedIdentity[] = [
  {
    authSubject: 'inventory-admin',
    name: 'Ben Thomas',
    email: 'admin@docklane.example.test',
    role: 'ADMIN',
  },
  {
    authSubject: 'inventory-operator',
    name: 'Priya Rao',
    email: 'operator@docklane.example.test',
    role: 'OPERATOR',
  },
  {
    authSubject: 'inventory-customer',
    name: 'Aditi Menon',
    email: 'aditi.menon@docklane.example.test',
    role: 'CUSTOMER',
  },
  {
    authSubject: 'inventory-riya',
    name: 'Riya Nair',
    email: 'riya.nair@docklane.example.test',
    role: 'CUSTOMER',
  },
]
// Identity cryptography/session validation are covered by foundation.test.ts.
// These tests use the actual database roles and production mutation services.
const app = createApp({
  db,
  businessId,
  origins: ['http://localhost:5173'],
  logLevel: 'silent',
  verifyIdentity: async (token) => {
    const identity = identities.find((identity) => identity.authSubject === token)
    if (!identity) throw new DomainError('UNAUTHORIZED', 'Invalid test identity.', 401)
    return { subject: identity.authSubject, name: identity.name, email: identity.email }
  },
})
const headers = (role: 'admin' | 'operator' | 'customer' = 'admin') => ({
  Authorization: `Bearer inventory-${role}`,
  'X-Docklane-Session': 'local-test-session',
})
const request = () => supertest(app)
const balanceId = 'AUD-001@kochi'
const adjustment = (overrides: Record<string, unknown> = {}) => ({
  type: 'INCREASE',
  quantity: 2,
  reason: 'Count verified during local test',
  expectedVersion: 0,
  idempotencyKey: randomUUID(),
  ...overrides,
})
async function newProduct() {
  const response = await request()
    .post('/api/v1/products')
    .set(headers())
    .send({
      sku: `T-${randomUUID().slice(0, 20).toUpperCase()}`,
      name: 'Field Notes Case',
      category: 'Accessories',
      pricePaise: 45900,
    })
  expect(response.status).toBe(201)
  return response.body.data as { sku: string; version: number; image: string; color: string }
}
async function newWarehouse() {
  const response = await request()
    .post('/api/v1/warehouses')
    .set(headers())
    .send({
      code: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Pune Studio',
      city: 'Pune',
      address: '18 Garden Road, Pune 411001',
      lead: 'Local Test Lead',
      priority: 4,
    })
  expect(response.status).toBe(201)
  return response.body.data as { id: string; version: number }
}
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE public.businesses CASCADE')
  await seedDevelopment(db, identities)
})
afterAll(async () => {
  await db.$disconnect()
})

describe('Phase 3 stock and catalog on PostgreSQL', () => {
  it('combines search, warehouse, stock filters, stable sorting, and bounded pagination', async () => {
    const response = await request()
      .get('/api/v1/inventory?q=SUN-006&warehouse=bengaluru&stock=low')
      .set(headers())
    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0]).toMatchObject({
      sku: 'SUN-006',
      warehouseId: 'bengaluru',
      available: 8,
    })
    const first = await request()
      .get('/api/v1/inventory?sort=available&direction=asc&pageSize=8')
      .set(headers())
    expect(first.body.data).toHaveLength(8)
    expect(first.body.data[0].available).toBe(0)
    expect(first.body.pagination).toMatchObject({ total: 24, pages: 3 })
    const second = await request()
      .get('/api/v1/inventory?sort=available&direction=asc&pageSize=8&page=2')
      .set(headers())
    expect(
      first.body.data
        .map((row: { id: string }) => row.id)
        .filter((id: string) => second.body.data.some((row: { id: string }) => row.id === id)),
    ).toEqual([])
    expect((await request().get('/api/v1/inventory?pageSize=1000').set(headers())).status).toBe(400)
  })
  it('keeps staff stock private, grants Operators adjustments, and reserves resource management for Admins', async () => {
    for (const path of ['/inventory', '/products', '/products/categories', '/warehouses'])
      expect((await request().get(`/api/v1${path}`).set(headers('customer'))).status).toBe(403)
    expect((await request().get('/api/v1/catalog').set(headers('customer'))).status).toBe(200)
    expect((await request().get('/api/v1/inventory').set(headers('operator'))).status).toBe(200)
    expect(
      (await request().post('/api/v1/products').set(headers('operator')).send({})).status,
    ).toBe(403)
    expect(
      (await request().post('/api/v1/warehouses').set(headers('operator')).send({})).status,
    ).toBe(403)
    expect(
      (
        await request()
          .post(`/api/v1/inventory/${balanceId}/adjustments`)
          .set(headers('operator'))
          .send(adjustment())
      ).status,
    ).toBe(200)
  })
  it('validates immutable SKUs, whole-paise prices, unique warehouse codes, and strict payloads', async () => {
    const product = await newProduct()
    expect(product.image).toBe('/product-placeholder.svg')
    expect(
      (
        await request()
          .post('/api/v1/products')
          .set(headers())
          .send({ sku: product.sku, name: 'Duplicate', category: 'Cases', pricePaise: 100 })
      ).status,
    ).toBe(409)
    expect(
      (
        await request()
          .patch(`/api/v1/products/${product.sku}`)
          .set(headers())
          .send({ sku: 'RENAMED', expectedVersion: 0 })
      ).status,
    ).toBe(400)
    expect(
      (
        await request()
          .post('/api/v1/products')
          .set(headers())
          .send({ sku: 'INVALID', name: 'Case', category: 'Cases', pricePaise: 2.5 })
      ).status,
    ).toBe(400)
    const warehouse = await newWarehouse()
    const row = await db.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } })
    expect(
      (
        await request().post('/api/v1/warehouses').set(headers()).send({
          code: row.code,
          name: 'Duplicate Warehouse',
          city: 'Pune',
          address: '18 Garden Road',
          lead: 'Lead',
        })
      ).status,
    ).toBe(409)
  })
  it('creates an empty stock level with an audit and rejects duplicate or archived tracking', async () => {
    const product = await newProduct(),
      warehouse = await newWarehouse()
    const response = await request()
      .post('/api/v1/inventory')
      .set(headers('operator'))
      .send({ sku: product.sku, warehouseId: warehouse.id })
    expect(response.status).toBe(201)
    expect(
      await db.inventoryBalance.findUniqueOrThrow({ where: { id: response.body.data.id } }),
    ).toMatchObject({ onHand: 0, reserved: 0, version: 0 })
    expect(
      await db.auditEvent.count({
        where: { entityId: response.body.data.id, action: 'STOCK_LEVEL_CREATED' },
      }),
    ).toBe(1)
    expect(
      (
        await request()
          .post('/api/v1/inventory')
          .set(headers())
          .send({ sku: product.sku, warehouseId: warehouse.id })
      ).status,
    ).toBe(409)
    await request()
      .patch(`/api/v1/products/${product.sku}`)
      .set(headers())
      .send({ archived: true, expectedVersion: 0 })
    expect(
      (
        await request()
          .post('/api/v1/inventory')
          .set(headers())
          .send({ sku: product.sku, warehouseId: 'kochi' })
      ).body.error.code,
    ).toBe('RESOURCE_ARCHIVED')
  })
  it('commits an adjustment, movement, version, and audit together and replays it exactly once', async () => {
    const input = adjustment()
    const response = await request()
      .post(`/api/v1/inventory/${balanceId}/adjustments`)
      .set(headers())
      .send(input)
    expect(response.status).toBe(200)
    expect(response.body.data.balance).toMatchObject({
      onHand: 88,
      reserved: 1,
      available: 87,
      version: 1,
    })
    const movement = await db.inventoryMovement.findUniqueOrThrow({
      where: { id: response.body.data.movementId },
    })
    expect(movement).toMatchObject({
      deltaOnHand: 2,
      deltaReserved: 0,
      onHandAfter: 88,
      reservedAfter: 1,
      balanceVersion: 1,
    })
    expect(
      await db.auditEvent.count({ where: { entityId: balanceId, action: 'STOCK_ADJUSTED' } }),
    ).toBe(1)
    const replay = await request()
      .post(`/api/v1/inventory/${balanceId}/adjustments`)
      .set(headers())
      .send(input)
    expect(replay.status).toBe(200)
    expect(replay.body.data).toEqual(response.body.data)
    expect(await db.inventoryMovement.count({ where: { balanceId, type: 'ADJUST' } })).toBe(1)
  })
  it('protects reserved stock and rejects fractions, zero deltas, and stale absolute counts', async () => {
    for (const input of [
      adjustment({ type: 'SET', quantity: 0 }),
      adjustment({ type: 'DECREASE', quantity: 86 }),
    ])
      expect(
        (
          await request()
            .post(`/api/v1/inventory/${balanceId}/adjustments`)
            .set(headers())
            .send(input)
        ).body.error.code,
      ).toBe('RESERVED_STOCK')
    expect(
      (
        await request()
          .post(`/api/v1/inventory/${balanceId}/adjustments`)
          .set(headers())
          .send(adjustment({ quantity: 1.2 }))
      ).status,
    ).toBe(400)
    expect(
      (
        await request()
          .post(`/api/v1/inventory/${balanceId}/adjustments`)
          .set(headers())
          .send(adjustment({ type: 'SET', quantity: 86 }))
      ).body.error.code,
    ).toBe('NO_STOCK_CHANGE')
    await request()
      .post(`/api/v1/inventory/${balanceId}/adjustments`)
      .set(headers())
      .send(adjustment())
    expect(
      (
        await request()
          .post(`/api/v1/inventory/${balanceId}/adjustments`)
          .set(headers())
          .send(adjustment({ type: 'SET', quantity: 90 }))
      ).body.error.code,
    ).toBe('STALE_VERSION')
    expect((await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).onHand).toBe(
      88,
    )
  })
  it('serializes competing edits so only one stale-version command commits', async () => {
    const results = await Promise.all(
      [adjustment(), adjustment()].map((input) =>
        request().post(`/api/v1/inventory/${balanceId}/adjustments`).set(headers()).send(input),
      ),
    )
    expect(results.map((response) => response.status).sort()).toEqual([200, 409])
    expect((await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).onHand).toBe(
      88,
    )
    expect(await db.inventoryMovement.count({ where: { balanceId, type: 'ADJUST' } })).toBe(1)
  })
  it('serializes simultaneous identical retries and rejects key reuse for another payload or balance', async () => {
    const input = adjustment()
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request().post(`/api/v1/inventory/${balanceId}/adjustments`).set(headers()).send(input),
      ),
    )
    expect(results.map((response) => response.status)).toEqual([200, 200, 200])
    expect(new Set(results.map((response) => response.body.data.movementId)).size).toBe(1)
    for (const [id, changed] of [
      [balanceId, { ...input, quantity: 4 }],
      ['AUD-001@bengaluru', input],
    ] as const)
      expect(
        (await request().post(`/api/v1/inventory/${id}/adjustments`).set(headers()).send(changed))
          .body.error.code,
      ).toBe('IDEMPOTENCY_CONFLICT')
  })
  it('rolls back balance, movement, and retry state when the audit insert fails', async () => {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_test_stock_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'STOCK_ADJUSTED' THEN RAISE EXCEPTION 'Injected test audit failure'; END IF; RETURN NEW; END; $$`,
    )
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_test_stock_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_test_stock_audit()',
    )
    try {
      const response = await request()
        .post(`/api/v1/inventory/${balanceId}/adjustments`)
        .set(headers())
        .send(adjustment())
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(
        (await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).onHand,
      ).toBe(86)
      expect(await db.inventoryMovement.count({ where: { balanceId, type: 'ADJUST' } })).toBe(0)
      expect(await db.idempotencyRecord.count()).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_test_stock_audit ON audit_events')
      await db.$executeRawUnsafe('DROP FUNCTION fail_test_stock_audit()')
    }
  })
  it('enforces movement immutability in PostgreSQL and reconciles the ledger after valid changes', async () => {
    const response = await request()
      .post(`/api/v1/inventory/${balanceId}/adjustments`)
      .set(headers())
      .send(adjustment())
    const id = response.body.data.movementId
    await expect(
      db.inventoryMovement.update({ where: { id }, data: { reason: 'Rewrite' } }),
    ).rejects.toThrow()
    await expect(db.inventoryMovement.delete({ where: { id } })).rejects.toThrow()
    const mismatches = await db.$queryRaw<
      { id: string }[]
    >`SELECT b.id FROM inventory_balances b LEFT JOIN inventory_movements m ON m."balanceId" = b.id GROUP BY b.id HAVING b."onHand" <> COALESCE(SUM(m."deltaOnHand"), 0) OR b.reserved <> COALESCE(SUM(m."deltaReserved"), 0)`
    expect(mismatches).toEqual([])
  })
  it('audits thresholds without changing quantities and invalidates an older stock edit', async () => {
    const response = await request()
      .patch(`/api/v1/inventory/${balanceId}/threshold`)
      .set(headers('operator'))
      .send({ threshold: 20, expectedVersion: 0, reason: 'Updated reorder planning' })
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ threshold: 20, version: 1 })
    expect(await db.inventoryMovement.count({ where: { balanceId, type: 'ADJUST' } })).toBe(0)
    expect(
      await db.auditEvent.count({
        where: { entityId: balanceId, action: 'STOCK_THRESHOLD_CHANGED' },
      }),
    ).toBe(1)
    expect(
      (
        await request()
          .post(`/api/v1/inventory/${balanceId}/adjustments`)
          .set(headers())
          .send(adjustment())
      ).body.error.code,
    ).toBe('STALE_VERSION')
  })
  it('preserves order price snapshots and image/color fields when catalog metadata changes', async () => {
    const before = await db.orderItem.findFirstOrThrow({ where: { sku: 'AUD-001' } })
    const product = await db.product.findUniqueOrThrow({ where: { sku: 'AUD-001' } })
    const response = await request()
      .patch('/api/v1/products/AUD-001')
      .set(headers())
      .send({ pricePaise: 12345, expectedVersion: 0 })
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      pricePaise: 12345,
      image: product.image,
      color: product.color,
    })
    expect(
      (await db.orderItem.findUniqueOrThrow({ where: { id: before.id } })).unitPricePaise,
    ).toBe(before.unitPricePaise)
    expect(
      (await request().get('/api/v1/catalog/AUD-001').set(headers('customer'))).body.data
        .pricePaise,
    ).toBe(12345)
    expect(
      (
        await request()
          .patch('/api/v1/products/AUD-001')
          .set(headers())
          .send({ archived: true, expectedVersion: 1 })
      ).body.error.code,
    ).toBe('RESERVED_STOCK')
  })
  it('hides archived products from customers while keeping their remaining physical stock recoverable', async () => {
    const product = await newProduct(),
      warehouse = await newWarehouse()
    const created = await request()
      .post('/api/v1/inventory')
      .set(headers())
      .send({ sku: product.sku, warehouseId: warehouse.id })
    const id = created.body.data.id
    await request()
      .post(`/api/v1/inventory/${id}/adjustments`)
      .set(headers())
      .send(adjustment({ quantity: 4 }))
    await request()
      .patch(`/api/v1/products/${product.sku}`)
      .set(headers())
      .send({ archived: true, expectedVersion: 0 })
    expect(
      (await request().get(`/api/v1/catalog/${product.sku}`).set(headers('customer'))).status,
    ).toBe(404)
    expect(
      (await request().get(`/api/v1/inventory?q=${product.sku}`).set(headers())).body.data,
    ).toEqual([])
    expect(
      (await request().get(`/api/v1/inventory?q=${product.sku}&archive=all`).set(headers())).body
        .data,
    ).toHaveLength(1)
    expect(
      (
        await request()
          .post(`/api/v1/inventory/${id}/adjustments`)
          .set(headers())
          .send(adjustment({ expectedVersion: 1 }))
      ).body.error.code,
    ).toBe('RESOURCE_ARCHIVED')
    expect(
      (
        await request()
          .post(`/api/v1/inventory/${id}/adjustments`)
          .set(headers())
          .send(adjustment({ type: 'DECREASE', quantity: 4, expectedVersion: 1 }))
      ).status,
    ).toBe(200)
    expect(
      (
        await request()
          .patch(`/api/v1/warehouses/${warehouse.id}`)
          .set(headers())
          .send({ archived: true, expectedVersion: 0 })
      ).status,
    ).toBe(200)
  })
  it('archives only clear warehouses, restores them, and preserves fulfillment priority on a name edit', async () => {
    expect(
      (
        await request()
          .patch('/api/v1/warehouses/kochi')
          .set(headers())
          .send({ archived: true, expectedVersion: 0 })
      ).body.error.code,
    ).toBe('WAREHOUSE_IN_USE')
    const warehouse = await newWarehouse()
    const edited = await request()
      .patch(`/api/v1/warehouses/${warehouse.id}`)
      .set(headers())
      .send({ name: 'Pune Workshop', expectedVersion: 0 })
    expect(edited.body.data.priority).toBe(4)
    expect(
      (
        await request()
          .patch(`/api/v1/warehouses/${warehouse.id}`)
          .set(headers())
          .send({ archived: true, expectedVersion: 1 })
      ).status,
    ).toBe(200)
    expect(
      (await request().get('/api/v1/warehouses').set(headers())).body.data.some(
        (row: { id: string }) => row.id === warehouse.id,
      ),
    ).toBe(false)
    expect(
      (
        await request()
          .patch(`/api/v1/warehouses/${warehouse.id}`)
          .set(headers())
          .send({ archived: false, expectedVersion: 2 })
      ).status,
    ).toBe(200)
  })
  it('prevents foreign-business records from entering stock and resource queries', async () => {
    await db.business.create({ data: { id: 'other-business', name: 'Other Business' } })
    await db.product.create({
      data: {
        sku: 'OTHER-SKU',
        name: 'Other Product',
        category: 'Cases',
        pricePaise: 100,
        image: '/product-placeholder.svg',
        color: '#EDF2E8',
        businessId: 'other-business',
      },
    })
    await db.warehouse.create({
      data: {
        id: 'other-warehouse',
        code: 'OTHER-01',
        name: 'Other Warehouse',
        city: 'Pune',
        address: 'Other address',
        lead: 'Other lead',
        businessId: 'other-business',
      },
    })
    await db.inventoryBalance.create({
      data: { id: 'other-balance', sku: 'OTHER-SKU', warehouseId: 'other-warehouse' },
    })
    expect((await request().get('/api/v1/inventory/other-balance').set(headers())).status).toBe(404)
    expect((await request().get('/api/v1/catalog/OTHER-SKU').set(headers('customer'))).status).toBe(
      404,
    )
    expect(
      (
        await request()
          .post('/api/v1/inventory')
          .set(headers())
          .send({ sku: 'OTHER-SKU', warehouseId: 'kochi' })
      ).status,
    ).toBe(404)
    expect((await request().get('/api/v1/warehouses/other-warehouse').set(headers())).status).toBe(
      404,
    )
  })
})
