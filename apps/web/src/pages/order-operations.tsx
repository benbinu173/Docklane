import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { Package } from '@phosphor-icons/react/dist/csr/Package'
import { Truck } from '@phosphor-icons/react/dist/csr/Truck'
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowUUpLeft } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft'
import { toast } from 'sonner'
import type { OrderDetail, OrderTimelineEvent, Paginated } from '@docklane/contracts'
import { useIdentity, useProfile } from '@/lib/identity-context'
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

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100)
const labels: Record<string, string> = {
  ORDER_RESERVED: 'Order reserved',
  ORDER_CANCELLED: 'Order cancelled',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  ORDER_EXPIRED: 'Stock hold expired',
  ORDER_PACKED: 'Items checked and packed',
  ORDER_SHIPPED: 'Shipment recorded',
  RETURN_RECEIVED: 'Return received',
  RETURN_RESTOCKED: 'Returned items restocked',
  REFUND_REQUESTED: 'Test refund requested',
  REFUND_SUCCEEDED: 'Test refund completed',
  REFUND_FAILED: 'Refund needs review',
  REFUND_RECONCILIATION_REQUIRED: 'Refund awaiting reconciliation',
  REFUND_RECONCILIATION_REQUESTED: 'Refund reconciliation requested',
  LATE_PAYMENT_REFUND_REQUESTED: 'Late payment refund requested',
  LATE_PAYMENT_REFUNDED: 'Late payment refunded',
}
type Action = {
  kind: 'pack' | 'ship' | 'receive' | 'refund' | 'restock' | 'reconcile'
  id?: string
  max?: number
  sku?: string
}
const actionTitles = {
  pack: 'Mark items packed',
  ship: 'Record shipment',
  receive: 'Receive a return',
  refund: 'Request a test refund',
  restock: 'Restock received items',
  reconcile: 'Reconcile this refund',
}
const descriptions = {
  pack: 'Check every item and quantity before moving this order to packed.',
  ship: 'Record the handoff to your carrier. Shipped units leave this warehouse’s stock.',
  receive:
    'Record only items physically received. You can restock eligible items after inspection.',
  refund:
    'Choose an amount within the remaining captured payment. Refunds are processed in Stripe test mode.',
  restock: 'Confirm these received items are ready to sell. They return to the original warehouse.',
  reconcile:
    'Check the existing provider attempt again. Docklane preserves the same refund operation.',
}

