import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { format } from 'prettier'
import supertest from 'supertest'
import { createDatabase } from '@docklane/database'
import { adjustStock, DomainError } from '@docklane/domain'
import { createApp } from '../apps/api/src/app.js'
import type { OrderDetail } from '@docklane/contracts'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Concurrency proof requires the isolated loopback docklane_test database.')
const db = createDatabase(url),
  businessId = `proof-${randomUUID()}`,
  sku = `PROOF-${randomUUID().slice(0, 8).toUpperCase()}`,
  site = `proof-${randomUUID()}`,
  balanceId = randomUUID()
const customers = Array.from({ length: 50 }, (_, i) => `proof-${businessId}-${i}`),
  adminSubject = `proof-admin-${businessId}`
const app = createApp({
  db,
  businessId,
  origins: [],
  logLevel: 'silent',
  verifyIdentity: async (subject) => {
    const profile = await db.userProfile.findUnique({ where: { authSubject: subject } })
    if (!profile || profile.businessId !== businessId)
      throw new DomainError('UNAUTHORIZED', 'Invalid proof identity.', 401)
    return { subject, name: profile.name, email: profile.email }
  },
})
const headers = (subject: string) => ({
  Authorization: `Bearer ${subject}`,
  'X-Docklane-Session': 'loopback-proof-session',
})
let orders: OrderDetail[] = []
try {
  await db.business.create({ data: { id: businessId, name: 'Isolated concurrency proof' } })
  await db.userProfile.createMany({
    data: [
      ...customers.map((authSubject) => ({
        authSubject,
        name: 'Proof Customer',
        email: `${authSubject}@example.test`,
        businessId,
        role: 'CUSTOMER' as const,
      })),
      {
        authSubject: adminSubject,
        name: 'Proof Admin',
        email: `${adminSubject}@example.test`,
        businessId,
        role: 'ADMIN' as const,
      },
    ],
  })
  await db.product.create({
    data: {
      sku,
      name: 'Concurrency proof item',
      category: 'Verification',
      pricePaise: 10000,
      image: '/product-placeholder.svg',
      color: '#E9EEE4',
      businessId,
    },
  })
  await db.warehouse.create({
    data: {
      id: site,
      code: sku,
      name: 'Proof site',
      city: 'Kochi',
      address: 'Isolated loopback verification site',
      lead: 'Proof Admin',
      businessId,
    },
  })
  await db.inventoryBalance.create({ data: { id: balanceId, sku, warehouseId: site } })
  const admin = await db.userProfile.findUniqueOrThrow({ where: { authSubject: adminSubject } })
  await adjustStock(db, businessId, admin.id, randomUUID(), balanceId, {
    type: 'INCREASE',
    quantity: 10,
    reason: 'Ten units for isolated concurrency proof',
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  })
  const items = [{ sku, quantity: 1 }]
  const quote = await supertest(app)
    .post('/api/v1/checkout/quote')
    .set(headers(customers[0]))
    .send({ items })
  if (quote.status !== 200) throw new Error('Could not quote the isolated fixture.')
  const start = performance.now()
  // Every promise starts before any response is awaited. Each customer has a
  // distinct key/account; no worker or expiry processing runs in this harness.
  const results = await Promise.all(
    customers.map((subject) =>
      supertest(app)
        .post('/api/v1/orders')
        .set(headers(subject))
        .send({
          items,
          deliveryAddress: {
            line: '12 Proof Lane',
            city: 'Kochi',
            postalCode: '682001',
            country: 'IN',
          },
          quoteFingerprint: quote.body.data.quoteFingerprint,
          idempotencyKey: randomUUID(),
        }),
    ),
  )
  const duration = Math.round(performance.now() - start)
  orders = results
    .filter((result) => result.status === 201)
    .map((result) => result.body.data as OrderDetail)
  const rejected = results.filter(
    (result) => result.status === 409 && result.body.error.code === 'INSUFFICIENT_STOCK',
  ).length
  const stock = await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })
  const holds = await db.stockReservation.count({ where: { balanceId, status: 'HELD' } })
  const movements = await db.inventoryMovement.count({ where: { balanceId, type: 'RESERVE' } })
  const [{ version }] = await db.$queryRaw<{ version: string }[]>`SELECT version()`
  if (
    orders.length !== 10 ||
    rejected !== 40 ||
    holds !== 10 ||
    movements !== 10 ||
    stock.onHand !== 10 ||
    stock.reserved !== 10 ||
    new Set(orders.map((order) => order.id)).size !== 10
  )
    throw new Error('Concurrency proof did not meet its correctness checks.')
  const report = `# Docklane checkout concurrency proof\n\nVerified: ${new Date().toISOString()}.\n\n| Measurement | Result |\n| --- | --- |\n| Available units before requests | 10 |\n| Simultaneous distinct customer requests | 50 |\n| Successful orders/reservations | 10 |\n| Insufficient-stock responses | 40 |\n| Other responses | 0 |\n| On-hand units after requests | 10 |\n| Reserved units after requests | 10 |\n| Available units after requests | 0 |\n| Reservation movements | 10 |\n| Unique order IDs | 10 |\n| Request batch elapsed time | ${duration} ms |\n\nEnvironment: Node ${process.version}; ${version}; Windows loopback; application pool limited to 10 connections.\n\nRun \`npm run prove:concurrency\` after local migrations and shared-package compilation. The harness uses the production Express routes and reservation service against the dedicated \`docklane_test\` database. Its synthetic identity verifier replaces cloud Auth; real roles and database checks remain active. All 50 requests start before responses are awaited. No expiry worker runs during the proof. This is correctness evidence, not a hosted performance benchmark.\n\nThe harness uses its own business, product, site, and 50 customer profiles. It cancels successful orders, reconciles the ledger, clears physical fixture stock through an adjustment, and archives its product/site. Durable order/movement history remains in the test database.\n`
  await mkdir('docs', { recursive: true })
  await writeFile('docs/CONCURRENCY_PROOF.md', await format(report, { parser: 'markdown' }))
  console.log(
    `Concurrency proof passed: 10 reservations, 40 insufficient-stock responses, 0 available units (${duration} ms).`,
  )
} catch {
  console.error('Concurrency proof failed; connection details are suppressed.')
  process.exitCode = 1
} finally {
  await clearProof()
  await db.$disconnect()
}

