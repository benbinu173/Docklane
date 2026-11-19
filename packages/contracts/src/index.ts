import { z } from 'zod'
import { paginationSchema } from './pagination.js'
import { dateFilters, orderQueues, validDateRange } from './operations.js'
export { paginationSchema } from './pagination.js'
export * from './inventory.js'
export * from './checkout.js'
export * from './fulfillment.js'
export * from './operations.js'

export const roles = ['ADMIN', 'OPERATOR', 'CUSTOMER'] as const
export const roleSchema = z.enum(roles)
export type Role = z.infer<typeof roleSchema>
export const orderStatuses = [
  'AWAITING_PAYMENT',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const
export const paymentStatuses = [
  'PENDING',
  'CAPTURED',
  'FAILED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const
export const fulfillmentStatuses = ['UNFULFILLED', 'PACKED', 'SHIPPED'] as const
export const reservationStatuses = ['HELD', 'ALLOCATED', 'CONSUMED', 'RELEASED'] as const
export type OrderStatus = (typeof orderStatuses)[number]
export type PaymentStatus = (typeof paymentStatuses)[number]
export type FulfillmentStatus = (typeof fulfillmentStatuses)[number]
export type ReservationStatus = (typeof reservationStatuses)[number]

export const orderQuerySchema = paginationSchema
  .extend({
    q: z.string().trim().max(100).default(''),
    status: z.enum(orderStatuses).optional(),
    warehouse: z.string().trim().max(80).optional(),
    payment: z.enum(paymentStatuses).optional(),
    fulfillment: z.enum(fulfillmentStatuses).optional(),
    queue: z.enum(orderQueues).optional(),
    ...dateFilters,
  })
  .refine(validDateRange, { message: 'The end date must be on or after the start date.' })
export const roleChangeSchema = z.strictObject({ role: roleSchema })
export const signInSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
})
export const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(2).max(80),
  password: z.string().min(12, 'Use at least 12 characters.').max(128),
})

export interface Profile {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
  businessId: string
}
export interface OrderSummary {
  id: string
  number: string
  customerName: string
  orderStatus: OrderStatus
  paymentStatus: PaymentStatus
  fulfillmentStatus: FulfillmentStatus
  totalPaise: number
  currency: 'INR'
  createdAt: string
  warehouse: { id: string; name: string; city: string }
  items: {
    sku: string
    name: string
    quantity: number
    unitPricePaise: number
    totalPaise: number
    image: string
  }[]
}
export interface OrderDetail extends OrderSummary {
  deliveryAddress: { line: string; city: string; postalCode: string; country: string }
  subtotalPaise: number
  shippingPaise: number
  expiresAt: string | null
  cancelledAt: string | null
  confirmedAt: string | null
  expiredAt: string | null
  cancelReason: string | null
  packedAt: string | null
  shipment: {
    id: string
    carrier: string
    trackingReference: string
    trackingUrl: string | null
    shippedAt: string
    actor: string
    reason: string
  } | null
  returns: {
    id: string
    reason: string
    receivedAt: string
    actor: string
    items: { id: string; sku: string; quantity: number; restockedQuantity: number }[]
  }[]
  refunds: {
    id: string
    amountPaise: number
    reason: string
    status: string
    purpose: string
    actor: string
    createdAt: string
    resolvedAt: string | null
  }[]
  refundTotals: {
    capturedPaise: number
    refundedPaise: number
    pendingPaise: number
    availablePaise: number
  }
  reservations: { sku: string; quantity: number; status: ReservationStatus; expiresAt: string }[]
  payment: { provider: string; sessionStarted: boolean; refundStatus: string | null } | null
}
export type WorkspaceSummary = import('./operations.js').OperationsOverview
export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; fields?: Record<string, string[]> }
}
export interface Paginated<T> {
  data: T[]
  pagination: { page: number; pageSize: number; total: number; pages: number }
}
