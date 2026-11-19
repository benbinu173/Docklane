import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { cpus, totalmem, platform } from 'node:os'
import { writeFile, mkdir } from 'node:fs/promises'
import { config } from 'dotenv'
import { createDatabase, Prisma } from '@docklane/database'
import { createApp } from '../apps/api/src/app.js'
import { DomainError } from '@docklane/domain'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  !['postgres:', 'postgresql:'].includes(new URL(url).protocol) ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Benchmarks require the dedicated loopback docklane_test database.')
const argument = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1]
const reused = argument('fixture')
if (reused && !/^benchmark-[a-f0-9-]{36}$/.test(reused))
  throw new Error('Use a fixture ID printed by a previous benchmark.')
const label = argument('label') ?? 'latest'
if (!/^[a-z0-9-]{1,30}$/.test(label))
  throw new Error('The report label must contain letters, digits, or hyphens.')
const businessId = reused ?? `benchmark-${randomUUID()}`
const db = createDatabase(url)
const now = Date.now()
const sku = (index: number) => `${businessId}-SKU-${String(index).padStart(4, '0')}`
const warehouse = (index: number) => `${businessId}-W-${String(index).padStart(2, '0')}`
const balanceId = (product: string, site: string) => `${product}@${site}`
async function batches<T>(rows: T[], save: (chunk: T[]) => Promise<unknown>) {
  for (let offset = 0; offset < rows.length; offset += 400)
    await save(rows.slice(offset, offset + 400))
}
async function loadFixture(db: Prisma.TransactionClient) {
  await db.business.create({
    data: { id: businessId, name: 'Representative operations benchmark' },
  })
  const adminId = randomUUID()
  const customers = Array.from({ length: 100 }, () => randomUUID())
  await db.userProfile.createMany({
    data: [
      {
        id: adminId,
        authSubject: `${businessId}:admin`,
        name: 'Benchmark admin',
        email: 'benchmark-admin@example.test',
        role: 'ADMIN',
        businessId,
      },
      ...customers.map((id, index) => ({
        id,
        authSubject: `${businessId}:customer-${index}`,
        name: `Benchmark customer ${index}`,
        email: `customer-${index}@example.test`,
        role: 'CUSTOMER' as const,
        businessId,
      })),
    ],
  })
  await db.product.createMany({
    data: Array.from({ length: 1000 }, (_, index) => ({
      sku: sku(index),
      name: `Benchmark product ${String(index).padStart(4, '0')}`,
      category: `Category ${index % 10}`,
      pricePaise: 12500,
      image: '/product-placeholder.svg',
      color: '#E9EEE4',
      businessId,
    })),
  })
  await db.warehouse.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      id: warehouse(index),
      code: `${businessId}-${index}`,
      name: `Benchmark warehouse ${index}`,
      city: 'Kochi',
      address: 'Synthetic benchmark site',
      lead: 'Benchmark operator',
      priority: index,
      businessId,
    })),
  })
  const balances = new Map<string, Prisma.InventoryBalanceCreateManyInput>()
  const movements: Prisma.InventoryMovementCreateManyInput[] = []
  for (let site = 0; site < 20; site++)
    for (let product = 0; product < 1000; product++) {
      const id = balanceId(sku(product), warehouse(site))
      balances.set(id, {
        id,
        sku: sku(product),
        warehouseId: warehouse(site),
        onHand: 100,
        reserved: 0,
        version: 1,
        threshold: 12,
      })
      movements.push({
        id: randomUUID(),
        balanceId: id,
        type: 'OPENING',
        deltaOnHand: 100,
        deltaReserved: 0,
        onHandAfter: 100,
        reservedAfter: 0,
        balanceVersion: 1,
        reason: 'Open isolated benchmark snapshot',
        actorId: adminId,
        createdAt: new Date(now - 31 * 86_400_000),
      })
    }
  const orders: Prisma.OrderCreateManyInput[] = [],
    items: Prisma.OrderItemCreateManyInput[] = [],
    reservations: Prisma.StockReservationCreateManyInput[] = [],
    payments: Prisma.PaymentCreateManyInput[] = [],
    shipments: Prisma.ShipmentCreateManyInput[] = [],
    audits: Prisma.AuditEventCreateManyInput[] = []
  for (let index = 0; index < 5000; index++) {
    const id = randomUUID(),
      state = index % 5,
      createdAt = new Date(now - (5000 - index) * 500_000),
      expiresAt = new Date(now + 3_600_000)
    orders.push({
      id,
      number: `${businessId}-DL-${10000 + index}`,
      businessId,
      customerId: customers[index % 100],
      customerName: `Benchmark customer ${index % 100}`,
      warehouseId: warehouse(index % 20),
      orderStatus: (
        ['AWAITING_PAYMENT', 'CONFIRMED', 'CONFIRMED', 'COMPLETED', 'EXPIRED'] as const
      )[state],
      paymentStatus: state >= 1 && state <= 3 ? 'CAPTURED' : 'PENDING',
      fulfillmentStatus: state === 3 ? 'SHIPPED' : state === 2 ? 'PACKED' : 'UNFULFILLED',
      subtotalPaise: 25000,
      totalPaise: 25000,
      deliveryAddress: {
        line: 'Synthetic benchmark address',
        city: 'Kochi',
        postalCode: '682001',
        country: 'IN',
      },
      expiresAt: state === 0 ? expiresAt : null,
      createdAt,
      ...(state >= 1 && state <= 3 ? { confirmedAt: new Date(createdAt.getTime() + 60_000) } : {}),
      ...(state === 2 || state === 3 ? { packedAt: new Date(createdAt.getTime() + 120_000) } : {}),
      ...(state === 4 ? { expiredAt: new Date(createdAt.getTime() + 1_800_000) } : {}),
    })
    for (const productIndex of [(index * 17) % 1000, (index * 17 + 113) % 1000]) {
      const product = sku(productIndex),
        stockId = balanceId(product, warehouse(index % 20)),
        balance = balances.get(stockId)!
      items.push({
        id: randomUUID(),
        orderId: id,
        sku: product,
        name: `Benchmark product ${String(productIndex).padStart(4, '0')}`,
        image: '/product-placeholder.svg',
        quantity: 1,
        unitPricePaise: 12500,
        totalPaise: 12500,
      })
      reservations.push({
        id: randomUUID(),
        orderId: id,
        balanceId: stockId,
        quantity: 1,
        status:
          state === 0 ? 'HELD' : state === 3 ? 'CONSUMED' : state === 4 ? 'RELEASED' : 'ALLOCATED',
        expiresAt,
        createdAt,
      })
      balance.reserved = Number(balance.reserved) + 1
      balance.version = Number(balance.version) + 1
      movements.push({
        id: randomUUID(),
        balanceId: stockId,
        type: 'RESERVE',
        deltaOnHand: 0,
        deltaReserved: 1,
        onHandAfter: Number(balance.onHand),
        reservedAfter: balance.reserved,
        balanceVersion: balance.version,
        orderId: id,
        actorId: adminId,
        reason: 'Reserve benchmark snapshot',
        createdAt,
      })
      if (state === 3 || state === 4) {
        balance.reserved--
        if (state === 3) balance.onHand = Number(balance.onHand) - 1
        balance.version++
        movements.push({
          id: randomUUID(),
          balanceId: stockId,
          type: state === 3 ? 'SHIP' : 'RELEASE',
          deltaOnHand: state === 3 ? -1 : 0,
          deltaReserved: -1,
          onHandAfter: Number(balance.onHand),
          reservedAfter: balance.reserved,
          balanceVersion: balance.version,
          orderId: id,
          actorId: adminId,
          reason: 'Complete benchmark snapshot movement',
          createdAt: new Date(createdAt.getTime() + 180_000),
        })
      }
    }
    if (state >= 1 && state <= 3)
      payments.push({
        id: randomUUID(),
        orderId: id,
        provider: 'benchmark',
        providerIdempotencyKey: `benchmark:${id}`,
        amountPaise: 25000,
        status: 'CAPTURED',
      })
    if (state === 3)
      shipments.push({
        id: randomUUID(),
        orderId: id,
        trackingReference: `BENCH-${index}`,
        carrier: 'Synthetic carrier',
        shippedBy: adminId,
        shippedAt: new Date(createdAt.getTime() + 180_000),
      })
    audits.push({
      id: randomUUID(),
      businessId,
      actorId: adminId,
      action: 'ORDER_CREATED',
      entityType: 'Order',
      entityId: id,
      metadata: { syntheticBenchmark: true },
      createdAt,
    })
  }
  await batches([...balances.values()], (data) => db.inventoryBalance.createMany({ data }))
  await batches(orders, (data) => db.order.createMany({ data }))
  await batches(items, (data) => db.orderItem.createMany({ data }))
  await batches(reservations, (data) => db.stockReservation.createMany({ data }))
  await batches(movements, (data) => db.inventoryMovement.createMany({ data }))
  await batches(payments, (data) => db.payment.createMany({ data }))
  await batches(shipments, (data) => db.shipment.createMany({ data }))
  await batches(audits, (data) => db.auditEvent.createMany({ data }))
}
const quantile = (values: number[], fraction: number) =>
  Number([...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1].toFixed(2))
