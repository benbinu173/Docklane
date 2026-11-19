import { Router } from 'express'
import { Prisma, type PrismaClient } from '@docklane/database'
import {
  workspaceQuerySchema,
  quickSearchSchema,
  type OperationsOverview,
  type SearchResult,
} from '@docklane/contracts'
import { requirePermission, signedIn } from './authorization.js'
import { orderInclude, orderSummary } from './orders.js'

// Version 1 uses Indian calendar days, with an inclusive end day.
export function createdDates(query: {
  from?: string
  to?: string
}): Prisma.DateTimeFilter | undefined {
  if (!query.from && !query.to) return undefined
  return {
    ...(query.from ? { gte: new Date(`${query.from}T00:00:00+05:30`) } : {}),
    ...(query.to
      ? { lt: new Date(new Date(`${query.to}T00:00:00+05:30`).getTime() + 86_400_000) }
      : {}),
  }
}
export function queueWhere(
  queue: string | undefined,
  db: PrismaClient | Prisma.TransactionClient,
): Prisma.OrderWhereInput {
  const paid = { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] as ('CAPTURED' | 'PARTIALLY_REFUNDED')[] }
  switch (queue) {
    case 'open':
      return { orderStatus: { in: ['AWAITING_PAYMENT', 'CONFIRMED'] } }
    case 'payment':
      return { orderStatus: 'AWAITING_PAYMENT' }
    case 'pack':
      return { orderStatus: 'CONFIRMED', paymentStatus: paid, fulfillmentStatus: 'UNFULFILLED' }
    case 'ship':
      return { orderStatus: 'CONFIRMED', paymentStatus: paid, fulfillmentStatus: 'PACKED' }
    case 'refund':
      return { paymentStatus: 'REFUND_PENDING' }
    case 'returns':
      return {
        returns: {
          some: { items: { some: { restockedQuantity: { lt: db.returnItem.fields.quantity } } } },
        },
      }
    default:
      return {}
  }
}
export function createOperationsRouter(db: PrismaClient, businessId: string) {
  const router = Router()
  router.get('/workspace', requirePermission('viewWorkspace'), async (request, response) => {
    const query = workspaceQuerySchema.parse(request.query)
    const data = await db.$transaction(
      async (tx) => {
        const scope: Prisma.OrderWhereInput = {
          businessId,
          ...(query.warehouse ? { warehouseId: query.warehouse } : {}),
          ...(createdDates(query) ? { createdAt: createdDates(query) } : {}),
        }
        const warehouseClause = query.warehouse
          ? Prisma.sql`AND w.id = ${query.warehouse}`
          : Prisma.empty
        const queues = Object.fromEntries(
          await Promise.all(
            ['open', 'payment', 'pack', 'ship', 'refund', 'returns'].map(async (key) => [
              key,
              await tx.order.count({ where: { AND: [scope, queueWhere(key, tx)] } }),
            ]),
          ),
        ) as OperationsOverview['queues']
        const [
          business,
          orders,
          openOrders,
          stock,
          warehouses,
          captured,
          refunded,
          recentOrders,
          events,
          now,
        ] = await Promise.all([
          tx.business.findUniqueOrThrow({
            where: { id: businessId },
            select: { id: true, name: true, currency: true, timezone: true },
          }),
          tx.order.count({ where: scope }),
          tx.order.count({
            where: { AND: [scope, { orderStatus: { in: ['AWAITING_PAYMENT', 'CONFIRMED'] } }] },
          }),
          tx.$queryRaw<
            Pick<
              OperationsOverview['metrics'],
              'availableUnits' | 'reservedUnits' | 'lowStockLevels' | 'outOfStockLevels'
            >[]
          >`SELECT COALESCE(SUM(b."onHand" - b.reserved),0)::float8 AS "availableUnits", COALESCE(SUM(b.reserved),0)::float8 AS "reservedUnits", COUNT(*) FILTER (WHERE b."onHand" - b.reserved > 0 AND b."onHand" - b.reserved <= b.threshold)::int AS "lowStockLevels", COUNT(*) FILTER (WHERE b."onHand" = b.reserved)::int AS "outOfStockLevels" FROM inventory_balances b JOIN products p ON p.sku = b.sku JOIN warehouses w ON w.id = b."warehouseId" WHERE p."businessId" = ${businessId} AND w."businessId" = ${businessId} AND NOT p.archived AND NOT w.archived ${warehouseClause}`,
          tx.$queryRaw<
            OperationsOverview['warehouses']
          >`SELECT w.id, w.name, w.city, w.code, COALESCE(SUM(b."onHand" - b.reserved) FILTER (WHERE NOT p.archived),0)::float8 AS "availableUnits", COALESCE(SUM(b.reserved) FILTER (WHERE NOT p.archived),0)::float8 AS "reservedUnits" FROM warehouses w LEFT JOIN inventory_balances b ON b."warehouseId" = w.id LEFT JOIN products p ON p.sku = b.sku AND p."businessId" = ${businessId} WHERE w."businessId" = ${businessId} AND NOT w.archived ${warehouseClause} GROUP BY w.id ORDER BY w.priority, w.name, w.id LIMIT 100`,
          tx.payment.aggregate({
            where: {
              order: scope,
              status: { in: ['CAPTURED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
            },
            _sum: { amountPaise: true },
          }),
          tx.refundAttempt.aggregate({
            where: { payment: { order: scope }, status: 'SUCCEEDED' },
            _sum: { amountPaise: true },
          }),
          tx.order.findMany({
            where: scope,
            include: orderInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            take: 5,
          }),
          tx.$queryRaw<
            {
              id: string
              action: string
              entityType: string
              entityId: string
              actor: string
              createdAt: Date
            }[]
          >`SELECT a.id::text, a.action, a."entityType", a."entityId", COALESCE(u.name,'System') AS actor, a."createdAt" FROM audit_events a LEFT JOIN user_profiles u ON u.id = a."actorId" WHERE a."businessId" = ${businessId} ${query.from ? Prisma.sql`AND a."createdAt" >= ${new Date(`${query.from}T00:00:00+05:30`)}` : Prisma.empty} ${query.to ? Prisma.sql`AND a."createdAt" < ${new Date(new Date(`${query.to}T00:00:00+05:30`).getTime() + 86_400_000)}` : Prisma.empty} ${query.warehouse ? Prisma.sql`AND ((a."entityType" = 'Warehouse' AND a."entityId" = ${query.warehouse}) OR (a."entityType" = 'Order' AND EXISTS (SELECT 1 FROM orders o WHERE o."businessId" = ${businessId} AND o."warehouseId" = ${query.warehouse} AND (o.id::text = a."entityId" OR o.number = a."entityId"))) OR (a."entityType" = 'InventoryBalance' AND EXISTS (SELECT 1 FROM inventory_balances b JOIN warehouses w ON w.id = b."warehouseId" WHERE b.id = a."entityId" AND w."businessId" = ${businessId} AND w.id = ${query.warehouse})))` : Prisma.empty} ORDER BY a."createdAt" DESC, a.id DESC LIMIT 8`,
          tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`,
        ])
        return {
          business,
          asOf: now[0].now.toISOString(),
          queues,
          metrics: {
            orders,
            openOrders,
            ...stock[0],
            capturedPaise: captured._sum.amountPaise ?? 0,
            refundedPaise: refunded._sum.amountPaise ?? 0,
          },
          warehouses,
          recentOrders: recentOrders.map(orderSummary),
          activity: events.map((event) => ({
            ...event,
            createdAt: event.createdAt.toISOString(),
            href:
              event.entityType === 'Order'
                ? `/workspace/orders/${encodeURIComponent(event.entityId)}`
                : event.entityType === 'InventoryBalance'
                  ? `/workspace/inventory?stockId=${encodeURIComponent(event.entityId)}`
                  : event.entityType === 'Warehouse'
                    ? `/workspace/warehouses/${encodeURIComponent(event.entityId)}`
                    : event.entityType === 'Product'
                      ? `/workspace/products?q=${encodeURIComponent(event.entityId)}`
                      : null,
          })),
        } satisfies OperationsOverview
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    response.json({ data })
  })
  router.get('/search', async (request, response) => {
    const { q } = quickSearchSchema.parse(request.query),
      profile = signedIn(request)
    const customer = profile.role === 'CUSTOMER'
    const [orders, products, warehouses] = await db.$transaction(
      [
        db.order.findMany({
          where: {
            businessId,
            ...(customer ? { customerId: profile.id } : {}),
            OR: [
              { number: { contains: q, mode: 'insensitive' } },
              ...(!customer
                ? [{ customerName: { contains: q, mode: 'insensitive' as const } }]
                : []),
            ],
          },
          select: { id: true, number: true, customerName: true, orderStatus: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 6,
        }),
        db.product.findMany({
          where: {
            businessId,
            archived: false,
            OR: [
              { sku: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { sku: true, name: true, category: true },
          orderBy: { sku: 'asc' },
          take: 6,
        }),
        db.warehouse.findMany({
          where: {
            businessId,
            archived: false,
            ...(customer ? { id: '__customer_has_no_warehouse_search__' } : {}),
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true, name: true, city: true },
          orderBy: { id: 'asc' },
          take: 6,
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    const data: SearchResult[] = [
      ...orders.map((o) => ({
        id: o.id,
        label: o.number,
        detail: customer ? 'Your order' : o.customerName,
        kind: 'Order' as const,
        href: `${customer ? '/account' : '/workspace'}/orders/${encodeURIComponent(o.number)}`,
      })),
      ...products.map((p) => ({
        id: p.sku,
        label: p.name,
        detail: `${p.sku} · ${p.category}`,
        kind: 'Product' as const,
        href: customer
          ? `/account/catalog/${encodeURIComponent(p.sku)}`
          : `/workspace/products?q=${encodeURIComponent(p.sku)}`,
      })),
      ...warehouses.map((w) => ({
        id: w.id,
        label: w.name,
        detail: w.city,
        kind: 'Warehouse' as const,
        href: `/workspace/warehouses/${encodeURIComponent(w.id)}`,
      })),
    ]
    response.json({ data })
  })
  return router
}
