import { randomUUID } from 'node:crypto'
import { type PrismaClient, type Prisma } from '@docklane/database'
import { refundRequestSchema, type RefundRequestInput } from '@docklane/contracts'
import { DomainError } from './index.js'
import { orderCommand, operationalAudit } from './fulfillment.js'
import type { ReservedOrder } from './orders.js'

export function refundCapacity(
  payment: {
    amountPaise: number
    providerReference: string | null
    refunds: { amountPaise: number; status: string }[]
  } | null,
) {
  const capturedPaise = payment?.providerReference ? payment.amountPaise : 0
  const refundedPaise =
    payment?.refunds
      .filter((r) => r.status === 'SUCCEEDED')
      .reduce((sum, r) => sum + r.amountPaise, 0) ?? 0
  const pendingPaise =
    payment?.refunds
      .filter((r) => !['SUCCEEDED', 'FAILED'].includes(r.status))
      .reduce((sum, r) => sum + r.amountPaise, 0) ?? 0
  return {
    capturedPaise,
    refundedPaise,
    pendingPaise,
    availablePaise: Math.max(0, capturedPaise - refundedPaise - pendingPaise),
  }
}
export async function reserveRefund(
  tx: Prisma.TransactionClient,
  order: ReservedOrder,
  actorId: string,
  requestId: string,
  amountPaise: number,
  reason: string,
  purpose: 'ADMIN' | 'CANCELLATION',
) {
  const payment = order.payment
  if (!payment?.providerReference || payment.provider !== 'stripe_test')
    throw new DomainError(
      'REFUND_UNAVAILABLE',
      'This order needs a captured Stripe test payment before a refund.',
    )
  if (amountPaise > refundCapacity(payment).availablePaise)
    throw new DomainError(
      'REFUND_AMOUNT_EXCEEDED',
      'This amount exceeds the captured payment remaining after saved and pending refunds.',
    )
  const id = randomUUID()
  const refund = await tx.refundAttempt.create({
    data: {
      id,
      paymentId: payment.id,
      amountPaise,
      reason,
      purpose,
      requestedBy: actorId,
      providerIdempotencyKey: `refund:${id}`,
    },
  })
  await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUND_PENDING' } })
  await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'REFUND_PENDING' } })
  await tx.outboxEvent.create({
    data: { businessId: order.businessId, type: 'STRIPE_COMPENSATION', payload: { refundId: id } },
  })
  await operationalAudit(tx, order, actorId, requestId, 'REFUND_REQUESTED', {
    refundId: id,
    amountPaise,
    reason,
    purpose,
  })
  return refund
}
export async function requestRefund(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  requestId: string,
  identifier: string,
  raw: RefundRequestInput,
) {
  const input = refundRequestSchema.parse(raw)
  return orderCommand(
    db,
    businessId,
    actorId,
    requestId,
    identifier,
    'request-refund',
    'issueRefunds',
    input,
    { amountPaise: input.amountPaise, reason: input.reason },
    async (tx, order) => {
      await reserveRefund(tx, order, actorId, requestId, input.amountPaise, input.reason, 'ADMIN')
    },
  )
}
export async function updateRefundPaymentStatus(
  tx: Prisma.TransactionClient,
  order: ReservedOrder,
) {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { orderId: order.id },
    include: { refunds: true },
  })
  const totals = refundCapacity(payment)
  const status =
    totals.refundedPaise === totals.capturedPaise && totals.capturedPaise > 0
      ? 'REFUNDED'
      : totals.pendingPaise > 0 || ['CANCELLED', 'EXPIRED'].includes(order.orderStatus)
        ? 'REFUND_PENDING'
        : totals.refundedPaise > 0
          ? 'PARTIALLY_REFUNDED'
          : 'CAPTURED'
  await tx.payment.update({ where: { id: payment.id }, data: { status } })
  await tx.order.update({ where: { id: order.id }, data: { paymentStatus: status } })
}
