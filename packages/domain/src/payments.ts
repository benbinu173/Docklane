import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, type PrismaClient } from '@docklane/database'
import { DomainError } from './index.js'
import { lockActor } from './stock.js'
import { updateRefundPaymentStatus } from './refunds.js'
import { orderRecordInclude, releaseHeldStock, transact, type ReservedOrder } from './orders.js'
import {
  ProviderError,
  type CheckoutSessionRequest,
  type PaymentProvider,
  type ProviderSession,
} from './payment-provider.js'

const dbTime = async (tx: Prisma.TransactionClient) =>
  (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now
async function lockedOrder(tx: Prisma.TransactionClient, id: string, businessId: string) {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id}::uuid AND "businessId" = ${businessId} FOR UPDATE`
  return tx.order.findFirst({ where: { id, businessId }, include: orderRecordInclude })
}
async function enqueue(
  tx: Prisma.TransactionClient,
  businessId: string,
  type: string,
  payload: Prisma.InputJsonValue,
  availableAt?: Date,
) {
  return tx.outboxEvent.create({
    data: { businessId, type, payload, ...(availableAt ? { availableAt } : {}) },
  })
}
async function expireLocked(tx: Prisma.TransactionClient, order: ReservedOrder, force = false) {
  const now = await dbTime(tx)
  if (
    order.orderStatus !== 'AWAITING_PAYMENT' ||
    !order.expiresAt ||
    (!force && order.expiresAt > now)
  )
    return false
  if (
    !['PENDING', 'FAILED'].includes(order.paymentStatus) ||
    order.reservations.some((r) => r.status !== 'HELD')
  )
    throw new DomainError('RESERVATION_STATE_CONFLICT', 'This reservation needs review.')
  await releaseHeldStock(tx, order, 'Reservation expired before payment confirmation')
  await tx.order.update({
    where: { id: order.id },
    data: { orderStatus: 'EXPIRED', expiredAt: now },
  })
  await tx.auditEvent.create({
    data: {
      businessId: order.businessId,
      action: 'ORDER_EXPIRED',
      entityType: 'Order',
      entityId: order.id,
      metadata: { deadline: order.expiresAt.toISOString() },
    },
  })
  await enqueue(tx, order.businessId, 'STRIPE_SESSION_CLOSE', { orderId: order.id })
  return true
}
export async function expireOrder(db: PrismaClient, businessId: string, id: string) {
  return transact(db, async (tx) => {
    const order = await lockedOrder(tx, id, businessId)
    return order ? expireLocked(tx, order) : false
  })
}
export async function sweepExpiredOrders(db: PrismaClient, businessId: string, limit = 50) {
  const rows = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM orders WHERE "businessId" = ${businessId} AND "orderStatus" = 'AWAITING_PAYMENT' AND "expiresAt" <= clock_timestamp() ORDER BY "expiresAt", id LIMIT ${Math.min(100, limit)}`
  let expired = 0
  let failures = 0
  for (const row of rows) {
    try {
      if (await expireOrder(db, businessId, row.id)) expired++
    } catch {
      failures++
      const existing = await db.outboxEvent.findFirst({
        where: {
          businessId,
          type: 'ORDER_RESERVATION_EXPIRY',
          payload: { path: ['orderId'], equals: row.id },
        },
      })
      if (!existing)
        await db.outboxEvent.create({
          data: {
            businessId,
            type: 'ORDER_RESERVATION_EXPIRY',
            payload: { orderId: row.id, businessId },
          },
        })
    }
  }
  if (failures)
    throw new DomainError(
      'EXPIRY_REVIEW_REQUIRED',
      'An expired reservation needs review; other due orders were still processed.',
    )
  return expired
}
function validateSession(
  session: ProviderSession,
  payment: { id: string; sessionId: string | null; amountPaise: number; currency: string },
  order: { id: string; businessId: string },
) {
  if (
    session.live ||
    !session.id.startsWith('cs_test_') ||
    session.paymentId !== payment.id ||
    session.orderId !== order.id ||
    session.businessId !== order.businessId ||
    session.total !== payment.amountPaise ||
    session.currency?.toUpperCase() !== payment.currency ||
    (payment.sessionId && payment.sessionId !== session.id)
  )
    throw new DomainError(
      'PAYMENT_ASSOCIATION_INVALID',
      'The provider payment does not match this order.',
    )
}
export async function startPayment(
  db: PrismaClient,
  businessId: string,
  actorId: string,
  orderId: string,
  returnOrigin: string,
  provider: PaymentProvider,
) {
  const operation = await transact(db, async (tx) => {
    const actor = await lockActor(tx, businessId, actorId, 'placeOrders')
    const order = await lockedOrder(tx, orderId, businessId)
    if (!order || order.customerId !== actorId)
      throw new DomainError('NOT_FOUND', 'This order could not be found.', 404)
    if (await expireLocked(tx, order)) return null
    if (
      order.orderStatus !== 'AWAITING_PAYMENT' ||
      !['PENDING', 'FAILED'].includes(order.paymentStatus) ||
      !order.expiresAt ||
      !order.reservations.length ||
      order.reservations.some((r) => r.status !== 'HELD')
    )
      throw new DomainError('PAYMENT_UNAVAILABLE', 'This order cannot start another payment.')
    if (order.payment) {
      if (order.payment.provider !== 'stripe_test' || !order.payment.providerRequest)
        throw new DomainError(
          'PAYMENT_UNAVAILABLE',
          'This sample order does not have a Stripe checkout.',
        )
      return order.payment
    }
    const id = randomUUID()
    const address = z
      .object({ line: z.string(), city: z.string(), postalCode: z.string(), country: z.string() })
      .parse(order.deliveryAddress)
    // Stripe requires at least 30 minutes from its session creation. The stock
    // deadline remains unchanged; the worker closes the provider session then.
    const request: CheckoutSessionRequest = {
      paymentId: id,
      orderId: order.id,
      businessId,
      orderNumber: order.number,
      customerEmail: actor.email,
      customerName: order.customerName,
      address,
      returnOrigin,
      expiresAt: Math.floor(order.expiresAt.getTime() / 1000) + 31 * 60,
      items: order.items.map(({ name, quantity, unitPricePaise }) => ({
        name,
        quantity,
        unitPricePaise,
      })),
    }
    const payment = await tx.payment.create({
      data: {
        id,
        orderId,
        provider: 'stripe_test',
        providerIdempotencyKey: `checkout:${id}`,
        amountPaise: order.totalPaise,
        currency: order.currency,
        providerRequest: request as unknown as Prisma.InputJsonValue,
      },
    })
    await enqueue(
      tx,
      businessId,
      'STRIPE_RECONCILE',
      { paymentId: id },
      new Date((await dbTime(tx)).getTime() + 15_000),
    )
    await tx.auditEvent.create({
      data: {
        businessId,
        actorId,
        action: 'PAYMENT_STARTED',
        entityType: 'Payment',
        entityId: id,
        metadata: { orderId },
      },
    })
    return payment
  })
  if (!operation)
    throw new DomainError('ORDER_EXPIRED', 'The stock hold has expired. Start a new order.')
  let session: ProviderSession | null = null
  try {
    session = operation.sessionId
      ? await provider.session(operation.sessionId)
      : await provider.findSession(operation.id, operation.createdAt)
    if (!session)
      session = await provider.createSession(
        operation.providerRequest as unknown as CheckoutSessionRequest,
        operation.providerIdempotencyKey,
      )
    await reconcilePayment(db, businessId, operation.id, provider, session)
  } catch (e) {
    if (e instanceof DomainError) throw e
    throw new DomainError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Checkout could not be confirmed. Retry this payment; the same provider operation will be recovered.',
      503,
    )
  }
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: orderRecordInclude,
  })
  if (order.orderStatus !== 'AWAITING_PAYMENT')
    throw new DomainError(
      'PAYMENT_UNAVAILABLE',
      'Refresh this order to see its current payment result.',
    )
  if (
    session.status !== 'open' ||
    !session.url ||
    new URL(session.url).hostname !== 'checkout.stripe.com' ||
    new URL(session.url).protocol !== 'https:'
  )
    throw new DomainError(
      'CHECKOUT_UNAVAILABLE',
      'This checkout is no longer open. Refresh the order.',
    )
  return { url: session.url, orderId, sessionId: session.id }
}
export async function reconcilePayment(
  db: PrismaClient,
  businessId: string,
  paymentId: string,
  provider: PaymentProvider,
  knownSession?: ProviderSession,
  scheduleClose = true,
) {
  const saved = await db.payment.findFirst({
    where: { id: paymentId, order: { businessId }, provider: 'stripe_test' },
    include: { order: true },
  })
  if (!saved) throw new DomainError('NOT_FOUND', 'This payment could not be found.', 404)
  const session =
    knownSession ??
    (saved.sessionId
      ? await provider.session(saved.sessionId)
      : await provider.findSession(saved.id, saved.createdAt))
  if (!session) return saved.order.orderStatus !== 'AWAITING_PAYMENT'
  validateSession(session, saved, saved.order)
  const intent = session.intentId ? await provider.intent(session.intentId) : null
  if (
    intent &&
    (intent.live ||
      intent.paymentId !== saved.id ||
      intent.orderId !== saved.orderId ||
      intent.businessId !== businessId ||
      intent.amount !== saved.amountPaise ||
      intent.currency.toUpperCase() !== saved.currency)
  )
    throw new DomainError(
      'PAYMENT_ASSOCIATION_INVALID',
      'The payment amount or association does not match.',
    )
  if (
    session.paymentStatus === 'paid' &&
    (!intent || intent.status !== 'succeeded' || intent.received !== saved.amountPaise)
  )
    throw new DomainError(
      'PAYMENT_ASSOCIATION_INVALID',
      'The captured amount does not match this order.',
    )
  return transact(db, async (tx) => {
    const order = await lockedOrder(tx, saved.orderId, businessId)
    if (!order?.payment) throw new DomainError('NOT_FOUND', 'This payment could not be found.', 404)
    const payment = order.payment
    validateSession(session, payment, order)
    if (payment.providerReference && intent && payment.providerReference !== intent.id)
      throw new DomainError(
        'PAYMENT_ASSOCIATION_INVALID',
        'A different payment was already recorded.',
      )
    const now = await dbTime(tx)
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        sessionId: session.id,
        checkoutUrl: session.url,
        sessionExpiresAt: new Date(session.expiresAt * 1000),
        lastReconciledAt: now,
      },
    })
    if (session.paymentStatus === 'paid' && intent) {
      if (['CAPTURED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status))
        return true
      const eligible =
        order.orderStatus === 'AWAITING_PAYMENT' &&
        !!order.expiresAt &&
        order.expiresAt > now &&
        order.reservations.length > 0 &&
        order.reservations.every((r) => r.status === 'HELD')
      if (eligible) {
        await tx.stockReservation.updateMany({
          where: { orderId: order.id, status: 'HELD' },
          data: { status: 'ALLOCATED' },
        })
        await tx.order.update({
          where: { id: order.id },
          data: { orderStatus: 'CONFIRMED', paymentStatus: 'CAPTURED', confirmedAt: now },
        })
        await tx.payment.update({
          where: { id: payment.id },
          data: { providerReference: intent.id, status: 'CAPTURED' },
        })
        await tx.auditEvent.create({
          data: {
            businessId,
            action: 'PAYMENT_CONFIRMED',
            entityType: 'Order',
            entityId: order.id,
            metadata: { paymentId },
          },
        })
      } else {
        await expireLocked(tx, order)
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: 'REFUND_PENDING' },
        })
        await tx.payment.update({
          where: { id: payment.id },
          data: { providerReference: intent.id, status: 'REFUND_PENDING' },
        })
        const refund = await tx.refundAttempt.create({
          data: {
            paymentId,
            amountPaise: payment.amountPaise,
            reason: 'Payment confirmed after the reservation ended',
            purpose: 'LATE_PAYMENT',
            providerIdempotencyKey: `late-payment:${paymentId}`,
            requestedBy: order.customerId,
          },
        })
        await enqueue(tx, businessId, 'STRIPE_COMPENSATION', { refundId: refund.id })
        await tx.auditEvent.create({
          data: {
            businessId,
            action: 'LATE_PAYMENT_REFUND_REQUESTED',
            entityType: 'Order',
            entityId: order.id,
            metadata: { paymentId, refundId: refund.id },
          },
        })
      }
      return true
    }
    // Always reconcile current provider state; an old failure event cannot
    // regress a captured payment, allocated reservation, or completed refund.
    if (!['PENDING', 'FAILED'].includes(payment.status)) return true
    if (session.status === 'expired') {
      await expireLocked(tx, order, true)
      return true
    }
    if (await expireLocked(tx, order)) return true
    if (order.orderStatus !== 'AWAITING_PAYMENT') {
      if (scheduleClose)
        await enqueue(tx, businessId, 'STRIPE_SESSION_CLOSE', { orderId: order.id })
      return true
    }
    if (intent?.status === 'requires_payment_method') {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } })
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } })
    }
    return false
  })
}
export async function receiveStripeEvent(db: PrismaClient, businessId: string, raw: unknown) {
  const event = z
    .object({
      id: z.string().min(1).max(255),
      type: z.string().max(100),
      livemode: z.literal(false),
      data: z.object({ object: z.object({ id: z.string().min(1).max(255) }) }),
    })
    .parse(raw)
  const supported =
    /^(checkout\.session\.(completed|expired|async_payment_succeeded|async_payment_failed)|payment_intent\.(succeeded|payment_failed)|refund\.(updated|created|failed))$/.test(
      event.type,
    )
  return transact(db, async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`stripe-event:${event.id}`}, 0))`
    const existing = await tx.webhookReceipt.findUnique({
      where: { provider_eventId: { provider: 'stripe_test', eventId: event.id } },
    })
    if (existing) return existing.id
    const receipt = await tx.webhookReceipt.create({
      data: {
        provider: 'stripe_test',
        eventId: event.id,
        eventType: event.type,
        payload: { objectId: event.data.object.id },
        ...(!supported ? { processedAt: await dbTime(tx) } : {}),
      },
    })
    if (supported) await enqueue(tx, businessId, 'STRIPE_WEBHOOK', { receiptId: receipt.id })
    return receipt.id
  })
}
async function processReceipt(
  db: PrismaClient,
  businessId: string,
  id: string,
  provider: PaymentProvider,
) {
  const receipt = await db.webhookReceipt.findUniqueOrThrow({ where: { id } })
  if (receipt.processedAt) return
  const { objectId } = z.object({ objectId: z.string() }).parse(receipt.payload)
  if (receipt.eventType.startsWith('checkout.session.')) {
    const session = await provider.session(objectId)
    const payment = session.paymentId
      ? await db.payment.findFirst({
          where: { id: session.paymentId, provider: 'stripe_test', order: { businessId } },
        })
      : null
    if (payment) await reconcilePayment(db, businessId, payment.id, provider, session)
  } else if (receipt.eventType.startsWith('payment_intent.')) {
    const intent = await provider.intent(objectId)
    const payment = intent.paymentId
      ? await db.payment.findFirst({
          where: { id: intent.paymentId, provider: 'stripe_test', order: { businessId } },
        })
      : null
    if (payment) await reconcilePayment(db, businessId, payment.id, provider)
  } else {
    const refund = await provider.refundStatus(objectId)
    const attempt = await db.refundAttempt.findFirst({
      where: {
        providerReference: refund.id,
        payment: { provider: 'stripe_test', order: { businessId } },
      },
    })
    if (attempt) await compensatePayment(db, businessId, attempt.id, provider)
  }
  await db.webhookReceipt.update({ where: { id }, data: { processedAt: new Date() } })
}
export async function compensatePayment(
  db: PrismaClient,
  businessId: string,
  refundId: string,
  provider: PaymentProvider,
) {
  const attempt = await db.refundAttempt.findFirst({
    where: { id: refundId, payment: { provider: 'stripe_test', order: { businessId } } },
    include: { payment: true },
  })
  if (!attempt?.payment.providerReference)
    throw new DomainError('REFUND_ASSOCIATION_INVALID', 'The compensation payment needs review.')
  if (attempt.status === 'SUCCEEDED') return true
  if (attempt.status === 'FAILED')
    throw new DomainError('REFUND_FAILED', 'The provider refund requires review.')
  // The order lock also serializes refund capacity and cancellation. Persist an
  // ambiguous in-flight attempt before making any call outside the transaction.
  await transact(db, async (tx) => {
    const order = await lockedOrder(tx, attempt.payment.orderId, businessId)
    if (!order?.payment) throw new DomainError('NOT_FOUND', 'This payment could not be found.', 404)
    const reserved = order.payment.refunds
      .filter((r) => r.status !== 'FAILED')
      .reduce((sum, r) => sum + r.amountPaise, 0)
    if (reserved > order.payment.amountPaise)
      throw new DomainError(
        'REFUND_ASSOCIATION_INVALID',
        'Saved refunds exceed the captured payment.',
      )
    await tx.refundAttempt.updateMany({
      where: { id: refundId, status: { in: ['REQUESTED', 'RECONCILIATION_REQUIRED'] } },
      data: { status: 'PROCESSING' },
    })
  })
  const intent = await provider.intent(attempt.payment.providerReference)
  if (
    intent.live ||
    intent.paymentId !== attempt.paymentId ||
    intent.orderId !== attempt.payment.orderId ||
    intent.businessId !== businessId ||
    intent.received !== attempt.payment.amountPaise ||
    intent.amount !== attempt.payment.amountPaise ||
    intent.currency.toUpperCase() !== attempt.payment.currency ||
    attempt.amountPaise > intent.received ||
    intent.status !== 'succeeded'
  )
    throw new DomainError(
      'REFUND_ASSOCIATION_INVALID',
      'The captured payment does not match this refund.',
    )
  let refund = attempt.providerReference
    ? await provider.refundStatus(attempt.providerReference)
    : await provider.findRefund(intent.id, attempt.providerIdempotencyKey)
  if (!refund) {
    // Never reuse a possibly pruned Stripe idempotency key. Ambiguous old work
    // stays visible for reconciliation rather than risking a duplicate refund.
    if (Date.now() - attempt.createdAt.getTime() >= 23 * 3600_000)
      throw new DomainError(
        'REFUND_RECONCILIATION_REQUIRED',
        'An old ambiguous refund needs provider reconciliation.',
      )
    refund = await provider.refund(intent.id, attempt.amountPaise, attempt.providerIdempotencyKey)
  }
  if (
    refund.live ||
    refund.intentId !== intent.id ||
    refund.amount !== attempt.amountPaise ||
    refund.currency.toUpperCase() !== attempt.payment.currency
  )
    throw new DomainError('REFUND_ASSOCIATION_INVALID', 'The provider refund does not match.')
  const result = refund
  const outcome = await transact(db, async (tx) => {
    const order = await lockedOrder(tx, attempt.payment.orderId, businessId)
    if (!order) throw new DomainError('NOT_FOUND', 'This order could not be found.', 404)
    const current = await tx.refundAttempt.findUniqueOrThrow({ where: { id: refundId } })
    if (current.status === 'SUCCEEDED') return 'SUCCEEDED' as const
    if (current.status === 'FAILED') return 'FAILED' as const
    if (current.providerReference && current.providerReference !== result.id)
      throw new DomainError('REFUND_ASSOCIATION_INVALID', 'A different refund was already saved.')
    const status =
      result.status === 'succeeded'
        ? 'SUCCEEDED'
        : ['failed', 'canceled'].includes(result.status ?? '')
          ? 'FAILED'
          : 'PROCESSING'
    await tx.refundAttempt.update({
      where: { id: refundId },
      data: {
        providerReference: result.id,
        status,
        lastReconciledAt: new Date(),
        ...(['SUCCEEDED', 'FAILED'].includes(status) ? { resolvedAt: new Date() } : {}),
      },
    })
    await updateRefundPaymentStatus(tx, order)
    if (status === 'PROCESSING') return status
    await tx.auditEvent.create({
      data: {
        businessId,
        actorId: attempt.requestedBy,
        action:
          status === 'FAILED'
            ? 'REFUND_FAILED'
            : attempt.purpose === 'LATE_PAYMENT'
              ? 'LATE_PAYMENT_REFUNDED'
              : 'REFUND_SUCCEEDED',
        entityType: 'Order',
        entityId: order.id,
        metadata: {
          refundId,
          amountPaise: attempt.amountPaise,
          reason: attempt.reason,
          purpose: attempt.purpose,
        },
      },
    })
    return status
  })
  if (outcome === 'FAILED')
    throw new DomainError('REFUND_FAILED', 'The provider refund requires review.')
  return outcome === 'SUCCEEDED'
}
export async function processOutboxEvent(
  db: PrismaClient,
  businessId: string,
  id: string,
  provider?: PaymentProvider,
) {
  const token = randomUUID()
  const claimed = await db.$queryRaw<
    { id: string; type: string; payload: Prisma.JsonValue; attempts: number }[]
  >`UPDATE outbox_events SET status = 'PROCESSING', "lockedAt" = clock_timestamp(), "leaseToken" = ${token}::uuid, attempts = attempts + 1 WHERE id = ${id}::uuid AND "businessId" = ${businessId} AND ((status = 'PENDING' AND "availableAt" <= clock_timestamp()) OR (status = 'PROCESSING' AND "lockedAt" < clock_timestamp() - interval '90 seconds')) RETURNING id, type, payload, attempts`
  const event = claimed[0]
  if (!event) return false
  let complete = true
  try {
    const payload = z.record(z.string(), z.string()).parse(event.payload)
    if (event.type === 'ORDER_RESERVATION_EXPIRY')
      await expireOrder(db, businessId, payload.orderId)
    else {
      if (!provider) throw new ProviderError('STRIPE_NOT_CONFIGURED')
      if (event.type === 'STRIPE_WEBHOOK')
        await processReceipt(db, businessId, payload.receiptId, provider)
      else if (event.type === 'STRIPE_RECONCILE')
        complete = await reconcilePayment(db, businessId, payload.paymentId, provider)
      else if (event.type === 'STRIPE_COMPENSATION')
        complete = await compensatePayment(db, businessId, payload.refundId, provider)
      else if (event.type === 'STRIPE_SESSION_CLOSE') {
        const payment = await db.payment.findFirst({
          where: { orderId: payload.orderId, provider: 'stripe_test', order: { businessId } },
        })
        if (payment) {
          const session = payment.sessionId
            ? await provider.session(payment.sessionId)
            : await provider.findSession(payment.id, payment.createdAt)
          if (session) {
            await reconcilePayment(db, businessId, payment.id, provider, session, false)
            await provider.expireSession(session.id, `close:${payment.id}`)
          }
        }
      } else throw new DomainError('UNKNOWN_JOB', 'This background task needs review.')
    }
    await db.outboxEvent.updateMany({
      where: { id, leaseToken: token },
      data: {
        status: complete ? 'COMPLETED' : 'PENDING',
        processedAt: complete ? new Date() : null,
        lockedAt: null,
        leaseToken: null,
        lastErrorCode: null,
        ...(!complete ? { availableAt: new Date(Date.now() + 30_000), attempts: 0 } : {}),
      },
    })
    return true
  } catch (error) {
    const code =
      error instanceof DomainError || error instanceof ProviderError
        ? error.code
        : 'JOB_UNAVAILABLE'
    const terminal =
      event.attempts >= 8 ||
      [
        'PAYMENT_ASSOCIATION_INVALID',
        'REFUND_ASSOCIATION_INVALID',
        'REFUND_RECONCILIATION_REQUIRED',
        'REFUND_FAILED',
        'UNKNOWN_JOB',
      ].includes(code)
    if (terminal && event.type === 'STRIPE_COMPENSATION') {
      const { refundId } = z.object({ refundId: z.uuid() }).parse(event.payload)
      await transact(db, async (tx) => {
        const refund = await tx.refundAttempt.findFirst({
          where: { id: refundId, payment: { order: { businessId } } },
          include: { payment: true },
        })
        if (!refund) return
        const order = await lockedOrder(tx, refund.payment.orderId, businessId)
        if (!order) return
        const changed = await tx.refundAttempt.updateMany({
          where: { id: refundId, status: { in: ['REQUESTED', 'PROCESSING'] } },
          data: { status: 'RECONCILIATION_REQUIRED' },
        })
        if (changed.count)
          await tx.auditEvent.create({
            data: {
              businessId,
              action: 'REFUND_RECONCILIATION_REQUIRED',
              entityType: 'Order',
              entityId: order.id,
              metadata: { refundId, code, amountPaise: refund.amountPaise },
            },
          })
      })
    }
    await db.outboxEvent.updateMany({
      where: { id, leaseToken: token },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        lastErrorCode: code,
        lockedAt: null,
        leaseToken: null,
        availableAt: new Date(Date.now() + Math.min(300_000, 1000 * 2 ** event.attempts)),
      },
    })
    throw new ProviderError(code)
  }
}
export async function dueOutboxEvents(db: PrismaClient, businessId: string, limit = 50) {
  return db.$queryRaw<
    { id: string; attempts: number }[]
  >`SELECT id, attempts FROM outbox_events WHERE "businessId" = ${businessId} AND ((status = 'PENDING' AND "availableAt" <= clock_timestamp()) OR (status = 'PROCESSING' AND "lockedAt" < clock_timestamp() - interval '90 seconds')) ORDER BY "availableAt", id LIMIT ${Math.min(100, limit)}`
}
