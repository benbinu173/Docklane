import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { OrderDetail, CancellationInput } from '@docklane/contracts'
import { useIdentity } from '@/lib/identity-context'
import { ApiError } from '@/lib/auth-client'
import { timestamp } from '@/lib/inventory-client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

export function OrderReservation({ order }: { order: OrderDetail }) {
  const { api } = useIdentity(),
    cache = useQueryClient()
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [attempt, setAttempt] = useState<CancellationInput | null>(null)
  const cancel = useMutation({
    mutationFn: (input: CancellationInput) =>
      api<{ data: OrderDetail }>(`/orders/${order.id}/cancellations`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: async () => {
      setOpen(false)
      setAttempt(null)
      toast.success(
        'Order cancelled. Stock is available again; any remaining payment is queued for refund.',
      )
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['connected'] }),
        cache.invalidateQueries({ queryKey: ['phase3'] }),
        cache.invalidateQueries({ queryKey: ['checkout'] }),
      ])
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) setAttempt(null)
    },
  })
  const held = order.reservations.filter((reservation) => reservation.status === 'HELD'),
    canCancel =
      ['AWAITING_PAYMENT', 'CONFIRMED'].includes(order.orderStatus) &&
      (order.orderStatus === 'AWAITING_PAYMENT' || order.payment?.provider === 'stripe_test') &&
      order.fulfillmentStatus !== 'SHIPPED' &&
      order.reservations.some((reservation) => ['HELD', 'ALLOCATED'].includes(reservation.status))
  return (
    <section className="p4-reservation-panel">
      <span className="auth-eyebrow">THE STOCK JOURNEY</span>
      <h2>Every item, accounted for.</h2>
      <ol className="p4-journey">
        <li>
          <strong>Order placed</strong>
          <span>{timestamp(order.createdAt)}</span>
        </li>
        {held.length > 0 && (
          <li>
            <strong>
              {held.reduce((sum, reservation) => sum + reservation.quantity, 0)} units held
            </strong>
            <span>
              {order.expiresAt
                ? `Hold deadline · ${timestamp(order.expiresAt)}`
                : 'Awaiting payment'}
            </span>
          </li>
        )}
        {order.cancelledAt && (
          <li>
            <strong>Cancelled · stock released</strong>
            <span>{timestamp(order.cancelledAt)}</span>
            <span>{order.cancelReason}</span>
          </li>
        )}
        {order.confirmedAt && (
          <li>
            <strong>Payment confirmed · stock allocated</strong>
            <span>{timestamp(order.confirmedAt)}</span>
          </li>
        )}
        {order.expiredAt && (
          <li>
            <strong>Reservation expired · stock released</strong>
            <span>{timestamp(order.expiredAt)}</span>
          </li>
        )}
        {!held.length &&
          !order.cancelledAt &&
          !order.expiredAt &&
          (!order.confirmedAt || order.fulfillmentStatus === 'SHIPPED') && (
            <li>
              <strong>
                {order.fulfillmentStatus === 'SHIPPED'
                  ? 'Stock shipped'
                  : order.orderStatus === 'EXPIRED'
                    ? 'Hold released'
                    : 'Reservation recorded'}
              </strong>
              <span>
                {order.reservations
                  .map((reservation) => reservation.status.toLowerCase())
                  .filter((status, index, all) => all.indexOf(status) === index)
                  .join(' · ')}
              </span>
            </li>
          )}
      </ol>
      {canCancel && (
        <>
          <p>
            Cancel before shipment to release stock. Any remaining captured test payment is queued
            for refund automatically.
          </p>
          <Button
            className="btn-secondary"
            onClick={() => {
              cancel.reset()
              setOpen(true)
            }}
          >
            {order.orderStatus === 'AWAITING_PAYMENT'
              ? 'Cancel unpaid order'
              : 'Cancel unshipped order'}
          </Button>
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!cancel.isPending) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {order.number}?</DialogTitle>
            <DialogDescription>
              Every held or allocated item will return to available stock. Any remaining captured
              test payment will be queued for refund.
            </DialogDescription>
          </DialogHeader>
          <label className="p4-cancel-label" htmlFor="cancel-reason">
            Reason for cancellation
            <textarea
              id="cancel-reason"
              rows={3}
              maxLength={500}
              value={reason}
              disabled={!!attempt}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {cancel.isError && (
            <p className="p4-error" role="alert">
              {cancel.error.message}
              {attempt ? ' Retry the same cancellation to confirm the result.' : ''}
            </p>
          )}
          <Button
            className="btn-primary"
            disabled={cancel.isPending || (!attempt && reason.trim().length < 3)}
            onClick={() => {
              const input = attempt ?? {
                reason: reason.trim(),
                idempotencyKey: crypto.randomUUID(),
              }
              setAttempt(input)
              cancel.mutate(input)
            }}
          >
            {cancel.isPending
              ? 'Releasing held stock…'
              : attempt
                ? 'Retry same cancellation'
                : 'Confirm cancellation'}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  )
}
