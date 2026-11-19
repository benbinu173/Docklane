import { useRef, useState } from 'react'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { Clock } from '@phosphor-icons/react/dist/csr/Clock'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { Info } from '@phosphor-icons/react/dist/csr/Info'
import { MapPin } from '@phosphor-icons/react/dist/csr/MapPin'
import { Package } from '@phosphor-icons/react/dist/csr/Package'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { Receipt } from '@phosphor-icons/react/dist/csr/Receipt'
import { Truck } from '@phosphor-icons/react/dist/csr/Truck'
import { X } from '@phosphor-icons/react/dist/csr/X'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Hint, ProductImage, StageBadge } from '@/components/shared'
import { useWorkspace } from '@/hooks/use-workspace'
import { useDemo } from '@/lib/demo-context'
import {
  available,
  count,
  demoDate,
  getProduct,
  getWarehouse,
  money,
  orderTotal,
  orderUnits,
  time,
} from '@/data/demo'

function DrawerHeading({
  label,
  title,
  subtitle,
}: {
  label: string
  title: string
  subtitle: string
}) {
  return (
    <DialogHeader className="drawer-heading">
      <div>
        <span className="drawer-label">{label}</span>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{subtitle}</DialogDescription>
      </div>
      <DialogClose asChild>
        <button className="icon-button" aria-label="Close details">
          <X size={22} />
        </button>
      </DialogClose>
    </DialogHeader>
  )
}

