import { Router } from 'express'
import { Prisma, type PrismaClient } from '@docklane/database'
import { adjustStock, createStockLevel, changeThreshold } from '@docklane/domain'
import {
  inventoryQuerySchema,
  paginationSchema,
  resourceIdSchema,
  stockAdjustmentSchema,
  thresholdSchema,
  balanceCreateSchema,
  type InventoryRecord,
  type InventorySummary,
} from '@docklane/contracts'
import { requirePermission, signedIn } from './authorization.js'

type Row = {
  id: string
  sku: string
  warehouseId: string
  onHand: number
  reserved: number
  available: number
  threshold: number
  version: number
  updatedAt: Date
  name: string
  category: string
  pricePaise: number
  image: string
  color: string
  productArchived: boolean
  productVersion: number
  warehouseName: string
  city: string
  code: string
  warehouseArchived: boolean
}
const columns = Prisma.sql`b.id, b.sku, b."warehouseId", b."onHand", b.reserved, b."onHand" - b.reserved AS available, b.threshold, b.version, b."updatedAt", p.name, p.category, p."pricePaise", p.image, p.color, p.archived AS "productArchived", p.version AS "productVersion", w.name AS "warehouseName", w.city, w.code, w.archived AS "warehouseArchived"`
const tables = Prisma.sql`FROM inventory_balances b JOIN products p ON p.sku = b.sku JOIN warehouses w ON w.id = b."warehouseId"`
function record(row: Row): InventoryRecord {
  return {
    id: row.id,
    sku: row.sku,
    warehouseId: row.warehouseId,
    onHand: row.onHand,
    reserved: row.reserved,
    available: row.available,
    threshold: row.threshold,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    product: {
      sku: row.sku,
      name: row.name,
      category: row.category,
      pricePaise: row.pricePaise,
      image: row.image,
      color: row.color,
      archived: row.productArchived,
      version: row.productVersion,
    },
    warehouse: {
      id: row.warehouseId,
      name: row.warehouseName,
      city: row.city,
      code: row.code,
      archived: row.warehouseArchived,
    },
  }
}
function like(value: string) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}
export function createInventoryRouter(db: PrismaClient, businessId: string) {
  const router = Router()
  router.use('/inventory', requirePermission('viewWorkspace'))
  router.get('/inventory', async (request, response) => {
    const query = inventoryQuerySchema.parse(request.query)
    const terms = [
      Prisma.sql`p."businessId" = ${businessId}`,
      Prisma.sql`w."businessId" = ${businessId}`,
    ]
    if (query.warehouse) terms.push(Prisma.sql`w.id = ${query.warehouse}`)
    if (query.category) terms.push(Prisma.sql`p.category = ${query.category}`)
    if (query.archive === 'active') terms.push(Prisma.sql`NOT p.archived AND NOT w.archived`)
    if (query.archive === 'archived') terms.push(Prisma.sql`(p.archived OR w.archived)`)
    if (query.q)
      terms.push(
        Prisma.sql`(p.sku ILIKE ${like(query.q)} OR p.name ILIKE ${like(query.q)} OR p.category ILIKE ${like(query.q)} OR w.name ILIKE ${like(query.q)})`,
      )
    const base = Prisma.sql`WHERE ${Prisma.join(terms, ' AND ')}`
    const stock = {
      all: Prisma.empty,
      low: Prisma.sql`AND b."onHand" - b.reserved > 0 AND b."onHand" - b.reserved <= b.threshold`,
      reserved: Prisma.sql`AND b.reserved > 0`,
      out: Prisma.sql`AND b."onHand" = b.reserved`,
    }[query.stock]
    const order = {
      product: Prisma.sql`p.name`,
      warehouse: Prisma.sql`w.name`,
      onHand: Prisma.sql`b."onHand"`,
      reserved: Prisma.sql`b.reserved`,
      available: Prisma.sql`b."onHand" - b.reserved`,
      updated: Prisma.sql`b."updatedAt"`,
    }[query.sort]
    const [rows, totals, summaries] = await db.$transaction(
      [
        db.$queryRaw<
          Row[]
        >`SELECT ${columns} ${tables} ${base} ${stock} ORDER BY ${order} ${Prisma.raw(query.direction.toUpperCase())}, b.id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        db.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${tables} ${base} ${stock}`,
        db.$queryRaw<
          InventorySummary[]
        >`SELECT COUNT(*)::int AS levels, COALESCE(SUM(b."onHand" - b.reserved), 0)::float8 AS available, COALESCE(SUM(b.reserved), 0)::float8 AS reserved, COUNT(*) FILTER (WHERE b."onHand" - b.reserved > 0 AND b."onHand" - b.reserved <= b.threshold)::int AS low, COUNT(*) FILTER (WHERE b."onHand" = b.reserved)::int AS out, COUNT(*) FILTER (WHERE b.reserved > 0)::int AS "withReservations" ${tables} ${base}`,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    response.json({
      data: rows.map(record),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: totals[0].total,
        pages: Math.ceil(totals[0].total / query.pageSize),
      },
      summary: summaries[0],
    })
  })
  router.get('/inventory/:id', async (request, response) => {
    const id = resourceIdSchema.parse(request.params.id)
    const rows = await db.$queryRaw<
      Row[]
    >`SELECT ${columns} ${tables} WHERE b.id = ${id} AND p."businessId" = ${businessId} AND w."businessId" = ${businessId}`
    if (!rows.length) {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'This stock level could not be found.',
          requestId: request.requestId,
        },
      })
      return
    }
    response.json({ data: record(rows[0]) })
  })
  router.get('/inventory/:id/movements', async (request, response) => {
    const id = resourceIdSchema.parse(request.params.id)
    const { page, pageSize } = paginationSchema.parse(request.query)
    const where = { balanceId: id, balance: { product: { businessId }, warehouse: { businessId } } }
    const [data, total] = await db.$transaction([
      db.inventoryMovement.findMany({
        where,
        select: {
          id: true,
          type: true,
          deltaOnHand: true,
          deltaReserved: true,
          onHandAfter: true,
          reservedAfter: true,
          balanceVersion: true,
          reason: true,
          createdAt: true,
          actor: { select: { name: true } },
          order: { select: { number: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.inventoryMovement.count({ where }),
    ])
    response.json({
      data: data.map(({ actor, order, createdAt, ...movement }) => ({
        ...movement,
        actor: actor?.name ?? 'System',
        orderNumber: order?.number ?? null,
        createdAt: createdAt.toISOString(),
      })),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    })
  })
  router.post('/inventory', requirePermission('adjustStock'), async (request, response) => {
    const result = await createStockLevel(
      db,
      businessId,
      signedIn(request).id,
      request.requestId,
      balanceCreateSchema.parse(request.body),
    )
    response.status(201).json({ data: { id: result.id } })
  })
  router.post(
    '/inventory/:id/adjustments',
    requirePermission('adjustStock'),
    async (request, response) => {
      const result = await adjustStock(
        db,
        businessId,
        signedIn(request).id,
        request.requestId,
        resourceIdSchema.parse(request.params.id),
        stockAdjustmentSchema.parse(request.body),
      )
      response.json({ data: result })
    },
  )
  router.patch(
    '/inventory/:id/threshold',
    requirePermission('adjustStock'),
    async (request, response) => {
      const result = await changeThreshold(
        db,
        businessId,
        signedIn(request).id,
        request.requestId,
        resourceIdSchema.parse(request.params.id),
        thresholdSchema.parse(request.body),
      )
      response.json({
        data: { id: result.id, threshold: result.threshold, version: result.version },
      })
    },
  )
  return router
}
