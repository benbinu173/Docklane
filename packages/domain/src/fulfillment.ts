import { Prisma, type PrismaClient } from '@docklane/database'
import {
  operationSchema,
  shipmentSchema,
  returnReceiptSchema,
  restockSchema,
  type OperationInput,
  type ShipmentInput,
  type ReturnReceiptInput,
  type RestockInput,
} from '@docklane/contracts'
import { DomainError, assertInventory, type permissions } from './index.js'
import { lockActor } from './stock.js'
import {
  commandLock,
  remember,
  hash,
  transact,
  orderRecordInclude,
  type ReservedOrder,
} from './orders.js'

export async function orderCommand(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  identifier: string,
  operation: string,
  permission: keyof typeof permissions,
  input: OperationInput,
  payload: unknown,
  work: (tx: Prisma.TransactionClient, order: ReservedOrder) => Promise<void>,
): Promise<ReservedOrder> {
  return transact(db, async (tx) => {
    await lockActor(tx, businessId, actorId, permission)
    const found = await tx.order.findFirst({
      where: {
        businessId,
        OR: [
          { number: identifier },
          ...(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identifier)
            ? [{ id: identifier }]
            : []),
        ],
      },
      select: { id: true },
    })
    if (!found) throw new DomainError('NOT_FOUND', 'This order could not be found.', 404)
    const fingerprint = hash({ orderId: found.id, payload })
    const saved = await commandLock(tx, actorId, operation, input.idempotencyKey, fingerprint)
    if (saved)
      return tx.order.findUniqueOrThrow({ where: { id: saved }, include: orderRecordInclude })
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${found.id}::uuid FOR UPDATE`
    const order = await tx.order.findUniqueOrThrow({
      where: { id: found.id },
      include: orderRecordInclude,
    })
    await work(tx, order)
    await remember(tx, actorId, operation, input.idempotencyKey, fingerprint, order.id)
    void requestId
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderRecordInclude })
  })
}
export async function operationalAudit(
  tx: Prisma.TransactionClient,
  order: ReservedOrder,
  actorId: string,
  requestId: string,
  action: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditEvent.create({
    data: {
      businessId: order.businessId,
      actorId,
      requestId,
      action,
      entityType: 'Order',
      entityId: order.id,
      metadata,
    },
  })
}
function eligible(order: ReservedOrder) {
  if (
    order.orderStatus !== 'CONFIRMED' ||
    !['CAPTURED', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus) ||
    !order.reservations.length ||
    order.reservations.some((r) => r.status !== 'ALLOCATED')
  )
    throw new DomainError(
      'FULFILLMENT_UNAVAILABLE',
      'This order needs confirmed payment and allocated stock before fulfillment.',
    )
  if (
    order.items.length !== order.reservations.length ||
    order.items.some(
      (item) =>
        !order.reservations.some((r) => r.balance.sku === item.sku && r.quantity === item.quantity),
    )
  )
    throw new DomainError(
      'INVENTORY_CONFLICT',
      'The saved allocation does not match this order’s items.',
    )
}
async function lockOrderBalances(tx: Prisma.TransactionClient, order: ReservedOrder) {
  await tx.$queryRaw`SELECT sku FROM products WHERE sku IN (${Prisma.join(order.items.map((item) => item.sku))}) ORDER BY sku FOR SHARE`
  await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${order.warehouseId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM inventory_balances WHERE id IN (${Prisma.join(order.reservations.map((r) => r.balanceId))}) ORDER BY sku FOR UPDATE`
  return tx.inventoryBalance.findMany({
    where: { id: { in: order.reservations.map((r) => r.balanceId) } },
  })
}
export async function packOrder(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  identifier: string,
  raw: OperationInput,
) {
  const input = operationSchema.parse(raw)
  return orderCommand(
    db,
    businessId,
    actorId,
    requestId,
    identifier,
    'pack-order',
    'fulfillOrders',
    input,
    { reason: input.reason },
    async (tx, order) => {
      if (order.fulfillmentStatus === 'SHIPPED') return
      eligible(order)
      if (order.fulfillmentStatus === 'PACKED') return
      await tx.order.update({
        where: { id: order.id },
        data: { fulfillmentStatus: 'PACKED', packedAt: new Date() },
      })
      await operationalAudit(tx, order, actorId, requestId, 'ORDER_PACKED', {
        reason: input.reason,
        items: order.items.map(({ sku, quantity }) => ({ sku, quantity })),
      })
    },
  )
}
export async function shipOrder(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  identifier: string,
  raw: ShipmentInput,
) {
  const input = shipmentSchema.parse(raw)
  return orderCommand(
    db,
    businessId,
    actorId,
    requestId,
    identifier,
    'ship-order',
    'fulfillOrders',
    input,
    { ...input, idempotencyKey: undefined },
    async (tx, order) => {
      if (order.shipment) {
        if (
          order.shipment.carrier !== input.carrier ||
          order.shipment.trackingReference !== input.trackingReference ||
          order.shipment.trackingUrl !== input.trackingUrl
        )
          throw new DomainError(
            'SHIPMENT_ALREADY_RECORDED',
            'This order already has a different shipment reference.',
          )
        return
      }
      eligible(order)
      if (order.fulfillmentStatus !== 'PACKED')
        throw new DomainError(
          'PACK_REQUIRED',
          'Pack and check the items before recording shipment.',
        )
      const balances = await lockOrderBalances(tx, order)
      for (const reservation of order.reservations) {
        const balance = balances.find((b) => b.id === reservation.balanceId)
        if (
          !balance ||
          balance.reserved < reservation.quantity ||
          balance.onHand < reservation.quantity
        )
          throw new DomainError(
            'INVENTORY_CONFLICT',
            'The allocation needs review before shipment.',
          )
        const onHand = balance.onHand - reservation.quantity,
          reserved = balance.reserved - reservation.quantity,
          version = balance.version + 1
        assertInventory(onHand, reserved)
        await tx.inventoryBalance.update({
          where: { id: balance.id },
          data: { onHand, reserved, version },
        })
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: { status: 'CONSUMED' },
        })
        await tx.inventoryMovement.create({
          data: {
            balanceId: balance.id,
            type: 'SHIP',
            deltaOnHand: -reservation.quantity,
            deltaReserved: -reservation.quantity,
            onHandAfter: onHand,
            reservedAfter: reserved,
            balanceVersion: version,
            reason: input.reason,
            actorId,
            orderId: order.id,
          },
        })
      }
      const shipment = await tx.shipment.create({
        data: {
          orderId: order.id,
          carrier: input.carrier,
          trackingReference: input.trackingReference,
          trackingUrl: input.trackingUrl,
          reason: input.reason,
          shippedBy: actorId,
        },
      })
      await tx.order.update({
        where: { id: order.id },
        data: { orderStatus: 'COMPLETED', fulfillmentStatus: 'SHIPPED' },
      })
      await operationalAudit(tx, order, actorId, requestId, 'ORDER_SHIPPED', {
        shipmentId: shipment.id,
        carrier: input.carrier,
        trackingReference: input.trackingReference,
        reason: input.reason,
        items: order.items.map(({ sku, quantity }) => ({ sku, quantity })),
      })
    },
  )
}
export async function receiveReturn(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  identifier: string,
  raw: ReturnReceiptInput,
) {
  const input = returnReceiptSchema.parse(raw),
    items = [...input.items].sort((a, b) => a.sku.localeCompare(b.sku, 'en'))
  return orderCommand(
    db,
    businessId,
    actorId,
    requestId,
    identifier,
    'receive-return',
    'fulfillOrders',
    input,
    { reason: input.reason, items },
    async (tx, order) => {
      if (
        order.fulfillmentStatus !== 'SHIPPED' ||
        !order.shipment ||
        order.reservations.some((r) => r.status !== 'CONSUMED')
      )
        throw new DomainError(
          'RETURN_UNAVAILABLE',
          'Only shipped items can be received as a return.',
        )
      const lines = items.map((line) => {
        const item = order.items.find((item) => item.sku === line.sku)
        const received = order.returns
          .flatMap((receipt) => receipt.items)
          .filter((r) => r.orderItem.sku === line.sku)
          .reduce((sum, r) => sum + r.quantity, 0)
        if (!item || received + line.quantity > item.quantity)
          throw new DomainError(
            'RETURN_QUANTITY_EXCEEDED',
            'The return quantity exceeds the shipped items still eligible for return.',
          )
        return { orderItemId: item.id, quantity: line.quantity }
      })
      const receipt = await tx.returnReceipt.create({
        data: {
          orderId: order.id,
          reason: input.reason,
          receivedBy: actorId,
          items: { create: lines },
        },
      })
      await operationalAudit(tx, order, actorId, requestId, 'RETURN_RECEIVED', {
        receiptId: receipt.id,
        reason: input.reason,
        items,
      })
    },
  )
}
export async function restockReturn(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  identifier: string,
  returnItemId: string,
  raw: RestockInput,
) {
  const input = restockSchema.parse(raw)
  return orderCommand(
    db,
    businessId,
    actorId,
    requestId,
    identifier,
    'restock-return',
    'fulfillOrders',
    input,
    { returnItemId, reason: input.reason, quantity: input.quantity },
    async (tx, order) => {
      const item = order.returns.flatMap((r) => r.items).find((item) => item.id === returnItemId)
      if (!item) throw new DomainError('NOT_FOUND', 'This received return could not be found.', 404)
      if (input.quantity > item.quantity - item.restockedQuantity)
        throw new DomainError(
          'RESTOCK_QUANTITY_EXCEEDED',
          'Only received items that have not been restocked are eligible.',
        )
      const balances = await lockOrderBalances(tx, order),
        balance = balances.find((b) => b.sku === item.orderItem.sku)
      if (!balance)
        throw new DomainError('INVENTORY_CONFLICT', 'The original warehouse stock needs review.')
      const onHand = balance.onHand + input.quantity,
        version = balance.version + 1
      if (onHand > 2_000_000_000)
        throw new DomainError('INVALID_INVENTORY', 'This stock quantity is too large.')
      assertInventory(onHand, balance.reserved)
      await tx.returnItem.update({
        where: { id: item.id },
        data: { restockedQuantity: { increment: input.quantity } },
      })
      await tx.inventoryBalance.update({ where: { id: balance.id }, data: { onHand, version } })
      await tx.inventoryMovement.create({
        data: {
          balanceId: balance.id,
          type: 'RETURN',
          deltaOnHand: input.quantity,
          deltaReserved: 0,
          onHandAfter: onHand,
          reservedAfter: balance.reserved,
          balanceVersion: version,
          reason: input.reason,
          actorId,
          orderId: order.id,
        },
      })
      await operationalAudit(tx, order, actorId, requestId, 'RETURN_RESTOCKED', {
        returnItemId,
        receiptId: item.receiptId,
        sku: item.orderItem.sku,
        quantity: input.quantity,
        reason: input.reason,
      })
    },
  )
}
