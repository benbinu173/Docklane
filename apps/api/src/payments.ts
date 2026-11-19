import express from 'express'
import { z } from 'zod'
import type { PrismaClient } from '@docklane/database'
import {
  DomainError,
  receiveStripeEvent,
  startPayment,
  transact,
  lockActor,
  type PaymentProvider,
} from '@docklane/domain'
import { signedIn, requirePermission } from './authorization.js'

export interface PaymentDependencies {
  provider: PaymentProvider
  returnOrigin: string
  verifyWebhook: (raw: Buffer, signature: string) => unknown
}
export function stripeWebhook(
  db: PrismaClient,
  businessId: string,
  payments?: PaymentDependencies,
) {
  const router = express.Router()
  router.post(
    '/api/v1/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '512kb' }),
    async (request, response) => {
      if (!payments)
        throw new DomainError(
          'PAYMENTS_NOT_CONFIGURED',
          'Stripe test payments are not configured.',
          503,
        )
      const signature = request.get('stripe-signature')
      if (!signature || !Buffer.isBuffer(request.body))
        throw new DomainError('INVALID_WEBHOOK_SIGNATURE', 'The webhook signature is invalid.', 400)
      let event: unknown
      try {
        event = payments.verifyWebhook(request.body, signature)
      } catch {
        throw new DomainError('INVALID_WEBHOOK_SIGNATURE', 'The webhook signature is invalid.', 400)
      }
      await receiveStripeEvent(db, businessId, event)
      response.json({ received: true })
    },
  )
  return router
}
export function paymentRoutes(
  db: PrismaClient,
  businessId: string,
  payments?: PaymentDependencies,
) {
  const router = express.Router()
  router.get('/payments/configuration', (_request, response) =>
    response.json({ data: { enabled: !!payments, testMode: true } }),
  )
  router.post(
    '/orders/:id/payment-sessions',
    requirePermission('placeOrders'),
    async (request, response) => {
      const id = z.uuid().parse(request.params.id)
      z.strictObject({}).parse(request.body)
      if (!payments)
        throw new DomainError(
          'PAYMENTS_NOT_CONFIGURED',
          'Stripe test checkout is awaiting configuration. Your saved order is unchanged.',
          503,
        )
      const data = await startPayment(
        db,
        businessId,
        signedIn(request).id,
        id,
        payments.returnOrigin,
        payments.provider,
      )
      response.json({ data })
    },
  )
  router.get('/operations/jobs', requirePermission('viewJobs'), async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
        status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
      })
      .parse(request.query)
    const where = { businessId, ...(query.status ? { status: query.status } : {}) }
    const [data, total, counts] = await db.$transaction([
      db.outboxEvent.findMany({
        where,
        select: {
          id: true,
          type: true,
          status: true,
          attempts: true,
          lastErrorCode: true,
          availableAt: true,
          createdAt: true,
          processedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.outboxEvent.count({ where }),
      db.$queryRaw<
        { status: string; count: number }[]
      >`SELECT status, count(*)::int AS count FROM outbox_events WHERE "businessId" = ${businessId} GROUP BY status`,
    ])
    response.json({
      data,
      counts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pages: Math.ceil(total / query.pageSize),
      },
    })
  })
  router.post(
    '/operations/jobs/:id/retries',
    requirePermission('manageJobs'),
    async (request, response) => {
      const id = z.uuid().parse(request.params.id),
        { reason } = z
          .strictObject({ reason: z.string().trim().min(3).max(500) })
          .parse(request.body)
      const data = await transact(db, async (tx) => {
        const actor = await lockActor(tx, businessId, signedIn(request).id, 'manageJobs')
        await tx.$queryRaw`SELECT id FROM outbox_events WHERE id = ${id}::uuid AND "businessId" = ${businessId} FOR UPDATE`
        const event = await tx.outboxEvent.findFirst({ where: { id, businessId } })
        if (!event)
          throw new DomainError('NOT_FOUND', 'This background task could not be found.', 404)
        if (event.status !== 'FAILED') return { id, status: event.status }
        await tx.outboxEvent.update({
          where: { id },
          data: {
            status: 'PENDING',
            attempts: 0,
            lastErrorCode: null,
            lockedAt: null,
            leaseToken: null,
            availableAt: new Date(),
          },
        })
        await tx.auditEvent.create({
          data: {
            businessId,
            actorId: actor.id,
            action: 'JOB_RETRY_REQUESTED',
            entityType: 'OutboxEvent',
            entityId: id,
            metadata: { reason },
            requestId: request.requestId,
          },
        })
        return { id, status: 'PENDING' }
      })
      response.json({ data })
    },
  )
  return router
}
