import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { pinoHttp } from 'pino-http'
import { randomUUID } from 'node:crypto'
import { z, ZodError } from 'zod'
import { Prisma, type PrismaClient } from '@docklane/database'
import {
  DomainError,
  quoteCheckout,
  createReservedOrder,
  cancelUnpaidOrder,
} from '@docklane/domain'
import {
  orderQuerySchema,
  paginationSchema,
  roleChangeSchema,
  checkoutQuoteSchema,
  checkoutSchema,
  cancellationSchema,
  type Profile,
  type ApiErrorBody,
  type WorkspaceSummary,
} from '@docklane/contracts'
import type { IdentityVerifier } from './identity.js'
import { orderInclude, orderSummary, orderDetail } from './orders.js'
import { signedIn, requirePermission } from './authorization.js'
import { createInventoryRouter } from './inventory.js'
import { createResourcesRouter } from './resources.js'
import { paymentRoutes, stripeWebhook, type PaymentDependencies } from './payments.js'
import { fulfillmentRoutes } from './fulfillment.js'

declare global {
  // Express request augmentation requires its global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      profile?: Profile
      requestId: string
    }
  }
}
export interface AppDependencies {
  db: PrismaClient
  verifyIdentity: IdentityVerifier
  businessId: string
  origins: string[]
  logLevel?: string
  payments?: PaymentDependencies
}
const profileSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  businessId: true,
} as const
function sendError(
  request: Request,
  response: Response,
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
) {
  const body: ApiErrorBody = {
    error: { code, message, requestId: request.requestId, ...(fields ? { fields } : {}) },
  }
  response.status(status).json(body)
}

