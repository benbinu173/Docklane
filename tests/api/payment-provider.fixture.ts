import type {
  CheckoutSessionRequest,
  PaymentProvider,
  ProviderSession,
  ProviderIntent,
  ProviderRefund,
} from '@docklane/domain'
import { ProviderError } from '@docklane/domain'

export class TestPaymentProvider implements PaymentProvider {
  constructor(private readonly namespace = '') {}
  sessions = new Map<string, ProviderSession>()
  intents = new Map<string, ProviderIntent>()
  refunds = new Map<string, ProviderRefund>()
  creates = new Map<string, string>()
  refundKeys = new Map<string, string>()
  failCreateAfterSave = false
  failRefundAfterSave = false
  async createSession(input: CheckoutSessionRequest, key: string) {
    const prior = this.creates.get(key)
    if (prior) return this.session(prior)
    const id = `cs_test_${this.namespace}${this.creates.size + 1}`
    const session: ProviderSession = {
      id,
      live: false,
      paymentId: input.paymentId,
      orderId: input.orderId,
      businessId: input.businessId,
      total: input.items.reduce((sum, item) => sum + item.quantity * item.unitPricePaise, 0),
      currency: 'inr',
      status: 'open',
      paymentStatus: 'unpaid',
      intentId: null,
      url: `https://checkout.stripe.com/c/pay/${id}`,
      expiresAt: input.expiresAt,
    }
    this.creates.set(key, id)
    this.sessions.set(id, session)
    if (this.failCreateAfterSave) {
      this.failCreateAfterSave = false
      throw new ProviderError('CONNECTION_LOST')
    }
    return { ...session }
  }
  async session(id: string) {
    const s = this.sessions.get(id)
    if (!s) throw new ProviderError('NOT_FOUND')
    return { ...s }
  }
  async findSession(paymentId: string) {
    const s = [...this.sessions.values()].find((s) => s.paymentId === paymentId)
    return s ? { ...s } : null
  }
  async intent(id: string) {
    const p = this.intents.get(id)
    if (!p) throw new ProviderError('NOT_FOUND')
    return { ...p }
  }
  async expireSession(id: string) {
    const s = this.sessions.get(id)
    if (s?.status === 'open') {
      s.status = 'expired'
      s.url = null
    }
  }
  async refund(intentId: string, amount: number, key: string) {
    const prior = this.refundKeys.get(key)
    if (prior) return this.refundStatus(prior)
    const id = `re_test_${this.namespace}${this.refunds.size + 1}`,
      result = { id, live: false, intentId, amount, currency: 'inr', status: 'succeeded' }
    this.refundKeys.set(key, id)
    this.refunds.set(id, result)
    if (this.failRefundAfterSave) {
      this.failRefundAfterSave = false
      throw new ProviderError('CONNECTION_LOST')
    }
    return { ...result }
  }
  async refundStatus(id: string) {
    const r = this.refunds.get(id)
    if (!r) throw new ProviderError('NOT_FOUND')
    return { ...r }
  }
  async findRefund(_intentId: string, key: string) {
    const id = this.refundKeys.get(key)
    return id ? this.refundStatus(id) : null
  }
  pay(sessionId: string) {
    const s = this.sessions.get(sessionId)!,
      id = `pi_test_${sessionId}`
    s.intentId = id
    s.paymentStatus = 'paid'
    s.status = 'complete'
    s.url = null
    this.intents.set(id, {
      id,
      live: false,
      paymentId: s.paymentId,
      orderId: s.orderId,
      businessId: s.businessId,
      amount: s.total!,
      received: s.total!,
      currency: s.currency!,
      status: 'succeeded',
    })
  }
  fail(sessionId: string) {
    const s = this.sessions.get(sessionId)!,
      id = `pi_test_${sessionId}`
    s.intentId = id
    this.intents.set(id, {
      id,
      live: false,
      paymentId: s.paymentId,
      orderId: s.orderId,
      businessId: s.businessId,
      amount: s.total!,
      received: 0,
      currency: s.currency!,
      status: 'requires_payment_method',
    })
  }
}