export function OrderOperations({ order }: { order: OrderDetail }) {
  const { api } = useIdentity(),
    profile = useProfile().data!.data,
    cache = useQueryClient(),
    reduced = useReducedMotion()
  const [action, setAction] = useState<Action | null>(null),
    [attempt, setAttempt] = useState<{
      path: string
      body: Record<string, unknown>
      action: Action
    } | null>(null)
  const staff = profile.role !== 'CUSTOMER',
    admin = profile.role === 'ADMIN'
  const totals = order.refundTotals,
    receipts = order.returns
  const eligible =
    order.orderStatus === 'CONFIRMED' &&
    ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus) &&
    order.reservations.every((r) => r.status === 'ALLOCATED')
  const remaining = order.items
    .map((item) => ({
      ...item,
      available:
        item.quantity -
        receipts
          .flatMap((r) => r.items)
          .filter((r) => r.sku === item.sku)
          .reduce((sum, r) => sum + r.quantity, 0),
    }))
    .filter((item) => item.available > 0)
  const mutation = useMutation({
    mutationFn: (input: { path: string; body: Record<string, unknown> }) =>
      api<{ data: OrderDetail }>(input.path, { method: 'POST', body: input.body }),
    onSuccess: async () => {
      toast.success(
        action?.kind === 'refund' || action?.kind === 'reconcile'
          ? 'Refund work saved. We’ll refresh its progress here.'
          : 'Order updated. Every item is accounted for.',
      )
      setAttempt(null)
      setAction(null)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['connected'] }),
        cache.invalidateQueries({ queryKey: ['phase3'] }),
        cache.invalidateQueries({ queryKey: ['checkout'] }),
      ])
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status < 500) setAttempt(null)
      await cache.invalidateQueries({ queryKey: ['connected', 'order'] })
    },
  })
  function open(value: Action) {
    if (attempt) {
      setAction(attempt.action)
      return
    }
    mutation.reset()
    setAction(value)
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (attempt) {
      mutation.mutate(attempt)
      return
    }
    if (!action) return
    const form = new FormData(event.currentTarget),
      body: Record<string, unknown> = {
        reason: String(form.get('reason')).trim(),
        idempotencyKey: crypto.randomUUID(),
      }
    let suffix: string =
      action.kind === 'pack'
        ? 'packing'
        : action.kind === 'ship'
          ? 'shipments'
          : action.kind === 'receive'
            ? 'returns'
            : 'refunds'
    if (action.kind === 'ship')
      Object.assign(body, {
        carrier: form.get('carrier'),
        trackingReference: form.get('trackingReference'),
        trackingUrl: String(form.get('trackingUrl') ?? '').trim() || null,
      })
    if (action.kind === 'refund') body.amountPaise = Math.round(Number(form.get('amount')) * 100)
    if (action.kind === 'receive')
      body.items = remaining
        .map((item) => ({ sku: item.sku, quantity: Number(form.get(item.sku)) }))
        .filter((item) => item.quantity > 0)
    if (action.kind === 'restock') {
      suffix = `returns/${action.id}/restocks`
      body.quantity = Number(form.get('quantity'))
    }
    if (action.kind === 'reconcile') suffix = `refunds/${action.id}/reconciliation`
    const input = { path: `/orders/${order.id}/${suffix}`, body, action }
    setAttempt(input)
    mutation.mutate(input)
  }
  return (
    <>
      <motion.section
        className="panel p6-fulfillment"
        aria-label="Fulfillment journey"
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="p6-section-head">
          <div>
            <span className="auth-eyebrow">FROM SHELF TO DOORSTEP</span>
            <h2>A smooth handoff.</h2>
            <p>
              {order.fulfillmentStatus === 'SHIPPED'
                ? 'Your shipment is recorded. The next stop is its destination.'
                : order.orderStatus === 'CANCELLED' || order.orderStatus === 'EXPIRED'
                  ? 'This order is closed. Its stock has been released.'
                  : 'Check the contents. Pack with care. Send it on its way.'}
            </p>
          </div>
          <Truck size={32} weight="duotone" />
        </div>
        <ol className="p6-lane" aria-label="Fulfillment progress">
          {[
            {
              label: 'Confirmed',
              done: !!order.confirmedAt,
              icon: CheckCircle,
              time: order.confirmedAt,
            },
            { label: 'Packed', done: !!order.packedAt, icon: Package, time: order.packedAt },
            {
              label: 'Shipped',
              done: !!order.shipment,
              icon: Truck,
              time: order.shipment?.shippedAt,
            },
          ].map((step, index) => (
            <li key={step.label} className={step.done ? 'done' : ''}>
              <span className="p6-step-number">0{index + 1}</span>
              <step.icon size={23} weight={step.done ? 'fill' : 'regular'} />
              <strong>{step.label}</strong>
              <span>{step.time ? timestamp(step.time) : 'Awaiting this step'}</span>
            </li>
          ))}
        </ol>
        {order.shipment && (
          <div className="p6-tracking">
            <div>
              <span>Carrier & tracking</span>
              <strong>
                {order.shipment.carrier} · {order.shipment.trackingReference}
              </strong>
              <small>Recorded by {order.shipment.actor}</small>
            </div>
            {order.shipment.trackingUrl && (
              <a
                className="btn-secondary connected-link-button"
                href={order.shipment.trackingUrl}
                target="_blank"
                rel="noreferrer"
              >
                Track shipment <ArrowUpRight size={18} />
              </a>
            )}
          </div>
        )}
        {staff && eligible && (
          <div className="p6-actions">
            <Button
              className="btn-primary"
              onClick={() => open({ kind: order.fulfillmentStatus === 'PACKED' ? 'ship' : 'pack' })}
            >
              {order.fulfillmentStatus === 'PACKED' ? 'Record shipment' : 'Mark items packed'}{' '}
              <ArrowUpRight size={18} />
            </Button>
            <span>
              {order.fulfillmentStatus === 'PACKED'
                ? 'Ready for a carrier handoff.'
                : `${order.items.reduce((sum, i) => sum + i.quantity, 0)} allocated units to check.`}
            </span>
          </div>
        )}
        {staff && order.orderStatus === 'CONFIRMED' && order.paymentStatus === 'REFUND_PENDING' && (
          <p className="p6-note">Fulfillment is paused while the refund is pending.</p>
        )}
      </motion.section>
      <div className="p6-finance-returns">
        <section className="panel p6-refunds" aria-label="Refunds">
          <div className="p6-section-head">
            <div>
              <span className="auth-eyebrow">THE PAYMENT LEDGER</span>
              <h2>Clear down to the last rupee.</h2>
            </div>
            <ArrowUUpLeft size={26} />
          </div>
          <dl className="p6-money">
            <div>
              <dt>Captured</dt>
              <dd>{money(totals.capturedPaise)}</dd>
            </div>
            <div>
              <dt>Returned</dt>
              <dd>{money(totals.refundedPaise)}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{money(totals.pendingPaise)}</dd>
            </div>
          </dl>
          {order.refunds.length > 0 ? (
            <ul className="p6-records">
              {order.refunds.map((refund) => (
                <li key={refund.id}>
                  <div className="p6-record-top">
                    <strong>{money(refund.amountPaise)}</strong>
                    <span className={`p6-chip ${refund.status === 'SUCCEEDED' ? 'done' : ''}`}>
                      {refund.status.replaceAll('_', ' ').toLowerCase()}
                    </span>
                  </div>
                  <p>{refund.reason}</p>
                  <small>
                    {refund.actor} · {timestamp(refund.createdAt)}
                  </small>
                  {admin && ['RECONCILIATION_REQUIRED', 'PROCESSING'].includes(refund.status) && (
                    <Button
                      className="text-link"
                      onClick={() => open({ kind: 'reconcile', id: refund.id })}
                    >
                      Reconcile refund
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p6-empty">No refunds recorded. Every payment change will appear here.</p>
          )}
          {admin && order.payment?.provider === 'stripe_test' && totals.availablePaise > 0 && (
            <div className="p6-actions">
              <Button
                className="btn-secondary"
                onClick={() => open({ kind: 'refund', max: totals.availablePaise })}
              >
                Request test refund
              </Button>
              <span>{money(totals.availablePaise)} remaining</span>
            </div>
          )}
        </section>
        <section className="panel p6-returns" aria-label="Returns">
          <div className="p6-section-head">
            <div>
              <span className="auth-eyebrow">BACK IN GOOD HANDS</span>
              <h2>A thoughtful return.</h2>
              <p>Receive first. Inspect next. Restock when ready.</p>
            </div>
            <Package size={28} weight="duotone" />
          </div>
          {receipts.length ? (
            <ul className="p6-records">
              {receipts.map((receipt) => (
                <li key={receipt.id}>
                  <strong>Return received</strong>
                  <p>{receipt.reason}</p>
                  <small>
                    {receipt.actor} · {timestamp(receipt.receivedAt)}
                  </small>
                  {receipt.items.map((item) => (
                    <div className="p6-return-line" key={item.id}>
                      <div>
                        <strong>
                          {order.items.find((i) => i.sku === item.sku)?.name ?? item.sku}
                        </strong>
                        <span>
                          {item.quantity} received · {item.restockedQuantity} restocked
                        </span>
                      </div>
                      {staff && item.quantity > item.restockedQuantity && (
                        <Button
                          className="btn-secondary"
                          onClick={() =>
                            open({
                              kind: 'restock',
                              id: item.id,
                              max: item.quantity - item.restockedQuantity,
                              sku: item.sku,
                            })
                          }
                        >
                          Restock
                        </Button>
                      )}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p6-empty">
              {order.shipment
                ? 'No items returned. Received items will appear here for inspection.'
                : 'Returns become available after shipment.'}
            </p>
          )}
          {staff && order.shipment && remaining.length > 0 && (
            <Button className="btn-secondary" onClick={() => open({ kind: 'receive' })}>
              Receive return
            </Button>
          )}
        </section>
      </div>
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !mutation.isPending) setAction(null)
        }}
      >
        <DialogContent className="p6-dialog">
          <DialogHeader>
            <DialogTitle>{action ? actionTitles[action.kind] : ''}</DialogTitle>
            <DialogDescription>{action ? descriptions[action.kind] : ''}</DialogDescription>
          </DialogHeader>
          {action && (
            <form className="p6-form" onSubmit={submit}>
              <fieldset disabled={!!attempt || mutation.isPending}>
                {action.kind === 'ship' && (
                  <>
                    <label>
                      Carrier
                      <input
                        name="carrier"
                        defaultValue={String(attempt?.body.carrier ?? '')}
                        required
                        minLength={2}
                        maxLength={100}
                        autoComplete="off"
                        placeholder="e.g. Blue Dart"
                      />
                    </label>
                    <label>
                      Tracking reference
                      <input
                        name="trackingReference"
                        defaultValue={String(attempt?.body.trackingReference ?? '')}
                        required
                        minLength={2}
                        maxLength={150}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Tracking URL <span>(optional)</span>
                      <input
                        name="trackingUrl"
                        defaultValue={String(attempt?.body.trackingUrl ?? '')}
                        type="url"
                        maxLength={1000}
                        placeholder="https://"
                      />
                    </label>
                  </>
                )}
                {action.kind === 'refund' && (
                  <label>
                    Refund amount (₹)
                    <input
                      name="amount"
                      type="number"
                      required
                      min="0.01"
                      max={(action.max ?? 0) / 100}
                      step="0.01"
                      defaultValue={Number(attempt?.body.amountPaise ?? action.max ?? 0) / 100}
                    />
                    <span>Available to refund: {money(action.max ?? 0)}</span>
                  </label>
                )}
                {action.kind === 'receive' && (
                  <div className="p6-return-inputs">
                    {remaining.map((item) => (
                      <label key={item.sku}>
                        {item.name}
                        <span>{item.available} eligible to return</span>
                        <input
                          aria-label={`Received quantity for ${item.name}`}
                          name={item.sku}
                          type="number"
                          min={0}
                          max={item.available}
                          defaultValue={
                            Array.isArray(attempt?.body.items)
                              ? ((attempt.body.items as { sku: string; quantity: number }[]).find(
                                  (line) => line.sku === item.sku,
                                )?.quantity ?? 0)
                              : 0
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
                {action.kind === 'restock' && (
                  <label>
                    Quantity to restock
                    <input
                      name="quantity"
                      type="number"
                      min={1}
                      max={action.max}
                      defaultValue={Number(attempt?.body.quantity ?? action.max)}
                      required
                    />
                    <span>
                      {action.sku} · {action.max} received units available
                    </span>
                  </label>
                )}
                <label>
                  Reason
                  <textarea
                    name="reason"
                    aria-label="Reason"
                    defaultValue={String(attempt?.body.reason ?? '')}
                    rows={3}
                    minLength={3}
                    maxLength={500}
                    required
                    placeholder="Add a clear note for this order’s history."
                  />
                </label>
              </fieldset>
              {mutation.isError && (
                <p className="p4-error" role="alert">
                  {mutation.error.message}
                  {attempt && ' Retry the saved request to check its result.'}
                </p>
              )}
              <div className="p6-form-actions">
                <Button
                  className="btn-secondary"
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => setAction(null)}
                >
                  Back
                </Button>
                <Button className="btn-primary" type="submit" disabled={mutation.isPending}>
                  {mutation.isPending
                    ? 'Saving…'
                    : attempt
                      ? 'Retry saved request'
                      : actionTitles[action.kind]}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function OrderTimeline({ order }: { order: OrderDetail }) {
  const { api } = useIdentity(),
    profile = useProfile().data!.data
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: [
      'connected',
      'timeline',
      profile.id,
      order.id,
      page,
      order.paymentStatus,
      order.fulfillmentStatus,
      order.refunds.map((r) => r.status).join(),
      order.returns
        .flatMap((r) => r.items)
        .map((i) => i.restockedQuantity)
        .join(),
    ],
    queryFn: () =>
      api<Paginated<OrderTimelineEvent>>(`/orders/${order.id}/timeline?page=${page}&pageSize=10`),
  })
  return (
    <section className="panel p6-timeline" aria-label="Order timeline">
      <div className="p6-section-head">
        <div>
          <span className="auth-eyebrow">EVERY HANDOFF, REMEMBERED</span>
          <h2>The story so far.</h2>
        </div>
      </div>
      {query.isPending ? (
        <p role="status">Loading order history…</p>
      ) : query.isError ? (
        <div>
          <p role="alert">Order history couldn’t be loaded.</p>
          <Button
            className="btn-secondary"
            onClick={() => {
              void query.refetch()
            }}
          >
            Retry history
          </Button>
        </div>
      ) : (
        <>
          <ol>
            {query.data.data.map((event) => (
              <li key={event.id}>
                <span className="p6-timeline-dot" />
                <div>
                  <strong>
                    {labels[event.action] ?? event.action.toLowerCase().replaceAll('_', ' ')}
                  </strong>
                  {typeof event.metadata.reason === 'string' && <p>{event.metadata.reason}</p>}
                  {typeof event.metadata.amountPaise === 'number' && (
                    <span>{money(event.metadata.amountPaise)}</span>
                  )}
                  {typeof event.metadata.quantity === 'number' && (
                    <span>
                      {event.metadata.quantity} {event.metadata.quantity === 1 ? 'unit' : 'units'}
                    </span>
                  )}
                  <small>
                    {event.actor} · {timestamp(event.createdAt)}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          {query.data.data.length === 0 && (
            <p className="p6-empty">No operational events recorded yet.</p>
          )}
          {query.data.pagination.pages > 1 && (
            <div className="p6-form-actions">
              <Button
                className="btn-secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Newer
              </Button>
              <span>
                Page {page} of {query.data.pagination.pages}
              </span>
              <Button
                className="btn-secondary"
                disabled={page === query.data.pagination.pages}
                onClick={() => setPage(page + 1)}
              >
                Older
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
