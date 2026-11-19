import { describe, it, expect } from 'vitest'
import { transition, permits, assertInventory, type Lifecycle } from '@docklane/domain'

const held: Lifecycle = {
  order: 'AWAITING_PAYMENT',
  payment: 'PENDING',
  fulfillment: 'UNFULFILLED',
  reservation: 'HELD',
}
describe('order lifecycle boundaries', () => {
  it('allocates a paid reservation, packs it, and consumes it only on shipment', () => {
    const confirmed = transition(held, 'PAYMENT_CAPTURED')
    expect(confirmed).toMatchObject({
      order: 'CONFIRMED',
      reservation: 'ALLOCATED',
      fulfillment: 'UNFULFILLED',
    })
    const packed = transition(confirmed, 'PACK')
    expect(packed.reservation).toBe('ALLOCATED')
    expect(transition(packed, 'SHIP')).toEqual({
      order: 'COMPLETED',
      payment: 'CAPTURED',
      fulfillment: 'SHIPPED',
      reservation: 'CONSUMED',
    })
  })
  it('refuses to pack or ship unpaid, cancelled, expired, or already shipped orders', () => {
    for (const state of [
      held,
      transition(held, 'CANCEL'),
      transition(held, 'EXPIRE'),
      transition(transition(transition(held, 'PAYMENT_CAPTURED'), 'PACK'), 'SHIP'),
    ]) {
      expect(() => transition(state, 'PACK')).toThrow(/current order state/)
      expect(() => transition(state, 'SHIP')).toThrow(/current order state/)
    }
  })
  it('keeps failed payments held until expiry and never revives expired reservations', () => {
    const failed = transition(held, 'PAYMENT_FAILED')
    expect(failed.reservation).toBe('HELD')
    const expired = transition(failed, 'EXPIRE')
    expect(expired.reservation).toBe('RELEASED')
    expect(() => transition(expired, 'PAYMENT_CAPTURED')).toThrow()
    expect(() => transition(expired, 'EXPIRE')).toThrow()
  })
  it('cancellation releases allocated units and leaves captured money awaiting compensation', () => {
    const cancelled = transition(transition(held, 'PAYMENT_CAPTURED'), 'CANCEL')
    expect(cancelled).toMatchObject({
      order: 'CANCELLED',
      reservation: 'RELEASED',
      payment: 'REFUND_PENDING',
    })
    expect(transition(cancelled, 'FULL_REFUND_SUCCEEDED').payment).toBe('REFUNDED')
  })
  it('refunds and return receipts never restore consumed reservations', () => {
    const shipped = transition(transition(transition(held, 'PAYMENT_CAPTURED'), 'PACK'), 'SHIP')
    const refunded = transition(transition(shipped, 'REQUEST_REFUND'), 'FULL_REFUND_SUCCEEDED')
    expect(refunded.reservation).toBe('CONSUMED')
    expect(refunded.fulfillment).toBe('SHIPPED')
    expect(transition(refunded, 'RETURN_RECEIVED')).toEqual(refunded)
  })
  it('allows fulfillment after a completed partial refund and pauses pending or full refunds', () => {
    const confirmed = transition(held, 'PAYMENT_CAPTURED')
    const pending = transition(confirmed, 'REQUEST_REFUND')
    expect(() => transition(pending, 'PACK')).toThrow()
    const partial = transition(pending, 'PARTIAL_REFUND_SUCCEEDED')
    expect(transition(transition(partial, 'PACK'), 'SHIP').reservation).toBe('CONSUMED')
    expect(transition(partial, 'CANCEL').payment).toBe('REFUND_PENDING')
    expect(() => transition(transition(pending, 'FULL_REFUND_SUCCEEDED'), 'PACK')).toThrow()
  })
})
describe('inventory and permission rules', () => {
  it('accepts the exact boundary and rejects fractional, negative, or over-reserved quantities', () => {
    expect(assertInventory(10, 10).available).toBe(0)
    for (const [onHand, reserved] of [
      [10, 11],
      [-1, 0],
      [1, -1],
      [1.5, 0],
      [1, NaN],
    ])
      expect(() => assertInventory(onHand, reserved)).toThrow()
  })
  it('keeps refunds and team management Admin-only while Operators can use staff views', () => {
    expect(permits('ADMIN', 'issueRefunds')).toBe(true)
    expect(permits('OPERATOR', 'issueRefunds')).toBe(false)
    expect(permits('OPERATOR', 'manageTeam')).toBe(false)
    expect(permits('OPERATOR', 'viewWorkspace')).toBe(true)
    expect(permits('CUSTOMER', 'viewAllOrders')).toBe(false)
  })
})
