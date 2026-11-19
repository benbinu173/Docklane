import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { type PrismaClient, Prisma } from '@docklane/database'
import { DomainError, lockActor, assertVersion } from '@docklane/domain'
import {
  productCreateSchema,
  productUpdateSchema,
  warehouseCreateSchema,
  warehouseUpdateSchema,
  resourceQuerySchema,
  resourceIdSchema,
  skuSchema,
  type CatalogProduct,
  type WarehouseRecord,
} from '@docklane/contracts'
import { requirePermission, signedIn } from './authorization.js'

const productSelect = {
  sku: true,
  name: true,
  category: true,
  pricePaise: true,
  image: true,
  color: true,
  archived: true,
  version: true,
} as const
const warehouseSelect = {
  id: true,
  name: true,
  code: true,
  city: true,
  address: true,
  lead: true,
  priority: true,
  archived: true,
  version: true,
} as const
const archiveWhere = (archive: string) =>
  archive === 'all' ? {} : { archived: archive === 'archived' }
const readSnapshot = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
export function createResourcesRouter(db: PrismaClient, businessId: string) {
  const router = Router()
  router.use('/products', requirePermission('viewWorkspace'))
  router.get(['/products/categories', '/catalog/categories'], async (request, response) => {
    // Prisma's ordinary distinct reads every product and deduplicates in the
    // application. Return only the distinct labels from PostgreSQL instead.
    const data = await db.$queryRaw<
      { category: string }[]
    >`SELECT DISTINCT category FROM products WHERE "businessId" = ${businessId} ${request.path.startsWith('/catalog') ? Prisma.sql`AND NOT archived` : Prisma.empty} ORDER BY category ASC`
    response.json({ data: data.map(({ category }) => category) })
  })
  router.get('/products', requirePermission('viewWorkspace'), async (request, response) => {
    const query = resourceQuerySchema.parse(request.query)
    const where: Prisma.ProductWhereInput = {
      businessId,
      ...archiveWhere(query.archive),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { sku: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const [data, total] = await db.$transaction(
      [
        db.product.findMany({
          where,
          select: productSelect,
          orderBy: [{ name: 'asc' }, { sku: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.product.count({ where }),
      ],
      readSnapshot,
    )
    response.json({
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pages: Math.ceil(total / query.pageSize),
      },
    })
  })
  router.get('/catalog', async (request, response) => {
    const query = resourceQuerySchema.parse(request.query)
    const where: Prisma.ProductWhereInput = {
      businessId,
      archived: false,
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { sku: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const result = await db.$transaction(async (tx) => {
      const [products, total] = await Promise.all([
        tx.product.findMany({
          where,
          select: productSelect,
          orderBy: [{ name: 'asc' }, { sku: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.product.count({ where }),
      ])
      const balances = await tx.inventoryBalance.groupBy({
        by: ['sku'],
        where: {
          sku: { in: products.map((product) => product.sku) },
          warehouse: { businessId, archived: false },
        },
        _sum: { onHand: true, reserved: true },
      })
      const availability = new Map(
        balances.map((balance) => [
          balance.sku,
          (balance._sum.onHand ?? 0) - (balance._sum.reserved ?? 0),
        ]),
      )
      return {
        data: products.map((product): CatalogProduct => ({
          ...product,
          available: availability.get(product.sku) ?? 0,
        })),
        total,
      }
    }, readSnapshot)
    response.json({
      data: result.data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        pages: Math.ceil(result.total / query.pageSize),
      },
    })
  })
  router.get('/catalog/:sku', async (request, response) => {
    const sku = skuSchema.parse(request.params.sku)
    const data = await db.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { sku, businessId, archived: false },
        select: productSelect,
      })
      if (!product) throw new DomainError('NOT_FOUND', 'This product could not be found.', 404)
      const balance = await tx.inventoryBalance.aggregate({
        where: { sku, warehouse: { businessId, archived: false } },
        _sum: { onHand: true, reserved: true },
      })
      return { ...product, available: (balance._sum.onHand ?? 0) - (balance._sum.reserved ?? 0) }
    }, readSnapshot)
    response.json({ data })
  })
  router.post('/products', requirePermission('manageCatalog'), async (request, response) => {
    const input = productCreateSchema.parse(request.body)
    const data = await db.$transaction(async (tx) => {
      await lockActor(tx, businessId, signedIn(request).id, 'manageCatalog')
      const product = await tx.product.create({
        data: { ...input, businessId },
        select: productSelect,
      })
      await tx.auditEvent.create({
        data: {
          businessId,
          actorId: signedIn(request).id,
          requestId: request.requestId,
          action: 'PRODUCT_CREATED',
          entityType: 'Product',
          entityId: product.sku,
          metadata: { ...product },
        },
      })
      return product
    })
    response.status(201).json({ data })
  })
  router.patch('/products/:sku', requirePermission('manageCatalog'), async (request, response) => {
    const sku = skuSchema.parse(request.params.sku)
    const { expectedVersion, ...input } = productUpdateSchema.parse(request.body)
    const data = await db.$transaction(async (tx) => {
      await lockActor(tx, businessId, signedIn(request).id, 'manageCatalog')
      await tx.$queryRaw`SELECT sku FROM products WHERE sku = ${sku} AND "businessId" = ${businessId} FOR UPDATE`
      const before = await tx.product.findFirst({
        where: { sku, businessId },
        select: productSelect,
      })
      if (!before) throw new DomainError('NOT_FOUND', 'This product could not be found.', 404)
      assertVersion(before.version, expectedVersion)
      if (
        input.archived &&
        (await tx.inventoryBalance.count({ where: { sku, reserved: { gt: 0 } } }))
      )
        throw new DomainError(
          'RESERVED_STOCK',
          'This product has reserved stock. Complete or cancel those orders before archiving it.',
        )
      const product = await tx.product.update({
        where: { sku },
        data: { ...input, version: { increment: 1 } },
        select: productSelect,
      })
      await tx.auditEvent.create({
        data: {
          businessId,
          actorId: signedIn(request).id,
          requestId: request.requestId,
          action:
            input.archived === undefined
              ? 'PRODUCT_UPDATED'
              : input.archived
                ? 'PRODUCT_ARCHIVED'
                : 'PRODUCT_RESTORED',
          entityType: 'Product',
          entityId: sku,
          metadata: { before: { ...before }, after: { ...product } },
        },
      })
      return product
    })
    response.json({ data })
  })
  async function warehouses(where: Prisma.WarehouseWhereInput, page: number, pageSize: number) {
    return db.$transaction(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.warehouse.findMany({
          where,
          select: warehouseSelect,
          orderBy: [{ priority: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.warehouse.count({ where }),
      ])
      const balances = await tx.inventoryBalance.groupBy({
        by: ['warehouseId'],
        where: { warehouseId: { in: rows.map((row) => row.id) } },
        _sum: { onHand: true, reserved: true },
        _count: { id: true },
      })
      const byId = new Map(balances.map((balance) => [balance.warehouseId, balance]))
      return {
        data: rows.map((row): WarehouseRecord => {
          const balance = byId.get(row.id)
          const onHand = balance?._sum.onHand ?? 0
          const reserved = balance?._sum.reserved ?? 0
          return {
            ...row,
            onHand,
            reserved,
            available: onHand - reserved,
            levels: balance?._count.id ?? 0,
          }
        }),
        total,
      }
    }, readSnapshot)
  }
  router.get('/warehouses', requirePermission('viewWorkspace'), async (request, response) => {
    const query = resourceQuerySchema.parse(request.query)
    const result = await warehouses(
      {
        businessId,
        ...archiveWhere(query.archive),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { city: { contains: query.q, mode: 'insensitive' } },
                { code: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      query.page,
      query.pageSize,
    )
    response.json({
      data: result.data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        pages: Math.ceil(result.total / query.pageSize),
      },
    })
  })
  router.get('/warehouses/:id', requirePermission('viewWorkspace'), async (request, response) => {
    const result = await warehouses(
      { businessId, id: resourceIdSchema.parse(request.params.id) },
      1,
      1,
    )
    if (!result.data.length)
      throw new DomainError('NOT_FOUND', 'This warehouse could not be found.', 404)
    response.json({ data: result.data[0] })
  })
  router.post('/warehouses', requirePermission('manageWarehouses'), async (request, response) => {
    const input = warehouseCreateSchema.parse(request.body)
    const data = await db.$transaction(async (tx) => {
      await lockActor(tx, businessId, signedIn(request).id, 'manageWarehouses')
      const warehouse = await tx.warehouse.create({
        data: { id: randomUUID(), businessId, ...input },
        select: warehouseSelect,
      })
      await tx.auditEvent.create({
        data: {
          businessId,
          actorId: signedIn(request).id,
          requestId: request.requestId,
          action: 'WAREHOUSE_CREATED',
          entityType: 'Warehouse',
          entityId: warehouse.id,
          metadata: { ...warehouse },
        },
      })
      return warehouse
    })
    response.status(201).json({ data })
  })
  router.patch(
    '/warehouses/:id',
    requirePermission('manageWarehouses'),
    async (request, response) => {
      const id = resourceIdSchema.parse(request.params.id)
      const { expectedVersion, ...input } = warehouseUpdateSchema.parse(request.body)
      const data = await db.$transaction(async (tx) => {
        await lockActor(tx, businessId, signedIn(request).id, 'manageWarehouses')
        await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`
        const before = await tx.warehouse.findFirst({
          where: { id, businessId },
          select: warehouseSelect,
        })
        if (!before) throw new DomainError('NOT_FOUND', 'This warehouse could not be found.', 404)
        assertVersion(before.version, expectedVersion)
        if (input.archived) {
          const occupied = await tx.inventoryBalance.count({
            where: { warehouseId: id, OR: [{ onHand: { gt: 0 } }, { reserved: { gt: 0 } }] },
          })
          const openOrders = await tx.order.count({
            where: { warehouseId: id, orderStatus: { in: ['AWAITING_PAYMENT', 'CONFIRMED'] } },
          })
          if (occupied || openOrders)
            throw new DomainError(
              'WAREHOUSE_IN_USE',
              'Clear stock and complete open orders before archiving this warehouse.',
            )
        }
        const warehouse = await tx.warehouse.update({
          where: { id },
          data: { ...input, version: { increment: 1 } },
          select: warehouseSelect,
        })
        await tx.auditEvent.create({
          data: {
            businessId,
            actorId: signedIn(request).id,
            requestId: request.requestId,
            action:
              input.archived === undefined
                ? 'WAREHOUSE_UPDATED'
                : input.archived
                  ? 'WAREHOUSE_ARCHIVED'
                  : 'WAREHOUSE_RESTORED',
            entityType: 'Warehouse',
            entityId: id,
            metadata: { before: { ...before }, after: { ...warehouse } },
          },
        })
        return warehouse
      })
      response.json({ data })
    },
  )
  return router
}
