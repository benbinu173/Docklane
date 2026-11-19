import Stripe from 'stripe'
import {
  ProviderError,
  type PaymentProvider,
  type ProviderSession,
  type ProviderIntent,
  type ProviderRefund,
} from './payment-provider.js'

export function createStripeProvider(secretKey: string, webhookSecret: string) {
  if (!secretKey.startsWith('sk_test_') || !webhookSecret.startsWith('whsec_'))
    throw new Error('Configure Stripe test-mode and webhook keys. Live mode is disabled.')
  const stripe = new Stripe(secretKey, { timeout: 10_000, maxNetworkRetries: 1 })
  const id = (value: string | { id: string } | null) =>
    typeof value === 'string' ? value : (value?.id ?? null)
  const session = (s: Stripe.Checkout.Session): ProviderSession => ({
    id: s.id,
    live: s.livemode,
    paymentId: s.metadata?.docklanePaymentId ?? null,
    orderId: s.client_reference_id,
    businessId: s.metadata?.docklaneBusinessId ?? null,
    total: s.amount_total,
    currency: s.currency,
    status: s.status,
    paymentStatus: s.payment_status,
    intentId: id(s.payment_intent),
    url: s.url,
    expiresAt: s.expires_at,
  })
  const intent = (p: Stripe.PaymentIntent): ProviderIntent => ({
    id: p.id,
    live: p.livemode,
    paymentId: p.metadata.docklanePaymentId ?? null,
    orderId: p.metadata.docklaneOrderId ?? null,
    businessId: p.metadata.docklaneBusinessId ?? null,
    amount: p.amount,
    received: p.amount_received,
    currency: p.currency,
    status: p.status,
  })
  const refund = (r: Stripe.Refund): ProviderRefund => ({
    id: r.id,
    live: false,
    intentId: id(r.payment_intent),
    amount: r.amount,
    currency: r.currency,
    status: r.status,
  })
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw new ProviderError(
        e instanceof Stripe.errors.StripeError ? e.type : 'PROVIDER_UNAVAILABLE',
      )
    }
  }
  const provider: PaymentProvider = {
    createSession: (input, key) =>
      call(async () =>
        session(
          await stripe.checkout.sessions.create(
            {
              mode: 'payment',
              allowed_payment_method_types: ['card'],
              adaptive_pricing: { enabled: false },
              client_reference_id: input.orderId,
              customer_email: input.customerEmail,
              metadata: {
                docklanePaymentId: input.paymentId,
                docklaneBusinessId: input.businessId,
              },
              payment_intent_data: {
                metadata: {
                  docklanePaymentId: input.paymentId,
                  docklaneOrderId: input.orderId,
                  docklaneBusinessId: input.businessId,
                },
                shipping: {
                  name: input.customerName,
                  address: {
                    line1: input.address.line,
                    city: input.address.city,
                    postal_code: input.address.postalCode,
                    country: input.address.country,
                  },
                },
              },
              line_items: input.items.map((item) => ({
                price_data: {
                  currency: 'inr',
                  unit_amount: item.unitPricePaise,
                  product_data: { name: item.name },
                },
                quantity: item.quantity,
              })),
              success_url: `${input.returnOrigin}/account/orders/${input.orderNumber}?payment=return`,
              cancel_url: `${input.returnOrigin}/account/orders/${input.orderNumber}?payment=cancelled`,
              expires_at: input.expiresAt,
            },
            { idempotencyKey: key },
          ),
        ),
      ),
    session: (value) => call(async () => session(await stripe.checkout.sessions.retrieve(value))),
    findSession: (paymentId, createdAt) =>
      call(async () => {
        let scanned = 0
        for await (const s of stripe.checkout.sessions.list({
          limit: 100,
          created: {
            gte: Math.floor(createdAt.getTime() / 1000) - 5,
            lte: Math.floor(createdAt.getTime() / 1000) + 32 * 60,
          },
        })) {
          if (s.metadata?.docklanePaymentId === paymentId) return session(s)
          if (++scanned >= 5000) throw new ProviderError('RECONCILIATION_LIMIT')
        }
        return null
      }),
    intent: (value) => call(async () => intent(await stripe.paymentIntents.retrieve(value))),
    expireSession: (value, key) =>
      call(async () => {
        const s = await stripe.checkout.sessions.retrieve(value)
        if (s.status === 'open')
          await stripe.checkout.sessions.expire(value, {}, { idempotencyKey: key })
      }),
    refund: (value, amount, key) =>
      call(async () =>
        refund(
          await stripe.refunds.create(
            {
              payment_intent: value,
              amount,
              reason: 'requested_by_customer',
              metadata: { docklaneOperation: key },
            },
            { idempotencyKey: key },
          ),
        ),
      ),
    refundStatus: (value) => call(async () => refund(await stripe.refunds.retrieve(value))),
    findRefund: (value, key) =>
      call(async () => {
        let scanned = 0
        for await (const r of stripe.refunds.list({ payment_intent: value, limit: 100 })) {
          if (r.metadata?.docklaneOperation === key) return refund(r)
          if (++scanned >= 5000) throw new ProviderError('RECONCILIATION_LIMIT')
        }
        return null
      }),
  }
  return {
    provider,
    verifyWebhook(raw: Buffer, signature: string) {
      try {
        return stripe.webhooks.constructEvent(raw, signature, webhookSecret)
      } catch {
        throw new ProviderError('INVALID_WEBHOOK_SIGNATURE')
      }
    },
  }
}
