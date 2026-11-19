import type {
  Role,
  OrderStatus,
  PaymentStatus,
  FulfillmentStatus,
  ReservationStatus,
} from '@docklane/contracts'
export * from './stock.js'
export * from './orders.js'
export * from './payments.js'
export * from './payment-provider.js'
export * from './stripe.js'
export * from './fulfillment.js'
export * from './refunds.js'

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
export const permissions = {
  viewWorkspace: ['ADMIN', 'OPERATOR'],
  viewAllOrders: ['ADMIN', 'OPERATOR'],
  manageTeam: ['ADMIN'],
  adjustStock: ['ADMIN', 'OPERATOR'],
  manageCatalog: ['ADMIN'],
  manageWarehouses: ['ADMIN'],
  fulfillOrders: ['ADMIN', 'OPERATOR'],
  issueRefunds: ['ADMIN'],
  placeOrders: ['CUSTOMER'],
  cancelOrders: ['ADMIN', 'OPERATOR', 'CUSTOMER'],
  viewJobs: ['ADMIN', 'OPERATOR'],
  manageJobs: ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>
export function permits(role: Role, permission: keyof typeof permissions) {
  return (permissions[permission] as readonly Role[]).includes(role)
}

export interface Lifecycle {
  order: OrderStatus
  payment: PaymentStatus
  fulfillment: FulfillmentStatus
  reservation: ReservationStatus
}
export type LifecycleEvent =
  | 'PAYMENT_CAPTURED'
  | 'PAYMENT_FAILED'
  | 'EXPIRE'
  | 'PACK'
  | 'SHIP'
  | 'CANCEL'
  | 'REQUEST_REFUND'
  | 'PARTIAL_REFUND_SUCCEEDED'
  | 'FULL_REFUND_SUCCEEDED'
  | 'RETURN_RECEIVED'

export function transition(state: Lifecycle, event: LifecycleEvent): Lifecycle {
  const invalid = () => {
    throw new DomainError('INVALID_TRANSITION', `Cannot apply ${event} to the current order state.`)
  }
  switch (event) {
    case 'PAYMENT_CAPTURED':
      if (
        state.order !== 'AWAITING_PAYMENT' ||
        state.reservation !== 'HELD' ||
        !['PENDING', 'FAILED'].includes(state.payment)
      )
        return invalid()
      return { ...state, order: 'CONFIRMED', payment: 'CAPTURED', reservation: 'ALLOCATED' }
    case 'PAYMENT_FAILED':
      if (state.order !== 'AWAITING_PAYMENT' || state.reservation !== 'HELD') return invalid()
      return { ...state, payment: 'FAILED' }
    case 'EXPIRE':
      if (state.order !== 'AWAITING_PAYMENT' || state.reservation !== 'HELD') return invalid()
      return { ...state, order: 'EXPIRED', reservation: 'RELEASED' }
    case 'PACK':
      if (
        state.order !== 'CONFIRMED' ||
        !['CAPTURED', 'PARTIALLY_REFUNDED'].includes(state.payment) ||
        state.fulfillment !== 'UNFULFILLED' ||
        state.reservation !== 'ALLOCATED'
      )
        return invalid()
      return { ...state, fulfillment: 'PACKED' }
    case 'SHIP':
      if (
        state.order !== 'CONFIRMED' ||
        !['CAPTURED', 'PARTIALLY_REFUNDED'].includes(state.payment) ||
        state.fulfillment !== 'PACKED' ||
        state.reservation !== 'ALLOCATED'
      )
        return invalid()
      return { ...state, order: 'COMPLETED', fulfillment: 'SHIPPED', reservation: 'CONSUMED' }
    case 'CANCEL':
      if (
        !['AWAITING_PAYMENT', 'CONFIRMED'].includes(state.order) ||
        state.fulfillment === 'SHIPPED' ||
        !['HELD', 'ALLOCATED'].includes(state.reservation)
      )
        return invalid()
      return {
        ...state,
        order: 'CANCELLED',
        fulfillment: 'UNFULFILLED',
        reservation: 'RELEASED',
        payment: ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(state.payment)
          ? 'REFUND_PENDING'
          : state.payment,
      }
    case 'REQUEST_REFUND':
      if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(state.payment)) return invalid()
      return { ...state, payment: 'REFUND_PENDING' }
    case 'PARTIAL_REFUND_SUCCEEDED':
    case 'FULL_REFUND_SUCCEEDED':
      if (state.payment !== 'REFUND_PENDING') return invalid()
      return {
        ...state,
        payment: event === 'FULL_REFUND_SUCCEEDED' ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      }
    case 'RETURN_RECEIVED':
      if (state.fulfillment !== 'SHIPPED' || state.reservation !== 'CONSUMED') return invalid()
      return { ...state }
  }
}

export function assertInventory(onHand: number, reserved: number) {
  if (
    !Number.isSafeInteger(onHand) ||
    !Number.isSafeInteger(reserved) ||
    onHand < 0 ||
    reserved < 0 ||
    reserved > onHand
  )
    throw new DomainError(
      'INVALID_INVENTORY',
      'Stock must be whole, nonnegative quantities, with reserved units no greater than on-hand units.',
    )
  return { onHand, reserved, available: onHand - reserved }
}