async function clearProof() {
  try {
    const created = await db.order.findMany({ where: { businessId }, select: { id: true } })
    for (const order of created) {
      const result = await supertest(app)
        .post(`/api/v1/orders/${order.id}/cancellations`)
        .set(headers(adminSubject))
        .send({ reason: 'Clear completed concurrency proof hold', idempotencyKey: randomUUID() })
      if (result.status !== 200) throw new Error('Fixture cancellation failed.')
    }
    const stock = await db.inventoryBalance.findUnique({ where: { id: balanceId } })
    if (stock) {
      const sums = await db.inventoryMovement.aggregate({
        where: { balanceId },
        _sum: { deltaOnHand: true, deltaReserved: true },
      })
      if (
        stock.reserved ||
        sums._sum.deltaOnHand !== stock.onHand ||
        sums._sum.deltaReserved !== stock.reserved
      )
        throw new Error('Proof ledger reconciliation failed.')
      const admin = await db.userProfile.findUniqueOrThrow({ where: { authSubject: adminSubject } })
      if (stock.onHand)
        await adjustStock(db, businessId, admin.id, randomUUID(), balanceId, {
          type: 'SET',
          quantity: 0,
          reason: 'Clear completed proof fixture',
          expectedVersion: stock.version,
          idempotencyKey: randomUUID(),
        })
      await db.product.update({ where: { sku }, data: { archived: true } })
      await db.warehouse.update({ where: { id: site }, data: { archived: true } })
      console.log('Proof holds released; ledger reconciles; isolated fixture archived.')
    }
  } catch {
    console.error('Proof cleanup requires review; no seeded stock was touched.')
    process.exitCode = 1
  }
}