export function createApp({
  db,
  verifyIdentity,
  businessId,
  origins,
  logLevel = 'info',
  payments,
}: AppDependencies) {
  const app = express()
  app.disable('x-powered-by')
  app.use((request, response, next) => {
    request.requestId = randomUUID()
    response.setHeader('X-Request-Id', request.requestId)
    response.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use(
    pinoHttp({
      level: logLevel,
      genReqId: (request) => (request as Request).requestId,
      serializers: {
        req: (request) => ({
          id: request.id,
          method: request.method,
          url: String(request.url).split('?')[0],
        }),
      },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-docklane-session"]',
        '*.password',
        '*.token',
      ],
    }),
  )
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(
    cors({
      origin: (origin, done) => {
        if (!origin || origins.includes(origin)) done(null, true)
        else
          done(
            new DomainError('ORIGIN_NOT_ALLOWED', 'This application origin is not allowed.', 403),
          )
      },
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Docklane-Session'],
      exposedHeaders: ['X-Request-Id'],
    }),
  )
  app.use(stripeWebhook(db, businessId, payments))
  app.use(express.json({ limit: '32kb' }))
  app.get('/health/live', (_request, response) => response.json({ status: 'ok' }))
  app.get('/health/ready', async (_request, response) => {
    try {
      await db.$queryRaw`SELECT 1`
      response.json({ status: 'ready' })
    } catch {
      throw new DomainError('SERVICE_UNAVAILABLE', 'The database is temporarily unavailable.', 503)
    }
  })
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 60_000,
      limit: 200,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (request, response) =>
        sendError(
          request,
          response,
          429,
          'RATE_LIMITED',
          'Too many requests. Try again in a moment.',
        ),
    }),
  )
  app.use('/api/v1', async (request, _response, next) => {
    try {
      const bearer = request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
      const sessionToken = request.get('X-Docklane-Session')
      if (!bearer || bearer.length > 8192 || !sessionToken || sessionToken.length > 2048)
        throw new DomainError('UNAUTHORIZED', 'Sign in to continue.', 401)
      const identity = await verifyIdentity(bearer, sessionToken)
      const profile = await db.userProfile.upsert({
        where: { authSubject: identity.subject },
        create: {
          authSubject: identity.subject,
          name: identity.name,
          email: identity.email,
          businessId,
        },
        update: {},
        select: profileSelect,
      })
      if (!profile.active)
        throw new DomainError(
          'ACCOUNT_DISABLED',
          'This account is inactive. Contact your workspace admin.',
          403,
        )
      if (profile.businessId !== businessId)
        throw new DomainError('FORBIDDEN', 'This account cannot access this workspace.', 403)
      request.profile = profile
      next()
    } catch (error) {
      next(error)
    }
  })
  app.use('/api/v1', createResourcesRouter(db, businessId), createInventoryRouter(db, businessId))
  app.use('/api/v1', paymentRoutes(db, businessId, payments))
  app.get('/api/v1/me', (request, response) => response.json({ data: signedIn(request) }))

  app.get('/api/v1/workspace', requirePermission('viewWorkspace'), async (_request, response) => {
    const [business, products, warehouses, openOrders, totals, recentOrders] =
      await db.$transaction(
        [
          db.business.findUniqueOrThrow({
            where: { id: businessId },
            select: { id: true, name: true, currency: true, timezone: true },
          }),
          db.product.count({ where: { businessId, archived: false } }),
          db.warehouse.findMany({
            where: { businessId, archived: false },
            orderBy: { priority: 'asc' },
            include: { balances: { select: { onHand: true, reserved: true } } },
          }),
          db.order.count({
            where: { businessId, orderStatus: { in: ['AWAITING_PAYMENT', 'CONFIRMED'] } },
          }),
          db.$queryRaw<
            { availableUnits: number; reservedUnits: number; lowStockLevels: number }[]
          >`SELECT COALESCE(SUM(b."onHand" - b.reserved), 0)::int AS "availableUnits", COALESCE(SUM(b.reserved), 0)::int AS "reservedUnits", COUNT(*) FILTER (WHERE b."onHand" - b.reserved <= b.threshold)::int AS "lowStockLevels" FROM inventory_balances b JOIN warehouses w ON w.id = b."warehouseId" WHERE w."businessId" = ${businessId} AND w.archived = false`,
          db.order.findMany({
            where: { businessId },
            include: orderInclude,
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
    const result: WorkspaceSummary = {
      business,
      metrics: { products, warehouses: warehouses.length, openOrders, ...totals[0] },
      warehouses: warehouses.map(({ id, name, city, code, balances }) => ({
        id,
        name,
        city,
        code,
        availableUnits: balances.reduce(
          (sum, balance) => sum + balance.onHand - balance.reserved,
          0,
        ),
        reservedUnits: balances.reduce((sum, balance) => sum + balance.reserved, 0),
      })),
      recentOrders: recentOrders.map(orderSummary),
    }
    response.json({ data: result })
  })

  app.get('/api/v1/orders', async (request, response) => {
    const profile = signedIn(request)
    const query = orderQuerySchema.parse(request.query)
    const where: Prisma.OrderWhereInput = {
      businessId,
      ...(profile.role === 'CUSTOMER' ? { customerId: profile.id } : {}),
      ...(query.status ? { orderStatus: query.status } : {}),
      ...(query.warehouse ? { warehouseId: query.warehouse } : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { customerName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const [rows, total] = await db.$transaction(
      [
        db.order.findMany({
          where,
          include: orderInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.order.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    response.json({
      data: rows.map(orderSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pages: Math.ceil(total / query.pageSize),
      },
    })
  })
  app.post(
    '/api/v1/checkout/quote',
    requirePermission('placeOrders'),
    async (request, response) => {
      const { items } = checkoutQuoteSchema.parse(request.body)
      response.json({ data: await quoteCheckout(db, businessId, items) })
    },
  )
  app.post('/api/v1/orders', requirePermission('placeOrders'), async (request, response) => {
    const input = checkoutSchema.parse(request.body)
    const order = await createReservedOrder(
      db,
      businessId,
      signedIn(request).id,
      request.requestId,
      input,
    )
    response.status(201).json({ data: orderDetail(order) })
  })
  app.post(
    '/api/v1/orders/:identifier/cancellations',
    requirePermission('cancelOrders'),
    async (request, response) => {
      const identifier = z.string().min(1).max(80).parse(request.params.identifier)
      const input = cancellationSchema.parse(request.body)
      const order = await cancelUnpaidOrder(
        db,
        businessId,
        signedIn(request).id,
        request.requestId,
        identifier,
        input,
      )
      response.json({ data: orderDetail(order) })
    },
  )
  app.get('/api/v1/orders/:identifier', async (request, response) => {
    const profile = signedIn(request)
    const identifier = z.string().max(80).parse(request.params.identifier)
    const isUuid = z.uuid().safeParse(identifier).success
    const order = await db.order.findFirst({
      where: {
        businessId,
        ...(isUuid ? { id: identifier } : { number: identifier }),
        ...(profile.role === 'CUSTOMER' ? { customerId: profile.id } : {}),
      },
      include: orderInclude,
    })
    if (!order) throw new DomainError('NOT_FOUND', 'This order could not be found.', 404)
    response.json({ data: orderDetail(order) })
  })

  app.get('/api/v1/team', requirePermission('manageTeam'), async (request, response) => {
    const { page, pageSize } = paginationSchema.parse(request.query)
    const where = { businessId }
    const [data, total] = await db.$transaction([
      db.userProfile.findMany({
        where,
        select: profileSelect,
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.userProfile.count({ where }),
    ])
    response.json({
      data,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    })
  })
  app.patch('/api/v1/team/:id', requirePermission('manageTeam'), async (request, response) => {
    const actor = signedIn(request)
    const id = z.uuid().parse(request.params.id)
    const { role } = roleChangeSchema.parse(request.body)
    if (id === actor.id)
      throw new DomainError('SELF_ROLE_CHANGE', 'Ask another admin to change your role.')
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR UPDATE`
      const currentActor = await tx.userProfile.findUnique({ where: { id: actor.id } })
      if (
        !currentActor?.active ||
        currentActor.role !== 'ADMIN' ||
        currentActor.businessId !== businessId
      )
        throw new DomainError('FORBIDDEN', 'Your account does not have permission to do that.', 403)
      const target = await tx.userProfile.findFirst({ where: { id, businessId } })
      if (!target) throw new DomainError('NOT_FOUND', 'This account could not be found.', 404)
      if (target.role === role)
        return tx.userProfile.findUniqueOrThrow({ where: { id }, select: profileSelect })
      if (
        target.role === 'ADMIN' &&
        role !== 'ADMIN' &&
        (await tx.userProfile.count({ where: { businessId, role: 'ADMIN', active: true } })) <= 1
      )
        throw new DomainError('LAST_ADMIN', 'The workspace must keep an active admin.')
      const updated = await tx.userProfile.update({
        where: { id },
        data: { role },
        select: profileSelect,
      })
      await tx.auditEvent.create({
        data: {
          businessId,
          actorId: actor.id,
          action: 'USER_ROLE_CHANGED',
          entityType: 'UserProfile',
          entityId: id,
          metadata: { from: target.role, to: role },
          requestId: request.requestId,
        },
      })
      return updated
    })
    response.json({ data: result })
  })

  app.use('/api/v1', fulfillmentRoutes(db, businessId, payments))
  app.use((request, response) =>
    sendError(request, response, 404, 'NOT_FOUND', 'This endpoint could not be found.'),
  )
  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    void _next // Express identifies error middleware by its four parameters.
    if (error instanceof DomainError)
      return sendError(request, response, error.status, error.code, error.message)
    if (error instanceof ZodError) {
      const fields: Record<string, string[]> = {}
      for (const issue of error.issues) {
        const key = issue.path.join('.') || 'request'
        ;(fields[key] ??= []).push(issue.message)
      }
      return sendError(
        request,
        response,
        400,
        'VALIDATION_ERROR',
        'Check the highlighted fields and try again.',
        fields,
      )
    }
    if (error instanceof SyntaxError && 'body' in error)
      return sendError(request, response, 400, 'INVALID_JSON', 'Send a valid JSON request body.')
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2002', 'P2003', 'P2004'].includes(error.code))
        return sendError(
          request,
          response,
          409,
          'DATA_CONFLICT',
          'This change conflicts with saved data.',
        )
      if (error.code === 'P2025')
        return sendError(request, response, 404, 'NOT_FOUND', 'This record could not be found.')
    }
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    if (status === 413)
      return sendError(request, response, 413, 'REQUEST_TOO_LARGE', 'The request is too large.')
    request.log.error(
      { requestId: request.requestId, kind: error instanceof Error ? error.name : 'UnknownError' },
      'Request failed',
    )
    sendError(request, response, 500, 'INTERNAL_ERROR', 'Something went wrong. Try again shortly.')
  })
  return app
}
