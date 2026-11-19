import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@docklane/database'
import {
  cartItemsSchema,
  checkoutSchema,
  cancellationSchema,
  type CartItem,
  type CheckoutInput,
  type CheckoutQuote,
  type CancellationInput,
} from '@docklane/contracts'
import { DomainError } from './index.js'
import { lockActor } from './stock.js'
import { reserveRefund, refundCapacity } from './refunds.js'

export const orderRecordInclude = {
  payment: {
    include: {
      refunds: {
        include: { requester: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
      },
    },
  },
  shipment: { include: { shipper: { select: { name: true } } } },
  returns: {
    include: {
      receiver: { select: { name: true } },
      items: { include: { orderItem: { select: { sku: true } } } },
    },
    orderBy: [{ receivedAt: 'desc' as const }, { id: 'asc' as const }],
  },
  warehouse: { select: { id: true, name: true, city: true } },
  items: { orderBy: { sku: 'asc' as const } },
  reservations: {
    include: { balance: { select: { sku: true } } },
    orderBy: { balanceId: 'asc' as const },
  },
} satisfies Prisma.OrderInclude
export type ReservedOrder = Prisma.OrderGetPayload<{ include: typeof orderRecordInclude }>
export const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function normalizeCart(input: CartItem[]) {
  const totals = new Map<string, number>()
  for (const line of cartItemsSchema.parse(input))
    totals.set(line.sku, (totals.get(line.sku) ?? 0) + line.quantity)
  return cartItemsSchema.parse(
    [...totals]
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([sku, quantity]) => ({ sku, quantity })),
  )
}
function pricing(
  products: { sku: string; name: string; image: string; pricePaise: number }[],
  items: CartItem[],
) {
  const lines = items.map((line) => {
    const product = products.find((product) => product.sku === line.sku)
    if (!product)
      throw new DomainError(
        'PRODUCT_UNAVAILABLE',
        'A product in your bag is no longer available. Remove it before continuing.',
      )
    return {
      sku: line.sku,
      name: product.name,
      image: product.image,
      quantity: line.quantity,
      unitPricePaise: product.pricePaise,
      totalPaise: product.pricePaise * line.quantity,
    }
  })
  const subtotalPaise = lines.reduce((sum, line) => sum + line.totalPaise, 0)
  if (!Number.isSafeInteger(subtotalPaise) || subtotalPaise > 2_000_000_000)
    throw new DomainError(
      'ORDER_TOO_LARGE',
      'This order total is too large. Reduce the quantities to continue.',
      400,
    )
  return {
    items: lines,
    subtotalPaise,
    shippingPaise: 0,
    totalPaise: subtotalPaise,
    currency: 'INR' as const,
    quoteFingerprint: hash({ lines, shippingPaise: 0, currency: 'INR' }),
  }
}
async function candidates(tx: Prisma.TransactionClient, businessId: string, items: CartItem[]) {
  const needed = Prisma.join(
    items.map((line) => Prisma.sql`(${line.sku}::text, ${line.quantity}::int)`),
  )
  return tx.$queryRaw<
    { id: string; name: string; city: string }[]
  >`SELECT w.id, w.name, w.city FROM warehouses w WHERE w."businessId" = ${businessId} AND w.archived = false AND NOT EXISTS (SELECT 1 FROM (VALUES ${needed}) AS needed(sku, quantity) LEFT JOIN inventory_balances b ON b.sku = needed.sku AND b."warehouseId" = w.id WHERE b.id IS NULL OR b."onHand" - b.reserved < needed.quantity) ORDER BY w.priority, w.id LIMIT 16`
}
export async function quoteCheckout(
  db: PrismaClient,
  businessId: string,
  input: CartItem[],
): Promise<CheckoutQuote> {
  const items = normalizeCart(input)
  return db.$transaction(
    async (tx) => {
      const products = await tx.product.findMany({
        where: { businessId, archived: false, sku: { in: items.map((line) => line.sku) } },
        select: { sku: true, name: true, image: true, pricePaise: true },
      })
      const prices = pricing(products, items)
      const sites = await candidates(tx, businessId, items)
      const stock = await tx.$queryRaw<
        { sku: string; available: string }[]
      >`SELECT b.sku, SUM(b."onHand" - b.reserved)::bigint::text AS available FROM inventory_balances b JOIN warehouses w ON w.id = b."warehouseId" WHERE b.sku IN (${Prisma.join(items.map((line) => line.sku))}) AND w."businessId" = ${businessId} AND w.archived = false GROUP BY b.sku`
      return {
        ...prices,
        items: prices.items.map((line) => ({
          ...line,
          available: Number(stock.find((balance) => balance.sku === line.sku)?.available ?? 0),
        })),
        warehouse: sites[0] ?? null,
        canOrder: sites.length > 0,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}
export async function commandLock(
  tx: Prisma.TransactionClient,
  actorId: string,
  operation: string,
  key: string,
  fingerprint: string,
) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${actorId}:${operation}:${key}`}, 0))`
  const saved = await tx.idempotencyRecord.findUnique({
    where: { userId_operation_key: { userId: actorId, operation, key } },
  })
  if (saved && saved.fingerprint !== fingerprint)
    throw new DomainError(
      'IDEMPOTENCY_CONFLICT',
      'This retry key was already used for a different request.',
    )
  if (saved && (!saved.outcome || saved.status !== 'COMPLETED'))
    throw new DomainError(
      'REQUEST_IN_PROGRESS',
      'This request is still being processed. Retry the same request shortly.',
    )
  return saved ? (saved.outcome as { orderId: string }).orderId : null
}
export async function remember(
  tx: Prisma.TransactionClient,
  actorId: string,
  operation: string,
  key: string,
  fingerprint: string,
  orderId: string,
) {
  await tx.$executeRaw`INSERT INTO idempotency_records (id, "userId", operation, key, fingerprint, status, outcome, "expiresAt") VALUES (${randomUUID()}::uuid, ${actorId}::uuid, ${operation}, ${key}, ${fingerprint}, 'COMPLETED', ${JSON.stringify({ orderId })}::jsonb, clock_timestamp() + interval '24 hours')`
}
function retryable(error: unknown) {
  if (error instanceof DomainError) return error.code === 'CHECKOUT_CONTENTION'
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return error.code === 'P2034' || ['40P01', '40001'].includes(String(error.meta?.code))
  return false
}
export async function transact<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work)
    } catch (error) {
      if (!retryable(error)) throw error
      if (attempt === 2)
        throw new DomainError(
          'CHECKOUT_BUSY',
          'Stock is changing quickly. Retry this request in a moment.',
          503,
        )
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)))
    }
  }
}
export async function createReservedOrder(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  raw: CheckoutInput,
): Promise<ReservedOrder> {
  const parsed = checkoutSchema.parse(raw)
  const input = { ...parsed, items: normalizeCart(parsed.items) }
  const fingerprint = hash({
    items: input.items,
    deliveryAddress: input.deliveryAddress,
    quoteFingerprint: input.quoteFingerprint,
  })
  return transact(db, async (tx) => {
    const actor = await lockActor(tx, businessId, actorId, 'placeOrders')
    const saved = await commandLock(tx, actorId, 'create-order', input.idempotencyKey, fingerprint)
    if (saved)
      return tx.order.findUniqueOrThrow({ where: { id: saved }, include: orderRecordInclude })
    // Catalog edits and archives share these locks. Lock every product before
    // the site and then balance rows, matching stock corrections' lock order.
    await tx.$queryRaw`SELECT sku FROM products WHERE sku IN (${Prisma.join(input.items.map((line) => line.sku))}) ORDER BY sku FOR SHARE`
    const products = await tx.product.findMany({
      where: { businessId, archived: false, sku: { in: input.items.map((line) => line.sku) } },
    })
    const prices = pricing(products, input.items)
    if (prices.quoteFingerprint !== input.quoteFingerprint)
      throw new DomainError(
        'PRICE_CHANGED',
        'The collection changed since your review. Refresh the order review before reserving stock.',
      )
    const sites = await candidates(tx, businessId, input.items)
    if (!sites.length)
      throw new DomainError(
        'INSUFFICIENT_STOCK',
        'No single warehouse can fill this bag right now. Reduce quantities or remove an item and try again.',
      )
    for (const site of sites) {
      await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${site.id} FOR SHARE`
      const currentSite = await tx.warehouse.findUniqueOrThrow({ where: { id: site.id } })
      if (currentSite.archived || currentSite.businessId !== businessId) continue
      const balances = await tx.$queryRaw<
        { id: string; sku: string; onHand: number; reserved: number; version: number }[]
      >`SELECT id, sku, "onHand", reserved, version FROM inventory_balances WHERE "warehouseId" = ${site.id} AND sku IN (${Prisma.join(input.items.map((line) => line.sku))}) ORDER BY sku FOR UPDATE`
      if (
        balances.length !== input.items.length ||
        input.items.some((line) => {
          const balance = balances.find((balance) => balance.sku === line.sku)
          return !balance || balance.onHand - balance.reserved < line.quantity
        })
      )
        continue
      // Use database wall time after waiting for stock locks, not transaction
      // start time, so contention cannot shorten the promised 30-minute hold.
      const [time] = await tx.$queryRaw<
        { now: Date; deadline: Date }[]
      >`SELECT clock_timestamp() AS now, clock_timestamp() + interval '30 minutes' AS deadline`
      const id = randomUUID()
      const [sequence] = await tx.$queryRaw<
        { number: string }[]
      >`SELECT nextval('docklane_order_number_seq')::text AS number`
      const order = await tx.order.create({
        data: {
          id,
          number: `DL-${sequence.number}`,
          businessId,
          customerId: actorId,
          customerName: actor.name,
          warehouseId: site.id,
          subtotalPaise: prices.subtotalPaise,
          shippingPaise: prices.shippingPaise,
          totalPaise: prices.totalPaise,
          deliveryAddress: input.deliveryAddress,
          expiresAt: time.deadline,
          createdAt: time.now,
          items: { create: prices.items },
        },
      })
      for (const line of input.items) {
        const balance = balances.find((balance) => balance.sku === line.sku)!
        const reserved = balance.reserved + line.quantity,
          version = balance.version + 1
        await tx.inventoryBalance.update({ where: { id: balance.id }, data: { reserved, version } })
        await tx.stockReservation.create({
          data: {
            orderId: id,
            balanceId: balance.id,
            quantity: line.quantity,
            expiresAt: time.deadline,
          },
        })
        await tx.inventoryMovement.create({
          data: {
            balanceId: balance.id,
            type: 'RESERVE',
            deltaOnHand: 0,
            deltaReserved: line.quantity,
            onHandAfter: balance.onHand,
            reservedAfter: reserved,
            balanceVersion: version,
            reason: `Stock held for ${order.number}`,
            actorId,
            orderId: id,
          },
        })
      }
      await tx.outboxEvent.create({
        data: {
          type: 'ORDER_RESERVATION_EXPIRY',
          businessId,
          payload: { orderId: id, businessId },
          availableAt: time.deadline,
        },
      })
      await tx.auditEvent.create({
        data: {
          businessId,
          actorId,
          requestId,
          action: 'ORDER_RESERVED',
          entityType: 'Order',
          entityId: id,
          metadata: {
            warehouseId: site.id,
            totalPaise: prices.totalPaise,
            items: input.items,
            expiresAt: time.deadline.toISOString(),
          },
        },
      })
      await remember(tx, actorId, 'create-order', input.idempotencyKey, fingerprint, id)
      return tx.order.findUniqueOrThrow({ where: { id }, include: orderRecordInclude })
    }
    throw new DomainError('CHECKOUT_CONTENTION', 'Available stock changed during checkout.', 503)
  })
}
export async function cancelUnpaidOrder(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  identifier: string,
  raw: CancellationInput,
): Promise<ReservedOrder> {
  const input = cancellationSchema.parse(raw)
  return transact(db, async (tx) => {
    const actor = await lockActor(tx, businessId, actorId, 'cancelOrders')
    const found = await tx.order.findFirst({
      where: {
        businessId,
        OR: [
          { number: identifier },
          ...(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identifier)
            ? [{ id: identifier }]
            : []),
        ],
        ...(actor.role === 'CUSTOMER' ? { customerId: actorId } : {}),
      },
      select: { id: true },
    })
    if (!found) throw new DomainError('NOT_FOUND', 'This order could not be found.', 404)
    const fingerprint = hash({ orderId: found.id, reason: input.reason })
    const saved = await commandLock(tx, actorId, 'cancel-order', input.idempotencyKey, fingerprint)
    if (saved)
      return tx.order.findUniqueOrThrow({ where: { id: saved }, include: orderRecordInclude })
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${found.id}::uuid FOR UPDATE`
    const order = await tx.order.findUniqueOrThrow({
      where: { id: found.id },
      include: orderRecordInclude,
    })
    if (order.orderStatus !== 'CANCELLED') {
      if (
        !['AWAITING_PAYMENT', 'CONFIRMED'].includes(order.orderStatus) ||
        order.fulfillmentStatus === 'SHIPPED' ||
        !order.reservations.length ||
        order.reservations.some(
          (reservation) => !['HELD', 'ALLOCATED'].includes(reservation.status),
        )
      )
        throw new DomainError(
          'CANCELLATION_UNAVAILABLE',
          'Only unshipped orders with held or allocated stock can be cancelled.',
        )
      await releaseHeldStock(tx, order, input.reason, actorId)
      if (order.payment?.providerReference) {
        const remaining = refundCapacity(order.payment).availablePaise
        if (remaining > 0)
          await reserveRefund(
            tx,
            order,
            actorId,
            requestId,
            remaining,
            input.reason,
            'CANCELLATION',
          )
      }
      const [time] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      await tx.order.update({
        where: { id: order.id },
        data: {
          orderStatus: 'CANCELLED',
          fulfillmentStatus: 'UNFULFILLED',
          cancelledAt: time.now,
          cancelReason: input.reason,
        },
      })
      await tx.outboxEvent.create({
        data: { type: 'STRIPE_SESSION_CLOSE', businessId, payload: { orderId: order.id } },
      })
      await tx.auditEvent.create({
        data: {
          businessId,
          actorId,
          requestId,
          action: 'ORDER_CANCELLED',
          entityType: 'Order',
          entityId: order.id,
          metadata: { reason: input.reason },
        },
      })
    }
    await remember(tx, actorId, 'cancel-order', input.idempotencyKey, fingerprint, order.id)
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderRecordInclude })
  })
}

