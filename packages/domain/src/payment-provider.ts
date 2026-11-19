export interface CheckoutSessionRequest {
  paymentId: string
  orderId: string
  businessId: string
  orderNumber: string
  customerEmail: string
  customerName: string
  address: { line: string; city: string; postalCode: string; country: string }
  returnOrigin: string
  expiresAt: number
  items: { name: string; quantity: number; unitPricePaise: number }[]
}
export interface ProviderSession {
  id: string
  live: boolean
  paymentId: string | null
  orderId: string | null
  businessId: string | null
  total: number | null
  currency: string | null
  status: string | null
  paymentStatus: string
  intentId: string | null
  url: string | null
  expiresAt: number
}
export interface ProviderIntent {
  id: string
  live: boolean
  paymentId: string | null
  orderId: string | null
  businessId: string | null
  amount: number
  received: number
  currency: string
  status: string
}
export interface ProviderRefund {
  id: string
  live: boolean
  intentId: string | null
  amount: number
  currency: string
  status: string | null
}
export interface PaymentProvider {
  createSession(input: CheckoutSessionRequest, key: string): Promise<ProviderSession>
  session(id: string): Promise<ProviderSession>
  findSession(paymentId: string, createdAt: Date): Promise<ProviderSession | null>
  intent(id: string): Promise<ProviderIntent>
  expireSession(id: string, key: string): Promise<void>
  refund(intentId: string, amount: number, key: string): Promise<ProviderRefund>
  refundStatus(id: string): Promise<ProviderRefund>
  findRefund(intentId: string, key: string): Promise<ProviderRefund | null>
}
export class ProviderError extends Error {
  constructor(public readonly code: string) {
    super('The payment provider is temporarily unavailable.')
    this.name = 'ProviderError'
  }
}