try {
  if (!reused) await db.$transaction(loadFixture, { timeout: 120_000 })
  const profile = await db.userProfile.findUniqueOrThrow({
    where: { authSubject: `${businessId}:admin` },
  })
  const customer = await db.userProfile.findFirstOrThrow({
    where: { businessId, role: 'CUSTOMER' },
  })
  const mismatches = await db.$queryRaw<
    { id: string }[]
  >`SELECT b.id FROM inventory_balances b JOIN products p ON p.sku=b.sku LEFT JOIN inventory_movements m ON m."balanceId"=b.id WHERE p."businessId"=${businessId} GROUP BY b.id HAVING b."onHand" <> COALESCE(SUM(m."deltaOnHand"),0) OR b.reserved <> COALESCE(SUM(m."deltaReserved"),0)`
  if (mismatches.length) throw new Error('Benchmark fixture has inconsistent ledger balances.')
  // Refresh estimates after bulk loading; this operates only on the guarded local test database.
  for (const table of [
    'products',
    'warehouses',
    'inventory_balances',
    'orders',
    'order_items',
    'stock_reservations',
    'inventory_movements',
    'payments',
    'shipments',
    'audit_events',
  ])
    await db.$executeRaw(Prisma.sql`ANALYZE ${Prisma.raw(table)}`)
  const api = createApp({
    db,
    businessId,
    origins: [],
    logLevel: 'silent',
    verifyIdentity: async (subject) => {
      if (subject !== `${businessId}:admin`)
        throw new DomainError('UNAUTHORIZED', 'Invalid synthetic identity.', 401)
      return { subject, name: profile.name, email: profile.email }
    },
  })
  const server = api.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Benchmark API did not open a loopback port.')
  const origin = `http://127.0.0.1:${address.port}`
  const measurements: {
    route: string
    coldMs: number
    p50Ms: number
    p95Ms: number
    maxMs: number
    responseBytes: number
    rows: number | null
  }[] = []
  try {
    const routes = [
      '/inventory?pageSize=20',
      `/inventory?warehouse=${warehouse(0)}&category=Category%200&pageSize=20`,
      '/orders?pageSize=20',
      '/search?q=product%200123',
      '/workspace',
      '/catalog?pageSize=20',
      '/catalog/categories',
    ]
    for (const route of routes) {
      const times: number[] = []
      let bytes = 0,
        rows: number | null = null
      for (let sample = 0; sample < 21; sample++) {
        const started = performance.now()
        const response = await fetch(`${origin}/api/v1${route}`, {
          headers: {
            Authorization: `Bearer ${businessId}:admin`,
            'X-Docklane-Session': 'synthetic-session',
          },
        })
        const body = await response.text()
        if (response.status !== 200)
          throw new Error(
            `Benchmark route failed with status ${response.status}; response values are not logged.`,
          )
        times.push(performance.now() - started)
        bytes = Buffer.byteLength(body)
        const data = JSON.parse(body).data
        rows = Array.isArray(data) ? data.length : null
      }
      measurements.push({
        route: route.replaceAll(businessId, 'fixture'),
        coldMs: Number(times[0].toFixed(2)),
        p50Ms: quantile(times.slice(1), 0.5),
        p95Ms: quantile(times.slice(1), 0.95),
        maxMs: Math.max(...times.slice(1).map((value) => Number(value.toFixed(2)))),
        responseBytes: bytes,
        rows,
      })
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
  const planQueries = {
    inventoryPage: Prisma.sql`SELECT b.id,b.sku,b."onHand",b.reserved,p.name,w.name FROM inventory_balances b JOIN products p ON p.sku=b.sku JOIN warehouses w ON w.id=b."warehouseId" WHERE p."businessId"=${businessId} AND w."businessId"=${businessId} AND NOT p.archived AND NOT w.archived ORDER BY p.name ASC,b.id ASC LIMIT 20`,
    catalogBalances: Prisma.sql`SELECT b.sku,SUM(b."onHand"-b.reserved) FROM inventory_balances b JOIN warehouses w ON w.id=b."warehouseId" WHERE b.sku=ANY(${Array.from({ length: 20 }, (_, i) => sku(i))}) AND w."businessId"=${businessId} AND NOT w.archived GROUP BY b.sku`,
    orderPage: Prisma.sql`SELECT id,number,"createdAt" FROM orders WHERE "businessId"=${businessId} ORDER BY "createdAt" DESC,id ASC LIMIT 20`,
    customerHistory: Prisma.sql`SELECT id,number,"createdAt" FROM orders WHERE "businessId"=${businessId} AND "customerId"=${customer.id}::uuid ORDER BY "createdAt" DESC,id ASC LIMIT 20`,
  }
  const plans: Record<string, unknown> = {}
  for (const [name, query] of Object.entries(planQueries))
    plans[name] = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`)
  const version = await db.$queryRaw<{ version: string }[]>`SELECT version()`
  const report = {
    measuredAt: new Date().toISOString(),
    fixture: businessId,
    dataset: {
      products: 1000,
      warehouses: 20,
      balances: 20000,
      orders: 5000,
      orderItems: 10000,
      reservations: 10000,
      movements: 34000,
      payments: 3000,
      shipments: 1000,
      audits: 5000,
    },
    environment: {
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryGiB: Number((totalmem() / 1024 ** 3).toFixed(1)),
      platform: platform(),
      node: process.version,
      postgres: version[0].version,
      transport: 'loopback HTTP; Docker PostgreSQL; synthetic identity; Prisma pool max 10',
    },
    samplesPerRoute: 20,
    ledgerMismatches: mismatches.length,
    measurements,
    plans,
  }
  await mkdir('.local', { recursive: true })
  await writeFile(`.local/phase8-operations-${label}.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify(
      {
        fixture: businessId,
        environment: report.environment,
        dataset: report.dataset,
        ledgerMismatches: mismatches.length,
        measurements,
      },
      null,
      2,
    ),
  )
  console.log(
    `Report: .local/phase8-operations-${label}.json. Synthetic fixture is retained in docklane_test for repeat measurements; integration tests reset that isolated database.`,
  )
} finally {
  await db.$disconnect()
}
