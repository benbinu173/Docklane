import { Router } from 'express'
import { z } from 'zod'
import type { PrismaClient } from '@docklane/database'
import {
  packOrder,
  shipOrder,
  receiveReturn,
  restockReturn,
  requestRefund,
  orderCommand,
  operationalAudit,
  DomainError,
} from '@docklane/domain'
import {
  operationSchema,
  shipmentSchema,
  returnReceiptSchema,
  restockSchema,
  refundRequestSchema,
  paginationSchema,
} from '@docklane/contracts'
import { requirePermission, signedIn } from './authorization.js'
import { orderDetail } from './orders.js'
import type { PaymentDependencies } from './payments.js'

export function fulfillmentRoutes(
  db: PrismaClient,
  businessId: string,
  payments?: PaymentDependencies,
) {
  const router = Router(),
    identifier = z.string().min(1).max(80)
  router.post(
    '/orders/:identifier/packing',
    requirePermission('fulfillOrders'),
    async (request, response) => {
      response.json({
        data: orderDetail(
          await packOrder(
            db,
            businessId,
            signedIn(request).id,
            request.requestId,
            identifier.parse(request.params.identifier),
            operationSchema.parse(request.body),
          ),
        ),
      })
    },
  )
  router.post(
    '/orders/:identifier/shipments',
    requirePermission('fulfillOrders'),
    async (request, response) => {
      response.json({
        data: orderDetail(
          await shipOrder(
            db,
            businessId,
            signedIn(request).id,
            request.requestId,
            identifier.parse(request.params.identifier),
            shipmentSchema.parse(request.body),
          ),
        ),
      })
    },
  )
  router.post(
    '/orders/:identifier/returns',
    requirePermission('fulfillOrders'),
    async (request, response) => {
      response.status(201).json({
        data: orderDetail(
          await receiveReturn(
            db,
            businessId,
            signedIn(request).id,
            request.requestId,
            identifier.parse(request.params.identifier),
            returnReceiptSchema.parse(request.body),
          ),
        ),
      })
    },
  )
  router.post(
    '/orders/:identifier/returns/:itemId/restocks',
    requirePermission('fulfillOrders'),
    async (request, response) => {
      response.json({
        data: orderDetail(
          await restockReturn(
            db,
            businessId,
            signedIn(request).id,
            request.requestId,
            identifier.parse(request.params.identifier),
            z.uuid().parse(request.params.itemId),
            restockSchema.parse(request.body),
          ),
        ),
      })
    },
  )
  router.post(
    '/orders/:identifier/refunds',
    requirePermission('issueRefunds'),
    async (request, response) => {
      const input = refundRequestSchema.parse(request.body)
      if (!payments)
        throw new DomainError(
          'PAYMENTS_NOT_CONFIGURED',
          'Stripe test refunds are awaiting configuration.',
          503,
        )
      response.status(202).json({
        data: orderDetail(
          await requestRefund(
            db,
            businessId,
            signedIn(request).id,
            request.requestId,
            identifier.parse(request.params.identifier),
            input,
          ),
        ),
      })
    },
  )
  router.post(
    '/orders/:identifier/refunds/:refundId/reconciliation',
    requirePermission('issueRefunds'),
    async (request, response) => {
      const input = operationSchema.parse(request.body),
        refundId = z.uuid().parse(request.params.refundId),
        actorId = signedIn(request).id
      if (!payments)
        throw new DomainError(
          'PAYMENTS_NOT_CONFIGURED',
          'Stripe test refunds are awaiting configuration.',
          503,
        )
      const order = await orderCommand(
        db,
        businessId,
        actorId,
        request.requestId,
        identifier.parse(request.params.identifier),
        'reconcile-refund',
        'issueRefunds',
        input,
        { refundId, reason: input.reason },
        async (tx, order) => {
          const refund = order.payment?.refunds.find((r) => r.id === refundId)
          if (!refund) throw new DomainError('NOT_FOUND', 'This refund could not be found.', 404)
          if (refund.status === 'SUCCEEDED') return
          if (refund.status === 'FAILED')
            throw new DomainError(
              'REFUND_FAILED',
              'This provider refund failed. Review it before requesting a new refund.',
            )
          await tx.outboxEvent.create({
            data: { businessId, type: 'STRIPE_COMPENSATION', payload: { refundId } },
          })
          await operationalAudit(
            tx,
            order,
            actorId,
            request.requestId,
            'REFUND_RECONCILIATION_REQUESTED',
            { refundId, reason: input.reason },
          )
        },
      )
      response.status(202).json({ data: orderDetail(order) })
    },
  )
  router.get('/orders/:identifier/timeline', async (request, response) => {
    const id = identifier.parse(request.params.identifier),
      profile = signedIn(request),
      query = paginationSchema.parse(request.query)
    const order = await db.order.findFirst({
      where: {
        businessId,
        ...(z.uuid().safeParse(id).success ? { id } : { number: id }),
        ...(profile.role === 'CUSTOMER' ? { customerId: profile.id } : {}),
      },
      select: { id: true },
    })
    if (!order) throw new DomainError('NOT_FOUND', 'This order could not be found.', 404)
    const where = { businessId, entityType: 'Order', entityId: order.id }
    const [events, total] = await db.$transaction([
      db.auditEvent.findMany({
        where,
        include: { actor: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.auditEvent.count({ where }),
    ])
    response.json({
      data: events.map((event) => ({
        id: event.id,
        action: event.action,
        actor: event.actor?.name ?? 'Docklane',
        createdAt: event.createdAt.toISOString(),
        metadata: event.metadata,
      })),
      pagination: { ...query, total, pages: Math.ceil(total / query.pageSize) },
    })
  })
  return router
}
