import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@docklane/database'
import { type StockAdjustment, type AdjustmentResult, type Role } from '@docklane/contracts'
import { assertInventory, DomainError, permits } from './index.js'

export async function lockActor(
  tx: Prisma.TransactionClient,
  businessId: string,
  actorId: string,
  permission: Parameters<typeof permits>[1],
) {
  await tx.$queryRaw`SELECT id FROM user_profiles WHERE id = ${actorId}::uuid FOR SHARE`
  const actor = await tx.userProfile.findUnique({ where: { id: actorId } })
  if (!actor?.active || actor.businessId !== businessId || !permits(actor.role as Role, permission))
    throw new DomainError('FORBIDDEN', 'Your account does not have permission to do that.', 403)
  return actor
}
export function assertVersion(actual: number, expected: number) {
  if (actual !== expected)
    throw new DomainError(
      'STALE_VERSION',
      'This record changed while you were editing. Reload it and review the latest values before saving.',
    )
}
export async function lockBalance(
  tx: Prisma.TransactionClient,
  businessId: string,
  balanceId: string,
) {
  const found = await tx.inventoryBalance.findFirst({
    where: { id: balanceId, product: { businessId }, warehouse: { businessId } },
    select: { sku: true, warehouseId: true },
  })
  if (!found) throw new DomainError('NOT_FOUND', 'This stock level could not be found.', 404)
  // Metadata archives and stock operations share the same lock order.
  await tx.$queryRaw`SELECT sku FROM products WHERE sku = ${found.sku} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${found.warehouseId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM inventory_balances WHERE id = ${balanceId} FOR UPDATE`
  return tx.inventoryBalance.findUniqueOrThrow({
    where: { id: balanceId },
    include: { product: true, warehouse: true },
  })
}
export async function createStockLevel(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  input: { sku: string; warehouseId: string },
) {
  return db.$transaction(async (tx) => {
    await lockActor(tx, businessId, actorId, 'adjustStock')
    await tx.$queryRaw`SELECT sku FROM products WHERE sku = ${input.sku} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${input.warehouseId} FOR SHARE`
    const [product, warehouse] = await Promise.all([
      tx.product.findFirst({ where: { sku: input.sku, businessId } }),
      tx.warehouse.findFirst({ where: { id: input.warehouseId, businessId } }),
    ])
    if (!product || !warehouse)
      throw new DomainError('NOT_FOUND', 'Choose a product and warehouse in this workspace.', 404)
    if (product.archived || warehouse.archived)
      throw new DomainError(
        'RESOURCE_ARCHIVED',
        'Restore the product or warehouse before tracking new stock.',
      )
    const balance = await tx.inventoryBalance.create({ data: { id: randomUUID(), ...input } })
    await tx.auditEvent.create({
      data: {
        businessId,
        actorId,
        requestId,
        action: 'STOCK_LEVEL_CREATED',
        entityType: 'InventoryBalance',
        entityId: balance.id,
        metadata: input,
      },
    })
    return balance
  })
}
export async function adjustStock(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  balanceId: string,
  input: StockAdjustment,
): Promise<AdjustmentResult> {
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        balanceId,
        type: input.type,
        quantity: input.quantity,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
      }),
    )
    .digest('hex')
  return db.$transaction(async (tx) => {
    await lockActor(tx, businessId, actorId, 'adjustStock')
    // Serialize even different-balance reuse of the same actor/key. This lock is
    // scoped to one command; unrelated stock operations remain concurrent.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${actorId}:adjust-stock:${input.idempotencyKey}`}, 0))`
    const key = {
      userId_operation_key: {
        userId: actorId,
        operation: 'adjust-stock',
        key: input.idempotencyKey,
      },
    }
    const saved = await tx.idempotencyRecord.findUnique({ where: key })
    if (saved) {
      if (saved.fingerprint !== fingerprint)
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          'This adjustment key was already used for a different change.',
        )
      if (!saved.outcome || saved.status !== 'COMPLETED')
        throw new DomainError(
          'REQUEST_IN_PROGRESS',
          'This adjustment is still being processed. Try the same request again.',
        )
      return saved.outcome as unknown as AdjustmentResult
    }
    const balance = await lockBalance(tx, businessId, balanceId)
    assertVersion(balance.version, input.expectedVersion)
    const onHand =
      input.type === 'SET'
        ? input.quantity
        : balance.onHand + (input.type === 'INCREASE' ? input.quantity : -input.quantity)
    if (onHand < balance.reserved)
      throw new DomainError(
        'RESERVED_STOCK',
        'This change would use stock already reserved for orders. Keep on-hand stock at or above the reserved quantity.',
      )
    if (onHand > 2_000_000_000)
      throw new DomainError('QUANTITY_TOO_LARGE', 'The resulting stock quantity is too large.')
    const { available } = assertInventory(onHand, balance.reserved)
    const deltaOnHand = onHand - balance.onHand
    if (!deltaOnHand)
      throw new DomainError(
        'NO_STOCK_CHANGE',
        'The requested count is already saved. No adjustment is needed.',
      )
    if (deltaOnHand > 0 && (balance.product.archived || balance.warehouse.archived))
      throw new DomainError(
        'RESOURCE_ARCHIVED',
        'Restore the product or warehouse before adding stock.',
      )
    const version = balance.version + 1
    const updated = await tx.inventoryBalance.update({
      where: { id: balanceId },
      data: { onHand, version },
    })
    const movement = await tx.inventoryMovement.create({
      data: {
        balanceId,
        type: 'ADJUST',
        deltaOnHand,
        deltaReserved: 0,
        onHandAfter: onHand,
        reservedAfter: balance.reserved,
        balanceVersion: version,
        reason: input.reason,
        actorId,
      },
    })
    await tx.auditEvent.create({
      data: {
        businessId,
        actorId,
        requestId,
        action: 'STOCK_ADJUSTED',
        entityType: 'InventoryBalance',
        entityId: balanceId,
        metadata: {
          movementId: movement.id,
          type: input.type,
          quantity: input.quantity,
          reason: input.reason,
          from: balance.onHand,
          to: onHand,
          reserved: balance.reserved,
          version,
        },
      },
    })
    const outcome: AdjustmentResult = {
      balance: { id: updated.id, onHand, reserved: updated.reserved, available, version },
      movementId: movement.id,
    }
    await tx.idempotencyRecord.create({
      data: {
        userId: actorId,
        operation: 'adjust-stock',
        key: input.idempotencyKey,
        fingerprint,
        status: 'COMPLETED',
        outcome: { ...outcome },
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
    })
    return outcome
  })
}
export async function changeThreshold(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  balanceId: string,
  input: { threshold: number; expectedVersion: number; reason: string },
) {
  return db.$transaction(async (tx) => {
    await lockActor(tx, businessId, actorId, 'adjustStock')
    const balance = await lockBalance(tx, businessId, balanceId)
    assertVersion(balance.version, input.expectedVersion)
    if (balance.threshold === input.threshold) return balance
    const updated = await tx.inventoryBalance.update({
      where: { id: balanceId },
      data: { threshold: input.threshold, version: { increment: 1 } },
    })
    await tx.auditEvent.create({
      data: {
        businessId,
        actorId,
        requestId,
        action: 'STOCK_THRESHOLD_CHANGED',
        entityType: 'InventoryBalance',
        entityId: balanceId,
        metadata: {
          from: balance.threshold,
          to: input.threshold,
          reason: input.reason,
          version: updated.version,
        },
      },
    })
    return updated
  })
}
