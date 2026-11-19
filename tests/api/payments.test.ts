import { beforeEach, afterAll, describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { randomUUID, createHmac } from 'node:crypto'
import { createServer, createConnection, type Socket } from 'node:net'
import { config } from 'dotenv'
import { createDatabase } from '@docklane/database'
import {
  createStripeProvider,
  createReservedOrder,
  quoteCheckout,
  expireOrder,
  sweepExpiredOrders,
  reconcilePayment,
  processOutboxEvent,
  receiveStripeEvent,
  compensatePayment,
  cancelUnpaidOrder,
  DomainError,
  ProviderError,
} from '@docklane/domain'
import { createApp } from '../../apps/api/src/app.js'
import { createWorkerRuntime } from '../../apps/worker/src/runtime.js'
import { seedDevelopment } from '../../scripts/seed-lib.js'
import { TestPaymentProvider } from './payment-provider.fixture.js'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Payment checks require the isolated local docklane_test database.')
const db = createDatabase(url),
  businessId = 'northstar-supply',
  signingSecret = 'whsec_phase5_synthetic_test'
const identities = [
  {
    authSubject: 'pay-admin',
    name: 'Ben Thomas',
    email: 'admin@pay.example.test',
    role: 'ADMIN' as const,
  },
  {
    authSubject: 'pay-operator',
    name: 'Priya Rao',
    email: 'operator@pay.example.test',
    role: 'OPERATOR' as const,
  },
  {
    authSubject: 'pay-customer',
    name: 'Aditi Menon',
    email: 'customer@pay.example.test',
    role: 'CUSTOMER' as const,
  },
  {
    authSubject: 'pay-other',
    name: 'Riya Nair',
    email: 'other@pay.example.test',
    role: 'CUSTOMER' as const,
  },
]
let provider: TestPaymentProvider
const verifyWebhook = createStripeProvider(
  'sk_test_phase5_synthetic_test',
  signingSecret,
).verifyWebhook
const app = () =>
  createApp({
    db,
    businessId,
    origins: [],
    logLevel: 'silent',
    verifyIdentity: async (subject) => {
      const p = await db.userProfile.findUnique({ where: { authSubject: subject } })
      if (!p) throw new DomainError('UNAUTHORIZED', 'Invalid test identity.', 401)
      return { subject, name: p.name, email: p.email }
    },
    payments: { provider, verifyWebhook, returnOrigin: 'http://127.0.0.1:5173' },
  })
const headers = (subject = 'pay-customer') => ({
  Authorization: `Bearer ${subject}`,
  'X-Docklane-Session': 'synthetic-session',
})
const owner = async () =>
  (await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'pay-customer' } })).id
async function reserve() {
  const items = [
      { sku: 'AUD-001', quantity: 2 },
      { sku: 'BOT-004', quantity: 1 },
    ],
    quote = await quoteCheckout(db, businessId, items)
  return createReservedOrder(db, businessId, await owner(), randomUUID(), {
    items,
    quoteFingerprint: quote.quoteFingerprint,
    deliveryAddress: { line: '12 Garden Lane', city: 'Kochi', postalCode: '682001', country: 'IN' },
    idempotencyKey: randomUUID(),
  })
}
const checkout = (id: string, subject?: string) =>
  supertest(app()).post(`/api/v1/orders/${id}/payment-sessions`).set(headers(subject)).send({})
async function elapsed(id: string) {
  await db.order.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  await db.stockReservation.updateMany({
    where: { orderId: id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  })
}
function signedEvent(
  objectId: string,
  type = 'checkout.session.completed',
  id = `evt_${randomUUID()}`,
  live = false,
) {
  const event = { id, type, livemode: live, data: { object: { id: objectId } } },
    body = JSON.stringify(event),
    time = Math.floor(Date.now() / 1000),
    digest = createHmac('sha256', signingSecret).update(`${time}.${body}`).digest('hex')
  return { event, body, signature: `t=${time},v1=${digest}` }
}
async function webhook(event: ReturnType<typeof signedEvent>) {
  return supertest(app())
    .post('/api/v1/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', event.signature)
    .send(event.body)
}
async function processReceipt(receiptId: string) {
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'STRIPE_WEBHOOK', payload: { path: ['receiptId'], equals: receiptId } },
  })
  return processOutboxEvent(db, businessId, event.id, provider)
}
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE public.businesses CASCADE')
  await db.$executeRawUnsafe('TRUNCATE TABLE public.outbox_events, public.webhook_receipts')
  await seedDevelopment(db, identities)
  provider = new TestPaymentProvider()
})
afterAll(async () => db.$disconnect())

