import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { createLocalJWKSet, type JWK } from 'jose'
import { createDatabase, createAuthSessionStore } from '@docklane/database'
import { reconcilePayment, processOutboxEvent } from '@docklane/domain'
import { createApp } from '../../apps/api/src/app.js'
import { createIdentityVerifier } from '../../apps/api/src/identity.js'
import { TestPaymentProvider } from '../api/payment-provider.fixture.js'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  !['postgres:', 'postgresql:'].includes(new URL(url).protocol) ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Browser API requires loopback docklane_test.')
const db = createDatabase(url),
  store = createAuthSessionStore(url),
  provider = new TestPaymentProvider(`${randomUUID()}-`)
let server: Server,
  businessId = ''
type Message = {
  requestId: string
  action: 'start' | 'capture' | 'refund' | 'stop'
  businessId?: string
  issuer?: string
  jwk?: JWK
  orderId?: string
  refundId?: string
}
process.on('message', async (message: Message) => {
  try {
    let result: unknown = true
    if (message.action === 'start') {
      if (!message.businessId?.startsWith('browser-') || !message.issuer || !message.jwk || server)
        throw new Error('Invalid fixture configuration.')
      businessId = message.businessId
      server = createApp({
        db,
        businessId,
        origins: ['http://127.0.0.1:4173', 'http://127.0.0.1:5173', 'http://localhost:5173'],
        logLevel: 'silent',
        verifyIdentity: createIdentityVerifier(
          store,
          message.issuer,
          createLocalJWKSet({ keys: [message.jwk] }),
        ),
        payments: {
          provider,
          returnOrigin: 'http://127.0.0.1:5173',
          verifyWebhook: () => {
            throw new Error('No unsigned test webhook transport.')
          },
        },
      }).listen(0, '127.0.0.1')
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve)
        server.once('error', reject)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('API port unavailable.')
      result = address.port
    } else if (message.action === 'capture') {
      const payment = await db.payment.findFirstOrThrow({
        where: { orderId: message.orderId, order: { businessId } },
      })
      if (!payment.sessionId) throw new Error('Test checkout is not available.')
      provider.pay(payment.sessionId)
      await reconcilePayment(db, businessId, payment.id, provider)
    } else if (message.action === 'refund') {
      const event = await db.outboxEvent.findFirstOrThrow({
        where: {
          businessId,
          type: 'STRIPE_COMPENSATION',
          payload: { path: ['refundId'], equals: message.refundId },
        },
      })
      await processOutboxEvent(db, businessId, event.id, provider)
    } else if (message.action === 'stop') {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
      await Promise.all([db.$disconnect(), store.close()])
    } else throw new Error('Unknown browser fixture command.')
    process.send?.({ requestId: message.requestId, result })
    if (message.action === 'stop') process.disconnect()
  } catch {
    process.send?.({
      requestId: message.requestId,
      error: 'The isolated browser API command failed.',
    })
  }
})