export function DetailPanels() {
  const { params, update } = useWorkspace()
  const { orders, stock, packOrder, adjustStock } = useDemo()
  const orderId = params.get('order')
  const itemId = params.get('item')
  const order = orders.find((item) => item.id === orderId)
  const item = stock.find((row) => row.id === itemId)
  const previousFocus = useRef<HTMLElement | null>(null)
  const savedSelection = useRef<{ type: 'order' | 'stock'; id: string } | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState('')
  const captureFocus = (type: 'order' | 'stock', id: string) => {
    previousFocus.current = document.activeElement as HTMLElement
    savedSelection.current = { type, id }
  }
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    const selection = savedSelection.current
    const target = selection
      ? document.querySelector<HTMLButtonElement>(`[data-${selection.type}-id="${selection.id}"]`)
      : null
    if (target) {
      target.focus()
      return
    }
    if (
      previousFocus.current?.isConnected &&
      previousFocus.current.matches('button,a[href],input,[tabindex]') &&
      !previousFocus.current.closest('[role="dialog"]')
    ) {
      previousFocus.current.focus()
      return
    }
    document.querySelector<HTMLElement>('h1')?.focus()
  }
  const product = item ? getProduct(item.sku) : null
  const awaiting = order?.stage === 'awaiting'
  const cancelled = order?.stage === 'cancelled'
  const shipped = order?.stage === 'shipped'
  const packed = order?.stage === 'packed' || shipped
  const eventTime = (offset: number) =>
    order ? time(new Date(new Date(order.createdAt).getTime() + offset * 60_000).toISOString()) : ''
  return (
    <>
      <Dialog
        open={!!orderId}
        onOpenChange={(open) => {
          if (!open) update({ order: null })
        }}
      >
        <DialogContent
          className="detail-drawer"
          centered={false}
          showCloseButton={false}
          onOpenAutoFocus={() => captureFocus('order', orderId ?? '')}
          onCloseAutoFocus={restoreFocus}
        >
          <DrawerHeading
            label="ORDER DETAILS"
            title={orderId ?? 'Order'}
            subtitle="Every step, in one place. Sample order data."
          />
          {order ? (
            <>
              <div
                className="drawer-body"
                tabIndex={0}
                role="region"
                aria-label="Order details content"
              >
                <div className="order-detail-intro">
                  <StageBadge stage={order.stage} />
                  <span>18 Nov 2026 · {time(order.createdAt)}</span>
                </div>
                <div className="detail-customer">
                  <span className="avatar" style={{ background: order.avatarColor }}>
                    {order.initials}
                  </span>
                  <div>
                    <strong>{order.customer}</strong>
                    <span>{order.email}</span>
                  </div>
                </div>
                <div className="order-status-grid">
                  <div>
                    <span>Order</span>
                    <strong>
                      {awaiting
                        ? 'Awaiting payment'
                        : cancelled
                          ? 'Cancelled'
                          : shipped
                            ? 'Completed'
                            : 'Confirmed'}
                    </strong>
                  </div>
                  <div>
                    <span>Payment</span>
                    <strong className={awaiting ? 'warning-text' : 'success-text'}>
                      {awaiting ? 'Pending' : cancelled ? 'Refunded' : 'Captured'}
                    </strong>
                  </div>
                  <div>
                    <span>Fulfillment</span>
                    <strong>{shipped ? 'Shipped' : packed ? 'Packed' : 'Unfulfilled'}</strong>
                  </div>
                </div>
                <section className="detail-section">
                  <div className="detail-section-heading">
                    <h3>Order journey</h3>
                    <span className="tiny muted">All times IST</span>
                  </div>
                  <ol className="order-timeline">
                    {[
                      {
                        title: 'Order placed',
                        note: `${orderUnits(order)} units · ${getWarehouse(order.warehouse).name}`,
                        done: true,
                        icon: Receipt,
                        when: eventTime(0),
                      },
                      {
                        title: cancelled ? 'Reservation released' : 'Stock reserved',
                        note: cancelled
                          ? 'Cancelled order no longer holds stock.'
                          : awaiting
                            ? `Sample reservation expires at ${eventTime(30)}.`
                            : shipped
                              ? 'Allocation consumed at shipment.'
                              : 'Allocated stock stays held until shipment.',
                        done: true,
                        icon: Cube,
                        when: eventTime(0),
                      },
                      {
                        title: cancelled ? 'Payment refunded' : 'Payment confirmed',
                        note: cancelled
                          ? 'Full sample refund completed.'
                          : awaiting
                            ? 'Waiting for customer payment.'
                            : `${money(orderTotal(order))} captured in this sample order.`,
                        done: !awaiting,
                        icon: CheckCircle,
                        when: !awaiting ? eventTime(1) : '',
                      },
                      ...(!cancelled
                        ? [
                            {
                              title: 'Packed and ready',
                              note: packed
                                ? 'Items checked and prepared for dispatch.'
                                : 'Your packing team takes it from here.',
                              done: packed,
                              icon: Package,
                              when: packed ? eventTime(3) : '',
                            },
                            {
                              title: 'Shipped to customer',
                              note: shipped
                                ? `Tracking: DEMO-${order.id.replace('DL-', '')}`
                                : 'The final handoff to delivery.',
                              done: shipped,
                              icon: Truck,
                              when: shipped ? eventTime(6) : '',
                            },
                          ]
                        : []),
                    ].map((event, index) => (
                      <li key={event.title} className={event.done ? 'done' : 'pending'}>
                        <span className="timeline-icon">
                          {event.done ? (
                            <Check size={15} weight="bold" />
                          ) : (
                            <event.icon size={15} />
                          )}
                        </span>
                        <div>
                          <strong>{event.title}</strong>
                          <p>{event.note}</p>
                        </div>
                        <span className="timeline-time">{event.when || `Step ${index + 1}`}</span>
                      </li>
                    ))}
                  </ol>
                </section>
                <section className="detail-section">
                  <div className="detail-section-heading">
                    <h3>What’s inside</h3>
                    <span className="tiny muted">{order.items.length} line items</span>
                  </div>
                  {order.items.map((line) => {
                    const product = getProduct(line.sku)
                    return (
                      <div className="order-line-item" key={line.sku}>
                        <ProductImage product={product} />
                        <div>
                          <strong>{product.name}</strong>
                          <span>
                            {line.quantity} × {money(product.price)}
                          </span>
                          <span className="mono tiny muted">{line.sku}</span>
                        </div>
                        <strong className="numeric">{money(product.price * line.quantity)}</strong>
                      </div>
                    )
                  })}
                  <div className="order-total-line">
                    <span>
                      Total <small>Shipping included · INR</small>
                    </span>
                    <strong>{money(orderTotal(order))}</strong>
                  </div>
                </section>
                <section className="detail-section delivery-section">
                  <span className="delivery-icon">
                    <MapPin size={22} />
                  </span>
                  <div>
                    <h3>Delivery address</h3>
                    <strong>{order.customer}</strong>
                    <p>{order.address}</p>
                  </div>
                </section>
                <div className="demo-note">
                  <Info size={17} />
                  <span>
                    This is a sample order. Demo actions reset when you reload. No payment or
                    shipment is processed.
                  </span>
                </div>
              </div>
              <div className="drawer-footer">
                {order.stage === 'ready' ? (
                  <>
                    <div>
                      <strong>Ready for its next move.</strong>
                      <span>Payment is confirmed in this sample.</span>
                    </div>
                    <Button className="btn-primary" onClick={() => packOrder(order.id)}>
                      Mark packed
                      <Package size={17} />
                    </Button>
                  </>
                ) : (
                  <>
                    <div>
                      <strong>
                        {awaiting
                          ? 'Waiting on payment.'
                          : cancelled
                            ? 'This order is closed.'
                            : packed && !shipped
                              ? 'Ready for dispatch.'
                              : 'On its way.'}
                      </strong>
                      <span>
                        {awaiting
                          ? 'Stock remains temporarily reserved.'
                          : packed && !shipped
                            ? 'Shipment is unavailable in this prototype.'
                            : 'Review the complete sample journey above.'}
                      </span>
                    </div>
                    <Hint
                      label={
                        awaiting
                          ? 'Payment actions are unavailable in this prototype.'
                          : 'Shipment and refund actions are unavailable in this prototype.'
                      }
                    >
                      <span tabIndex={0}>
                        <Button className="btn-secondary" disabled>
                          {awaiting
                            ? 'Await payment'
                            : packed && !shipped
                              ? 'Mark shipped'
                              : cancelled
                                ? 'Refunded'
                                : 'View shipment'}
                          <ArrowRight size={16} />
                        </Button>
                      </span>
                    </Hint>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Receipt size={32} />
              <h3>Order not found</h3>
              <p>This link doesn’t match a sample order.</p>
              <Button onClick={() => update({ order: null })} className="btn-primary">
                Back to workspace
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!itemId}
        onOpenChange={(open) => {
          if (!open) {
            update({ item: null })
            setAdjusting(false)
            setFormError('')
            setQuantity('')
            setReason('')
          }
        }}
      >
        <DialogContent
          className="detail-drawer stock-drawer"
          centered={false}
          showCloseButton={false}
          onOpenAutoFocus={() => captureFocus('stock', itemId ?? '')}
          onCloseAutoFocus={restoreFocus}
        >
          <DrawerHeading
            label="INVENTORY DETAILS"
            title={product?.name ?? 'Stock item'}
            subtitle={
              item
                ? `${getWarehouse(item.warehouse).name} · ${item.sku}`
                : 'Sample inventory details'
            }
          />
          {item && product ? (
            <>
              <div
                className="drawer-body"
                tabIndex={0}
                role="region"
                aria-label="Inventory details content"
              >
                <div className="stock-detail-intro">
                  <ProductImage product={product} />
                  <div>
                    <span className="subtle-pill">{product.category}</span>
                    <p>
                      {money(product.price)}
                      <span> per unit</span>
                    </p>
                  </div>
                </div>
                <div className="stock-detail-numbers">
                  <div>
                    <span>On hand</span>
                    <strong>{count(item.onHand)}</strong>
                  </div>
                  <div>
                    <span>Reserved</span>
                    <strong>{count(item.reserved)}</strong>
                  </div>
                  <div className="available-number">
                    <span>Available</span>
                    <strong>{count(available(item))}</strong>
                  </div>
                </div>
                <div className="stock-explainer">
                  <Cube size={19} />
                  <p>
                    {item.reserved} units are held for active sample orders. Available stock is on
                    hand minus reserved.
                  </p>
                </div>
                <section className="detail-section">
                  <div className="detail-section-heading">
                    <h3>Stock movement</h3>
                    <span className="tiny muted">Sample history</span>
                  </div>
                  {item.adjustments.map((adjustment, index) => (
                    <div className="stock-movement" key={`${adjustment.time}-${index}`}>
                      <span className="movement-icon">
                        <Plus size={17} />
                      </span>
                      <div>
                        <strong>{adjustment.reason}</strong>
                        <span>Ben Thomas · {time(adjustment.time)}</span>
                      </div>
                      <strong
                        className={
                          adjustment.quantity > 0 ? 'success-text numeric' : 'warning-text numeric'
                        }
                      >
                        {adjustment.quantity > 0 ? '+' : ''}
                        {adjustment.quantity}
                      </strong>
                    </div>
                  ))}
                  <div className="stock-movement">
                    <span className="movement-icon">
                      <Cube size={17} />
                    </span>
                    <div>
                      <strong>Sample opening balance</strong>
                      <span>Northstar Supply · 18 Nov 2026</span>
                    </div>
                    <strong className="numeric">
                      {count(
                        item.onHand -
                          item.adjustments.reduce((sum, change) => sum + change.quantity, 0),
                      )}
                    </strong>
                  </div>
                  <div className="stock-movement">
                    <span className="movement-icon">
                      <Clock size={17} />
                    </span>
                    <div>
                      <strong>Held for active orders</strong>
                      <span>Included in the reserved balance</span>
                    </div>
                    <strong className="numeric">{item.reserved}</strong>
                  </div>
                </section>
                {adjusting && (
                  <form
                    className="adjustment-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const error = adjustStock(item.id, Number(quantity), reason)
                      if (error) setFormError(error)
                      else {
                        setAdjusting(false)
                        setQuantity('')
                        setReason('')
                        setFormError('')
                      }
                    }}
                  >
                    <div className="detail-section-heading">
                      <h3>Adjust sample stock</h3>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Cancel adjustment"
                        onClick={() => {
                          setAdjusting(false)
                          setFormError('')
                        }}
                      >
                        <X size={17} />
                      </button>
                    </div>
                    <label htmlFor="adjustment-quantity">Quantity change</label>
                    <Input
                      id="adjustment-quantity"
                      type="number"
                      step="1"
                      autoFocus
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      placeholder="e.g. 10 or -5"
                      aria-invalid={!!formError}
                      aria-describedby="adjustment-help adjustment-error"
                      required
                    />
                    <p id="adjustment-help" className="form-help">
                      Positive adds stock. Negative removes stock. Reserved units stay protected.
                    </p>
                    <label htmlFor="adjustment-reason">Reason</label>
                    <Input
                      id="adjustment-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="e.g. Sample stock received"
                      maxLength={200}
                      required
                    />
                    <p
                      id="adjustment-error"
                      className="form-error"
                      role={formError ? 'alert' : undefined}
                    >
                      {formError}
                    </p>
                    <Button type="submit" className="btn-primary full-width">
                      Save demo adjustment
                      <Check size={17} />
                    </Button>
                  </form>
                )}
                <div className="detail-section reorder-section">
                  <div>
                    <h3>Reorder threshold</h3>
                    <p>
                      This stock level needs attention at {item.threshold} available units or fewer.
                    </p>
                  </div>
                  <span className="threshold-number">{item.threshold}</span>
                </div>
                <div className="demo-note">
                  <Info size={17} />
                  <span>
                    Sample stock only. Adjustments stay in this browser session and reset when you
                    reload.
                  </span>
                </div>
              </div>
              <div className="drawer-footer">
                <div>
                  <strong>{getWarehouse(item.warehouse).city}</strong>
                  <span>Last sample snapshot: {time(demoDate.toISOString())}</span>
                </div>
                <Button
                  className="btn-primary"
                  onClick={() => {
                    setAdjusting(true)
                    setFormError('')
                  }}
                  disabled={adjusting}
                >
                  <Plus size={17} />
                  Adjust sample stock
                </Button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Cube size={32} />
              <h3>Stock item not found</h3>
              <p>Return to inventory and choose a sample product.</p>
              <Button className="btn-primary" onClick={() => update({ item: null })}>
                Back to inventory
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