describe('Phase 5 payments and background recovery on PostgreSQL', () => {
  it('starts one server-priced provider session for concurrent retries and preserves frozen parameters', async () => {
    const order = await reserve(),
      responses = await Promise.all([checkout(order.id), checkout(order.id), checkout(order.id)])
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
    expect(provider.creates.size).toBe(1)
    expect(new Set(responses.map((r) => r.body.data.sessionId)).size).toBe(1)
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(payment.amountPaise).toBe(order.totalPaise)
    const request = payment.providerRequest as {
      items: { unitPricePaise: number }[]
      expiresAt: number
    }
    expect(request.items[0].unitPricePaise).toBe(order.items[0].unitPricePaise)
    expect(request.expiresAt).toBe(Math.floor(order.expiresAt!.getTime() / 1000) + 31 * 60)
    expect(
      (
        await supertest(app())
          .post(`/api/v1/orders/${order.id}/payment-sessions`)
          .set(headers())
          .send({ totalPaise: 1 })
      ).status,
    ).toBe(400)
  })
  it('recovers a provider-created session after a lost response without creating another session', async () => {
    const order = await reserve()
    provider.failCreateAfterSave = true
    expect((await checkout(order.id)).status).toBe(503)
    expect(provider.creates.size).toBe(1)
    expect(
      (await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })).sessionId,
    ).toBeNull()
    expect((await checkout(order.id)).status).toBe(200)
    expect(provider.creates.size).toBe(1)
  })
  it('enforces customer ownership, role checks, test-mode keys, and saved-state redirects', async () => {
    const order = await reserve()
    expect((await checkout(order.id, 'pay-other')).status).toBe(404)
    expect((await checkout(order.id, 'pay-admin')).status).toBe(403)
    expect(() => createStripeProvider('sk_live_forbidden', signingSecret)).toThrow()
    const response = await supertest(app())
      .get(`/api/v1/orders/${order.id}?payment=return&paid=true`)
      .set(headers())
    expect(response.body.data.paymentStatus).toBe('PENDING')
    expect(response.body.data.orderStatus).toBe('AWAITING_PAYMENT')
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(0)
  })
  it('verifies raw-body signatures before authentication and atomically deduplicates durable receipts', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId
    provider.pay(session)
    const event = signedEvent(session),
      responses = await Promise.all([webhook(event), webhook(event), webhook(event)])
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
    expect(await db.webhookReceipt.count()).toBe(1)
    const receipt = await db.webhookReceipt.findFirstOrThrow()
    expect(receipt.payload).toEqual({ objectId: session })
    expect(receipt.processedAt).toBeNull()
    expect(await db.outboxEvent.count({ where: { type: 'STRIPE_WEBHOOK' } })).toBe(1)
    const altered = { ...event, body: event.body.replace('completed', 'expired') }
    expect((await webhook(altered)).status).toBe(400)
    expect((await webhook(signedEvent(session, undefined, undefined, true))).status).toBe(400)
    await processReceipt(receipt.id)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).orderStatus).toBe(
      'CONFIRMED',
    )
  })
  it('allocates reservations once and ignores out-of-order failures after successful payment', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    provider.pay(session)
    await Promise.all([
      reconcilePayment(db, businessId, payment.id, provider),
      reconcilePayment(db, businessId, payment.id, provider),
      expireOrder(db, businessId, order.id),
    ])
    const receipt = await receiveStripeEvent(
      db,
      businessId,
      signedEvent(session, 'checkout.session.async_payment_failed').event,
    )
    await processReceipt(receipt)
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(saved).toMatchObject({ orderStatus: 'CONFIRMED', paymentStatus: 'CAPTURED' })
    expect(saved.confirmedAt).not.toBeNull()
    expect(
      await db.stockReservation.count({ where: { orderId: order.id, status: 'ALLOCATED' } }),
    ).toBe(2)
    expect(
      await db.auditEvent.count({ where: { entityId: order.id, action: 'PAYMENT_CONFIRMED' } }),
    ).toBe(1)
    expect(
      await db.inventoryMovement.count({ where: { orderId: order.id, type: 'RELEASE' } }),
    ).toBe(0)
  })
  it('rejects mismatched amounts, currency, owner association, live mode, and captured totals', async () => {
    const order = await reserve(),
      sessionId = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } }),
      original = await provider.session(sessionId)
    for (const override of [
      { total: 1 },
      { currency: 'usd' },
      { live: true },
      { orderId: randomUUID() },
      { businessId: 'wrong' },
      { paymentId: randomUUID() },
    ]) {
      provider.sessions.set(sessionId, { ...original, ...override })
      await expect(reconcilePayment(db, businessId, payment.id, provider)).rejects.toMatchObject({
        code: 'PAYMENT_ASSOCIATION_INVALID',
      })
    }
    provider.sessions.set(sessionId, original)
    provider.pay(sessionId)
    provider.intents.get(`pi_test_${sessionId}`)!.received = 1
    await expect(reconcilePayment(db, businessId, payment.id, provider)).rejects.toMatchObject({
      code: 'PAYMENT_ASSOCIATION_INVALID',
    })
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'PENDING',
    )
  })
  it('releases a multi-item expired hold once under concurrent sweeps and leaves physical stock intact', async () => {
    const order = await reserve(),
      before = await db.inventoryBalance.findMany({
        where: { reservations: { some: { orderId: order.id } } },
      })
    await elapsed(order.id)
    await Promise.all([
      expireOrder(db, businessId, order.id),
      sweepExpiredOrders(db, businessId),
      expireOrder(db, businessId, order.id),
    ])
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(saved.orderStatus).toBe('EXPIRED')
    expect(saved.expiredAt).not.toBeNull()
    expect(
      await db.stockReservation.count({ where: { orderId: order.id, status: 'RELEASED' } }),
    ).toBe(2)
    expect(
      await db.inventoryMovement.count({ where: { orderId: order.id, type: 'RELEASE' } }),
    ).toBe(2)
    for (const balance of before)
      expect(
        (await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })).onHand,
      ).toBe(balance.onHand)
    expect((await checkout(order.id)).status).toBe(409)
    expect(provider.creates.size).toBe(0)
  })
  it('serializes late payment, expiry, and cancellation and creates one compensation refund', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    provider.pay(session)
    await elapsed(order.id)
    await Promise.allSettled([
      expireOrder(db, businessId, order.id),
      reconcilePayment(db, businessId, payment.id, provider),
      reconcilePayment(db, businessId, payment.id, provider),
      cancelUnpaidOrder(db, businessId, await owner(), randomUUID(), order.id, {
        reason: 'Race cancellation',
        idempotencyKey: randomUUID(),
      }),
    ])
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(['EXPIRED', 'CANCELLED']).toContain(saved.orderStatus)
    expect(saved.paymentStatus).toBe('REFUND_PENDING')
    expect(await db.refundAttempt.count({ where: { paymentId: payment.id } })).toBe(1)
    expect(
      await db.inventoryMovement.count({ where: { orderId: order.id, type: 'RELEASE' } }),
    ).toBe(2)
    const refund = await db.refundAttempt.findFirstOrThrow({ where: { paymentId: payment.id } })
    await Promise.all([
      compensatePayment(db, businessId, refund.id, provider),
      compensatePayment(db, businessId, refund.id, provider),
    ])
    expect(provider.refundKeys.size).toBe(1)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'REFUNDED',
    )
    await reconcilePayment(db, businessId, payment.id, provider)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'REFUNDED',
    )
  })
  it('recovers an ambiguous refund response with its original key and keeps stock released', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    provider.pay(session)
    await elapsed(order.id)
    await reconcilePayment(db, businessId, payment.id, provider)
    const refund = await db.refundAttempt.findFirstOrThrow({ where: { paymentId: payment.id } })
    provider.failRefundAfterSave = true
    await expect(compensatePayment(db, businessId, refund.id, provider)).rejects.toThrow()
    expect(provider.refundKeys.size).toBe(1)
    expect(await compensatePayment(db, businessId, refund.id, provider)).toBe(true)
    expect(provider.refundKeys.size).toBe(1)
    expect(
      await db.stockReservation.count({ where: { orderId: order.id, status: 'RELEASED' } }),
    ).toBe(2)
  })
  it('keeps old ambiguous refund work visible rather than reusing a potentially pruned key', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    provider.pay(session)
    await elapsed(order.id)
    await reconcilePayment(db, businessId, payment.id, provider)
    const refund = await db.refundAttempt.findFirstOrThrow({ where: { paymentId: payment.id } })
    await db.refundAttempt.update({
      where: { id: refund.id },
      data: { createdAt: new Date(Date.now() - 24 * 3600_000) },
    })
    await expect(compensatePayment(db, businessId, refund.id, provider)).rejects.toMatchObject({
      code: 'REFUND_RECONCILIATION_REQUIRED',
    })
    expect(provider.refundKeys.size).toBe(0)
  })
  it('recovers stale worker leases and restricts failed-job retries to audited admin actions', async () => {
    const order = await reserve()
    await elapsed(order.id)
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'ORDER_RESERVATION_EXPIRY', payload: { path: ['orderId'], equals: order.id } },
    })
    await db.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSING',
        lockedAt: new Date(Date.now() - 100_000),
        leaseToken: randomUUID(),
      },
    })
    await Promise.all([
      processOutboxEvent(db, businessId, event.id, provider),
      processOutboxEvent(db, businessId, event.id, provider),
    ])
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'COMPLETED',
    )
    const failed = await db.outboxEvent.create({
      data: {
        businessId,
        type: 'UNKNOWN',
        payload: {},
        status: 'FAILED',
        lastErrorCode: 'UNKNOWN_JOB',
      },
    })
    const retry = (subject: string) =>
      supertest(app())
        .post(`/api/v1/operations/jobs/${failed.id}/retries`)
        .set(headers(subject))
        .send({ reason: 'Provider reviewed' })
    expect((await retry('pay-customer')).status).toBe(403)
    expect((await retry('pay-operator')).status).toBe(403)
    expect((await retry('pay-admin')).status).toBe(200)
    expect((await retry('pay-admin')).status).toBe(200)
    expect(
      await db.auditEvent.count({ where: { entityId: failed.id, action: 'JOB_RETRY_REQUESTED' } }),
    ).toBe(1)
    expect((await supertest(app()).get('/api/v1/operations/jobs').set(headers())).status).toBe(403)
  })
  it('releases holds with Redis unavailable and resumes work after a worker restart', async () => {
    const order = await reserve()
    await elapsed(order.id)
    const runtime = createWorkerRuntime(db, {
      businessId,
      queueNamespace: 'docklane_test',
      redisUrl: 'redis://127.0.0.1:56380',
      intervalMs: 1000,
    })
    try {
      await expect
        .poll(
          async () => (await db.order.findUniqueOrThrow({ where: { id: order.id } })).orderStatus,
          { timeout: 10_000 },
        )
        .toBe('EXPIRED')
    } finally {
      await runtime.close()
    }
    const second = await reserve()
    await elapsed(second.id)
    const resumed = createWorkerRuntime(db, {
      businessId,
      queueNamespace: 'docklane_test',
      redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:56379',
      intervalMs: 1000,
    })
    try {
      await expect
        .poll(
          async () => (await db.order.findUniqueOrThrow({ where: { id: second.id } })).orderStatus,
          { timeout: 10_000 },
        )
        .toBe('EXPIRED')
    } finally {
      await resumed.close()
    }
  })
  it.each(['completion', 'failure'] as const)(
    'keeps a replacement lease authoritative after a delayed old worker %s',
    async (outcome) => {
      const order = await reserve()
      const session = (await checkout(order.id)).body.data.sessionId
      const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
      const event = await db.outboxEvent.findFirstOrThrow({
        where: { type: 'STRIPE_RECONCILE', payload: { path: ['paymentId'], equals: payment.id } },
      })
      await db.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date() } })
      let release!: () => void,
        started!: () => void,
        held = false
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const entered = new Promise<void>((resolve) => {
        started = resolve
      })
      const original = provider.session.bind(provider)
      provider.session = async (id) => {
        const snapshot = await original(id)
        if (!held) {
          held = true
          started()
          await gate
          if (outcome === 'failure') throw new ProviderError('CONNECTION_LOST')
        }
        return snapshot
      }
      const oldWork = processOutboxEvent(db, businessId, event.id, provider).catch(
        (error: unknown) => error,
      )
      try {
        await entered
        const oldLease = (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }))
          .leaseToken
        await db.outboxEvent.update({
          where: { id: event.id },
          data: { lockedAt: new Date(Date.now() - 100_000) },
        })
        provider.pay(session)
        expect(await processOutboxEvent(db, businessId, event.id, provider)).toBe(true)
        const completed = await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })
        expect(completed).toMatchObject({
          status: 'COMPLETED',
          attempts: 2,
          leaseToken: null,
          lastErrorCode: null,
        })
        expect(oldLease).not.toBeNull()
        release()
        const result = await oldWork
        if (outcome === 'failure') expect(result).toBeInstanceOf(ProviderError)
        expect(await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(
          completed,
        )
        expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
          'CAPTURED',
        )
        expect(
          await db.auditEvent.count({ where: { entityId: order.id, action: 'PAYMENT_CONFIRMED' } }),
        ).toBe(1)
      } finally {
        release()
        await oldWork
        provider.session = original
      }
    },
  )
  it('continues late-payment refunds during a queue disconnect and reconnects the same worker without duplicate movements', async () => {
    const redis = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:56379')
    if (redis.protocol !== 'redis:' || !['localhost', '127.0.0.1'].includes(redis.hostname))
      throw new Error('Queue recovery checks require loopback Redis.')
    let online = true,
      accepted = 0
    const sockets = new Set<Socket>(),
      codes: string[] = []
    const proxy = createServer((client) => {
      if (!online) {
        client.destroy()
        return
      }
      accepted++
      const upstream = createConnection({ host: redis.hostname, port: Number(redis.port || 6379) })
      for (const socket of [client, upstream]) {
        sockets.add(socket)
        socket.on('error', () => {
          client.destroy()
          upstream.destroy()
        })
        socket.on('close', () => {
          sockets.delete(socket)
          client.destroy()
          upstream.destroy()
        })
      }
      client.pipe(upstream)
      upstream.pipe(client)
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const address = proxy.address()
    if (!address || typeof address === 'string')
      throw new Error('Private Redis proxy did not start.')
    redis.hostname = '127.0.0.1'
    redis.port = String(address.port)
    const first = await reserve(),
      firstSession = (await checkout(first.id)).body.data.sessionId
    provider.pay(firstSession)
    await receiveStripeEvent(db, businessId, signedEvent(firstSession).event)
    const runtime = createWorkerRuntime(db, {
      businessId,
      queueNamespace: `phase8-${randomUUID()}`,
      redisUrl: redis.toString(),
      provider,
      intervalMs: 200,
      onError: (code) => codes.push(code),
    })
    try {
      await expect
        .poll(
          async () => (await db.order.findUniqueOrThrow({ where: { id: first.id } })).paymentStatus,
          { timeout: 10_000 },
        )
        .toBe('CAPTURED')
      online = false
      for (const socket of sockets) socket.destroy()
      const late = await reserve(),
        lateSession = (await checkout(late.id)).body.data.sessionId
      provider.pay(lateSession)
      await elapsed(late.id)
      await receiveStripeEvent(db, businessId, signedEvent(lateSession).event)
      await expect
        .poll(
          async () => (await db.order.findUniqueOrThrow({ where: { id: late.id } })).paymentStatus,
          { timeout: 15_000 },
        )
        .toBe('REFUNDED')
      expect(codes).toContain('QUEUE_UNAVAILABLE')
      expect(provider.refundKeys.size).toBe(1)
      expect(
        await db.inventoryMovement.count({ where: { orderId: late.id, type: 'RELEASE' } }),
      ).toBe(2)
      const connectionsBefore = accepted
      online = true
      const recovered = await reserve(),
        recoveredSession = (await checkout(recovered.id)).body.data.sessionId
      provider.pay(recoveredSession)
      await receiveStripeEvent(db, businessId, signedEvent(recoveredSession).event)
      await expect
        .poll(
          async () =>
            (await db.order.findUniqueOrThrow({ where: { id: recovered.id } })).paymentStatus,
          { timeout: 10_000 },
        )
        .toBe('CAPTURED')
      expect(accepted).toBeGreaterThan(connectionsBefore)
      expect(
        await db.auditEvent.count({
          where: { entityId: recovered.id, action: 'PAYMENT_CONFIRMED' },
        }),
      ).toBe(1)
      const mismatches = await db.$queryRaw<
        { id: string }[]
      >`SELECT b.id FROM inventory_balances b LEFT JOIN inventory_movements m ON m."balanceId"=b.id GROUP BY b.id HAVING b."onHand"<>COALESCE(SUM(m."deltaOnHand"),0) OR b.reserved<>COALESCE(SUM(m."deltaReserved"),0)`
      expect(mismatches).toEqual([])
    } finally {
      await runtime.close()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => proxy.close(() => resolve()))
    }
  }, 40_000)
  it('rolls back allocation and confirmation together when the audit insert fails', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    provider.pay(session)
    await db.$executeRawUnsafe(
      "CREATE FUNCTION fail_phase5_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PAYMENT_CONFIRMED' THEN RAISE EXCEPTION 'Injected payment audit failure'; END IF; RETURN NEW; END; $$",
    )
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_phase5_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_phase5_audit()',
    )
    try {
      await expect(reconcilePayment(db, businessId, payment.id, provider)).rejects.toThrow()
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).orderStatus).toBe(
        'AWAITING_PAYMENT',
      )
      expect(
        await db.stockReservation.count({ where: { orderId: order.id, status: 'HELD' } }),
      ).toBe(2)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_phase5_audit ON audit_events')
      await db.$executeRawUnsafe('DROP FUNCTION fail_phase5_audit()')
    }
    await reconcilePayment(db, businessId, payment.id, provider)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).orderStatus).toBe(
      'CONFIRMED',
    )
  })
  it('resumes the same checkout after a failed card payment and confirms its eventual success', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    provider.fail(session)
    await reconcilePayment(db, businessId, payment.id, provider)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'FAILED',
    )
    expect((await checkout(order.id)).status).toBe(200)
    expect(provider.creates.size).toBe(1)
    provider.pay(session)
    await reconcilePayment(db, businessId, payment.id, provider)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'CAPTURED',
    )
  })
  it('closes an expired provider session without recursively creating close jobs', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    await provider.expireSession(session)
    await reconcilePayment(db, businessId, payment.id, provider)
    const before = await db.outboxEvent.count({ where: { type: 'STRIPE_SESSION_CLOSE' } }),
      event = await db.outboxEvent.findFirstOrThrow({ where: { type: 'STRIPE_SESSION_CLOSE' } })
    await processOutboxEvent(db, businessId, event.id, provider)
    expect(await db.outboxEvent.count({ where: { type: 'STRIPE_SESSION_CLOSE' } })).toBe(before)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).orderStatus).toBe(
      'EXPIRED',
    )
  })
  it('persists pending and failed refund results for recovery without marking the order refunded', async () => {
    const order = await reserve(),
      session = (await checkout(order.id)).body.data.sessionId,
      payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })
    provider.pay(session)
    await elapsed(order.id)
    await reconcilePayment(db, businessId, payment.id, provider)
    const attempt = await db.refundAttempt.findFirstOrThrow({ where: { paymentId: payment.id } }),
      create = provider.refund.bind(provider)
    provider.refund = async (...args) => {
      const r = await create(...args)
      r.status = 'pending'
      provider.refunds.set(r.id, r)
      return r
    }
    expect(await compensatePayment(db, businessId, attempt.id, provider)).toBe(false)
    const saved = await db.refundAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    expect(saved.status).toBe('PROCESSING')
    expect(saved.providerReference).not.toBeNull()
    provider.refunds.get(saved.providerReference!)!.status = 'failed'
    const event = await db.outboxEvent.findFirstOrThrow({ where: { type: 'STRIPE_COMPENSATION' } })
    await expect(processOutboxEvent(db, businessId, event.id, provider)).rejects.toMatchObject({
      code: 'REFUND_FAILED',
    })
    expect((await db.refundAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe(
      'FAILED',
    )
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'FAILED',
    )
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'REFUND_PENDING',
    )
  })
  it('uses bounded database backoff and retains exhausted provider work for review', async () => {
    const order = await reserve()
    await checkout(order.id)
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } }),
      event = await db.outboxEvent.findFirstOrThrow({ where: { type: 'STRIPE_RECONCILE' } })
    await db.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date(0) } })
    provider.session = async () => {
      throw new ProviderError('PROVIDER_TIMEOUT')
    }
    await expect(processOutboxEvent(db, businessId, event.id, provider)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    })
    const saved = await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(saved.status).toBe('PENDING')
    expect(saved.attempts).toBe(1)
    expect(saved.availableAt.getTime()).toBeGreaterThan(Date.now())
    expect(await processOutboxEvent(db, businessId, event.id, provider)).toBe(false)
    await db.outboxEvent.update({
      where: { id: event.id },
      data: { availableAt: new Date(0), attempts: 7 },
    })
    await expect(processOutboxEvent(db, businessId, event.id, provider)).rejects.toThrow()
    expect(await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
      status: 'FAILED',
      attempts: 8,
      lastErrorCode: 'PROVIDER_TIMEOUT',
    })
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).providerIdempotencyKey,
    ).toBe(payment.providerIdempotencyKey)
  })
  it('continues the expiry sweep after one failed audit and preserves that hold for a safe retry', async () => {
    const first = await reserve(),
      second = await reserve()
    await elapsed(first.id)
    await elapsed(second.id)
    await db.$executeRawUnsafe(
      "CREATE FUNCTION fail_expiry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'ORDER_EXPIRED' AND NEW.\"entityId\" = '" +
        first.id +
        "' THEN RAISE EXCEPTION 'Injected expiry failure'; END IF; RETURN NEW; END; $$",
    )
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_expiry_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_expiry_audit()',
    )
    try {
      await expect(sweepExpiredOrders(db, businessId)).rejects.toMatchObject({
        code: 'EXPIRY_REVIEW_REQUIRED',
      })
      expect((await db.order.findUniqueOrThrow({ where: { id: first.id } })).orderStatus).toBe(
        'AWAITING_PAYMENT',
      )
      expect((await db.order.findUniqueOrThrow({ where: { id: second.id } })).orderStatus).toBe(
        'EXPIRED',
      )
      expect(
        await db.inventoryMovement.count({ where: { orderId: first.id, type: 'RELEASE' } }),
      ).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_expiry_audit ON audit_events')
      await db.$executeRawUnsafe('DROP FUNCTION fail_expiry_audit()')
    }
    expect(await expireOrder(db, businessId, first.id)).toBe(true)
  })
})
