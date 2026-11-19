import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { CreditCard } from '@phosphor-icons/react/dist/csr/CreditCard'
import { Clock } from '@phosphor-icons/react/dist/csr/Clock'
import type { OrderDetail } from '@docklane/contracts'
import { useIdentity, useProfile } from '@/lib/identity-context'
import { timestamp } from '@/lib/inventory-client'
import { Button } from '@/components/ui/button'

export function OrderPayment({ order }: { order: OrderDetail }) {
  const { api } = useIdentity(),
    cache = useQueryClient(),
    profile = useProfile().data!.data
  const [params] = useSearchParams(),
    reduced = useReducedMotion()
  const [retried, setRetried] = useState(false)
  const config = useQuery({
    queryKey: ['connected', 'payments-config'],
    queryFn: () =>
      api<{ data: { enabled: boolean; testMode: boolean } }>('/payments/configuration'),
  })
  const payment = useMutation({
    mutationFn: () =>
      api<{ data: { url: string } }>(`/orders/${order.id}/payment-sessions`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (result) => {
      const url = new URL(result.data.url)
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com')
        throw new Error('The checkout address could not be verified.')
      window.location.assign(url.href)
    },
    onError: async () => {
      setRetried(true)
      await cache.invalidateQueries({ queryKey: ['connected', 'order'] })
    },
  })
  const captured = ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus),
    refunding = order.paymentStatus === 'REFUND_PENDING',
    refunded = order.paymentStatus === 'REFUNDED',
    expired = order.orderStatus === 'EXPIRED',
    cancelled = order.orderStatus === 'CANCELLED'
  const heading = refunded
    ? 'Your test payment, returned.'
    : refunding
      ? 'Your refund is on its way.'
      : captured
        ? order.fulfillmentStatus === 'SHIPPED'
          ? 'Payment confirmed. Your order has shipped.'
          : 'Payment confirmed. Next stop, fulfillment.'
        : expired
          ? 'This hold has reached its stop.'
          : cancelled
            ? 'Order closed. Stock released.'
            : order.paymentStatus === 'FAILED'
              ? 'Let’s give payment another go.'
              : 'One last step. Make it yours.'
  const note = refunded
    ? 'The full test payment has been refunded. Shipment and return records remain in your order history.'
    : refunding
      ? order.payment?.refundStatus === 'RECONCILIATION_REQUIRED' ||
        order.payment?.refundStatus === 'FAILED'
        ? 'Your refund needs a provider review. Its saved amount and progress appear in the payment ledger below.'
        : 'Your test refund is being processed. Its amount and progress appear in the payment ledger below.'
      : captured
        ? order.fulfillmentStatus === 'SHIPPED'
          ? 'Payment is confirmed and this order is marked shipped.'
          : order.orderStatus === 'CANCELLED'
            ? 'This order is cancelled. Its items have been released.'
            : 'Your items are allocated to this order. Follow the fulfillment journey below.'
        : expired
          ? 'The reservation has expired and held items are available again. Browse the collection to place a fresh order.'
          : cancelled
            ? 'This unpaid order was cancelled. A payment that arrives later will be returned automatically.'
            : order.paymentStatus === 'FAILED'
              ? 'The payment wasn’t completed. You can return to the same checkout while the stock hold is active.'
              : 'Your items are held while you complete Stripe test checkout. The stock deadline below still applies.'
  const canPay =
    profile.role === 'CUSTOMER' &&
    order.orderStatus === 'AWAITING_PAYMENT' &&
    ['PENDING', 'FAILED'].includes(order.paymentStatus) &&
    order.reservations.some((r) => r.status === 'HELD') &&
    (!order.payment || order.payment.provider === 'stripe_test')
  return (
    <motion.section
      className={`p5-payment-panel ${captured || refunded ? 'is-complete' : ''}`}
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      aria-label="Payment and reservation"
    >
      <div className="p5-payment-story">
        <span className="auth-eyebrow">
          {order.payment && order.payment.provider !== 'stripe_test'
            ? 'DEVELOPMENT PAYMENT EXAMPLE'
            : 'STRIPE TEST MODE · NO REAL CHARGE'}
        </span>
        <h2>{heading}</h2>
        <p>{note}</p>
        {params.get('payment') === 'return' &&
          !captured &&
          !refunding &&
          !refunded &&
          !expired &&
          !cancelled && (
            <p className="p5-payment-return" role="status">
              You’re back. Checking the final payment result…
            </p>
          )}
        {params.get('payment') === 'cancelled' && canPay && (
          <p className="p5-payment-return">
            You left checkout. Your stock hold is still active until its deadline.
          </p>
        )}
        <ol className="p5-payment-lane" aria-label="Payment progress">
          <li className="done">
            <CheckCircle size={18} />
            Reserved
          </li>
          <li className={captured || refunding || refunded ? 'done' : ''}>
            <CreditCard size={18} />
            Test payment
          </li>
          <li className={captured || refunded ? 'done' : ''}>
            <CheckCircle size={18} />
            {refunding || refunded ? 'Refund' : 'Confirmation'}
          </li>
        </ol>
      </div>
      <div className="p5-payment-action">
        <span className="p5-payment-total-label">Order total</span>
        <strong className="p5-payment-total">
          {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
            order.totalPaise / 100,
          )}
        </strong>
        {canPay && (
          <>
            <p className="p5-payment-deadline">
              <Clock size={16} />
              {order.expiresAt
                ? `Stock held until ${timestamp(order.expiresAt)}`
                : 'Stock held for payment'}
            </p>
            <Button
              className="btn-primary"
              disabled={!config.data?.data.enabled || payment.isPending}
              onClick={() => payment.mutate()}
            >
              {payment.isPending
                ? 'Opening test checkout…'
                : retried || order.payment?.sessionStarted
                  ? 'Resume test checkout'
                  : 'Continue to test payment'}
              <ArrowUpRight size={18} />
            </Button>
            {config.isError ? (
              <p className="p4-error" role="alert">
                Checkout availability could not be loaded.{' '}
                <button
                  className="text-link"
                  onClick={() => {
                    void config.refetch()
                  }}
                >
                  Try again
                </button>
              </p>
            ) : config.data && !config.data.data.enabled ? (
              <p className="p5-payment-config">
                Stripe test checkout is awaiting configuration. Your hold will expire automatically
                at its deadline.
              </p>
            ) : (
              <p className="p5-payment-config">
                Use Stripe test card details. No real money moves.
              </p>
            )}
          </>
        )}
        {(expired || cancelled || refunded) && (
          <Link
            to={profile.role === 'CUSTOMER' ? '/account/catalog' : '/workspace/orders'}
            className="btn-secondary connected-link-button"
          >
            {profile.role === 'CUSTOMER' ? 'Back to collection' : 'Back to orders'}{' '}
            <ArrowUpRight size={18} />
          </Link>
        )}
        {payment.isError && (
          <p className="p4-error" role="alert">
            {payment.error.message}
          </p>
        )}
        <button
          className="text-link p5-refresh"
          onClick={() => {
            void cache.invalidateQueries({ queryKey: ['connected', 'order'] })
          }}
        >
          Refresh saved result
        </button>
      </div>
    </motion.section>
  )
}