export async function releaseHeldStock(
  tx: Prisma.TransactionClient,
  order: ReservedOrder,
  reason: string,
  actorId: string | null = null,
) {
  await tx.$queryRaw`SELECT sku FROM products WHERE sku IN (${Prisma.join(order.items.map((line) => line.sku))}) ORDER BY sku FOR SHARE`
  await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${order.warehouseId} FOR SHARE`
  const balances = await tx.$queryRaw<
    { id: string; onHand: number; reserved: number; version: number }[]
  >`SELECT id, "onHand", reserved, version FROM inventory_balances WHERE id IN (${Prisma.join(order.reservations.map((reservation) => reservation.balanceId))}) ORDER BY sku FOR UPDATE`
  for (const reservation of order.reservations.filter((reservation) =>
    ['HELD', 'ALLOCATED'].includes(reservation.status),
  )) {
    const balance = balances.find((balance) => balance.id === reservation.balanceId)!
    if (!balance || balance.reserved < reservation.quantity)
      throw new DomainError(
        'INVENTORY_CONFLICT',
        'The saved reservation needs review. Contact the workspace admin.',
      )
    const reserved = balance.reserved - reservation.quantity,
      version = balance.version + 1
    await tx.inventoryBalance.update({ where: { id: balance.id }, data: { reserved, version } })
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: 'RELEASED' },
    })
    await tx.inventoryMovement.create({
      data: {
        balanceId: balance.id,
        type: 'RELEASE',
        deltaOnHand: 0,
        deltaReserved: -reservation.quantity,
        onHandAfter: balance.onHand,
        reservedAfter: reserved,
        balanceVersion: version,
        reason: reason,
        actorId,
        orderId: order.id,
      },
    })
  }
}
