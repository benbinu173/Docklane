import { useState } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { Clock } from '@phosphor-icons/react/dist/csr/Clock'
import { CreditCard } from '@phosphor-icons/react/dist/csr/CreditCard'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { Info } from '@phosphor-icons/react/dist/csr/Info'
import { MapPin } from '@phosphor-icons/react/dist/csr/MapPin'
import { Receipt } from '@phosphor-icons/react/dist/csr/Receipt'
import { ShieldCheck } from '@phosphor-icons/react/dist/csr/ShieldCheck'
import { ShoppingBag } from '@phosphor-icons/react/dist/csr/ShoppingBag'
import { Truck } from '@phosphor-icons/react/dist/csr/Truck'
import { Users } from '@phosphor-icons/react/dist/csr/Users'
import { Warehouse } from '@phosphor-icons/react/dist/csr/Warehouse'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DataBoundary,
  EmptyResults,
  PageHeader,
  PanelHeading,
  ProductImage,
} from '@/components/shared'
import { useDemo } from '@/lib/demo-context'
import { useWorkspace } from '@/hooks/use-workspace'
import {
  available,
  count,
  demoDate,
  getProduct,
  getWarehouse,
  isLow,
  money,
  orderTotal,
  products,
  time,
  warehouses,
  type PreviewState,
} from '@/data/demo'

export function Warehouses() {
  const { stock, orders } = useDemo()
  const { go } = useWorkspace()
  return (
    <>
      <PageHeader
        title="Three places. One connected view."
        description="Get to know the warehouses that keep your business moving."
      >
        <span className="subtle-pill">
          <Warehouse size={15} />3 sample locations
        </span>
      </PageHeader>
      <DataBoundary>
        <div className="warehouse-network-heading">
          <span className="network-logo">
            <img src="/favicon.svg" alt="" width={44} height={44} />
          </span>
          <div>
            <strong>Northstar Supply network</strong>
            <p>
              {count(stock.reduce((sum, item) => sum + available(item), 0))} available units ·{' '}
              {stock.reduce((sum, item) => sum + item.reserved, 0)} reserved units
            </p>
          </div>
          <span className="network-line" />
        </div>
        <div className="warehouse-grid">
          {warehouses.map((warehouse) => {
            const items = stock.filter((item) => item.warehouse === warehouse.id)
            const availableUnits = items.reduce((sum, item) => sum + available(item), 0)
            const reserved = items.reduce((sum, item) => sum + item.reserved, 0)
            const open = orders.filter(
              (order) =>
                order.warehouse === warehouse.id &&
                ['awaiting', 'ready', 'packed'].includes(order.stage),
            ).length
            return (
              <section key={warehouse.id} className="panel warehouse-card">
                <div className="warehouse-card-visual">
                  <span className="mono">{warehouse.code}</span>
                  <Warehouse size={84} weight="duotone" />
                  <span className="warehouse-visual-label">{warehouse.city}</span>
                </div>
                <div className="warehouse-card-body">
                  <div className="warehouse-card-title">
                    <div>
                      <h2>{warehouse.name}</h2>
                      <p>
                        <MapPin size={14} />
                        {warehouse.address}
                      </p>
                    </div>
                  </div>
                  <div className="warehouse-card-stats">
                    <div>
                      <strong>{count(availableUnits)}</strong>
                      <span>Available units</span>
                    </div>
                    <div>
                      <strong>{reserved}</strong>
                      <span>Reserved units</span>
                    </div>
                  </div>
                  <div className="warehouse-allocation">
                    <div>
                      <span>Inventory allocation</span>
                      <strong>
                        {reserved} of {availableUnits + reserved} units held
                      </strong>
                    </div>
                    <div className="allocation-track">
                      <span
                        style={{
                          width: `${(reserved / Math.max(1, availableUnits + reserved)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="warehouse-card-detail">
                    <span>
                      <Receipt size={16} />
                      {open} open orders
                    </span>
                    <span className={items.filter(isLow).length ? 'warning-text' : 'success-text'}>
                      {items.filter(isLow).length} low-stock levels
                    </span>
                  </div>
                  <div className="warehouse-lead">
                    <span className="avatar">
                      {warehouse.lead
                        .split(' ')
                        .map((part) => part[0])
                        .join('')}
                    </span>
                    <div>
                      <strong>{warehouse.lead}</strong>
                      <span>Warehouse lead · sample profile</span>
                    </div>
                  </div>
                  <Button
                    className="btn-secondary full-width"
                    onClick={() => go('/inventory', { warehouse: warehouse.id })}
                  >
                    Explore inventory
                    <ArrowUpRight size={16} />
                  </Button>
                </div>
              </section>
            )
          })}
        </div>
        <div className="info-callout">
          <Info size={21} />
          <div>
            <strong>Each order has one home.</strong>
            <p>
              The first release allocates every line of an order to one warehouse. This prototype
              shows sites and stock balances; bin layouts and transfers are planned for a later
              release.
            </p>
          </div>
        </div>
      </DataBoundary>
    </>
  )
}

export function Payments() {
  const { orders } = useDemo()
  const { warehouse, update, params } = useWorkspace()
  const status = params.get('payment') ?? 'all'
  const query = params.get('q') ?? ''
  const records = orders.filter((order) => warehouse === 'all' || order.warehouse === warehouse)
  const filtered = records.filter(
    (order) =>
      `${order.id} ${order.customer}`.toLowerCase().includes(query.toLowerCase()) &&
      (status === 'all' ||
        (status === 'pending' && order.stage === 'awaiting') ||
        (status === 'refunded' && order.stage === 'cancelled') ||
        (status === 'captured' && !['awaiting', 'cancelled'].includes(order.stage))),
  )
  return (
    <>
      <PageHeader
        title="Every payment, with context."
        description="See the money side of your orders. These are sample payment records."
      >
        <span className="test-mode">
          <CreditCard size={16} />
          Demo records · no charges
        </span>
      </PageHeader>
      <DataBoundary>
        <div className="payment-stats">
          {[
            {
              label: 'Net captured',
              value: records
                .filter((order) => !['awaiting', 'cancelled'].includes(order.stage))
                .reduce((sum, order) => sum + orderTotal(order), 0),
              icon: CheckCircle,
              note: 'Captured sample payments, excluding refunds',
            },
            {
              label: 'Awaiting payment',
              value: records
                .filter((order) => order.stage === 'awaiting')
                .reduce((sum, order) => sum + orderTotal(order), 0),
              icon: Clock,
              note: 'Sample checkouts with reserved stock',
            },
            {
              label: 'Refunded',
              value: records
                .filter((order) => order.stage === 'cancelled')
                .reduce((sum, order) => sum + orderTotal(order), 0),
              icon: ArrowCounterClockwise,
              note: 'Completed sample refunds',
            },
          ].map(({ label, value, icon: Icon, note }) => (
            <div className="panel payment-stat" key={label}>
              <span>
                <Icon size={20} />
                {label}
              </span>
              <strong>{money(value)}</strong>
              <p>{note}</p>
            </div>
          ))}
        </div>
        <section className="panel">
          <div className="filter-tabs" aria-label="Filter payment status">
            {[
              ['all', 'All payments'],
              ['captured', 'Captured'],
              ['pending', 'Pending'],
              ['refunded', 'Refunded'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={status === value ? 'selected' : ''}
                aria-pressed={status === value}
                onClick={() => update({ payment: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inventory-toolbar">
            <Input
              className="payment-search"
              aria-label="Search payments"
              placeholder="Search order or customer..."
              value={query}
              onChange={(event) => update({ q: event.target.value })}
            />
            <span className="result-count">{filtered.length} records</span>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Sample payments table"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>Payment reference</th>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Warehouse</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.id}>
                    <td className="mono tiny">DEMO-{order.id.replace('DL-', '')}</td>
                    <td>
                      <button
                        className="order-id"
                        data-order-id={order.id}
                        aria-label={`Open order ${order.id}`}
                        onClick={() => update({ order: order.id })}
                      >
                        {order.id}
                      </button>
                    </td>
                    <td>{order.customer}</td>
                    <td>
                      <span
                        className={`status ${order.stage === 'awaiting' ? 'status-awaiting' : order.stage === 'cancelled' ? 'status-cancelled' : 'status-shipped'}`}
                      >
                        {order.stage === 'awaiting'
                          ? 'Pending'
                          : order.stage === 'cancelled'
                            ? 'Refunded'
                            : 'Captured'}
                      </span>
                    </td>
                    <td className="numeric">{money(orderTotal(order))}</td>
                    <td className="muted">{getWarehouse(order.warehouse).city}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <EmptyResults onClear={() => update({ q: null, payment: null, warehouse: null })} />
          )}
        </section>
        <div className="info-callout">
          <ShieldCheck size={23} />
          <div>
            <strong>A clear separation between orders, money, and stock.</strong>
            <p>
              A refund changes payment status. Stock increases only when returned items are
              explicitly received and restocked. Stripe test checkout and verified webhooks are
              scheduled for Phase 5.
            </p>
          </div>
        </div>
      </DataBoundary>
    </>
  )
}

export function Activity() {
  const { orders, stock } = useDemo()
  const { warehouse, params, update, go } = useWorkspace()
  const type = params.get('type') ?? 'all'
  const events = [
    ...orders.map((order) => ({
      id: order.id,
      type: 'orders',
      title: `${order.customer} placed ${order.id}`,
      detail: `${getWarehouse(order.warehouse).name} · ${money(orderTotal(order))}`,
      when: order.createdAt,
      icon: Receipt,
      warehouse: order.warehouse,
      action: () => update({ order: order.id }),
    })),
    ...stock.flatMap((item) =>
      item.adjustments.map((change, index) => ({
        id: `${item.id}-${index}`,
        type: 'stock',
        title: `Ben Thomas adjusted ${getProduct(item.sku).name}`,
        detail: `${change.quantity > 0 ? '+' : ''}${change.quantity} units · ${change.reason}`,
        when: change.time,
        icon: Cube,
        warehouse: item.warehouse,
        action: () => go('/inventory', { item: item.id, warehouse: item.warehouse }),
      })),
    ),
    ...stock.map((item) => ({
      id: `opening-${item.id}`,
      type: 'stock',
      title: `Opening balance for ${getProduct(item.sku).name}`,
      detail: `${getWarehouse(item.warehouse).name} · ${item.onHand - item.adjustments.reduce((sum, change) => sum + change.quantity, 0)} units`,
      when: new Date(demoDate.getTime() - 6 * 3_600_000).toISOString(),
      icon: Warehouse,
      warehouse: item.warehouse,
      action: () => go('/inventory', { item: item.id, warehouse: item.warehouse }),
    })),
  ]
    .filter(
      (event) =>
        (warehouse === 'all' || event.warehouse === warehouse) &&
        (type === 'all' || event.type === type),
    )
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
  return (
    <>
      <PageHeader
        title="The story behind every move."
        description="A sample activity feed connecting orders, people, and inventory."
      />
      <DataBoundary>
        <section className="panel activity-feed-panel">
          <div className="filter-tabs" aria-label="Filter activity type">
            {[
              ['all', 'All activity'],
              ['orders', 'Orders'],
              ['stock', 'Stock movements'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={type === value ? 'selected' : ''}
                aria-pressed={type === value}
                onClick={() => update({ type: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="activity-day-heading">
            <span>18 November 2026</span>
            <span>{events.length} sample events</span>
          </div>
          <div className="activity-feed">
            {events.map((event) => (
              <button className="activity-feed-item" key={event.id} onClick={event.action}>
                <span className="activity-feed-icon">
                  <event.icon size={21} weight="duotone" />
                </span>
                <div>
                  <strong>{event.title}</strong>
                  <span>{event.detail}</span>
                </div>
                <time dateTime={event.when}>{time(event.when)}</time>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
          {!events.length && (
            <EmptyResults onClear={() => update({ type: null, warehouse: null })} />
          )}
        </section>
      </DataBoundary>
    </>
  )
}

function CustomerPreview() {
  const [step, setStep] = useState(0)
  const product = products[0]
  const steps = ['Browse', 'Cart', 'Delivery', 'Payment', 'Confirmation']
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="btn-secondary">
          Preview customer journey
          <ArrowRight size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="customer-preview">
        <DialogHeader>
          <DialogTitle>A thoughtful checkout, step by step.</DialogTitle>
          <DialogDescription>
            An interactive wireflow for the customer experience. This preview does not create orders
            or process payments.
          </DialogDescription>
        </DialogHeader>
        <div className="checkout-steps">
          {steps.map((label, index) => (
            <button
              key={label}
              aria-pressed={step === index}
              className={step === index ? 'selected' : ''}
              onClick={() => setStep(index)}
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </div>
        <div className="checkout-preview-body">
          {step === 0 ? (
            <>
              <span className="subtle-pill">Northstar Supply catalog</span>
              <ProductImage product={product} />
              <h3>{product.name}</h3>
              <p>{money(product.price)} · Availability confirmed at checkout</p>
              <Button className="btn-primary" onClick={() => setStep(1)}>
                <ShoppingBag size={17} />
                Add sample to cart
              </Button>
            </>
          ) : step === 1 ? (
            <>
              <ShoppingBag size={32} weight="duotone" />
              <h3>Your cart, ready to go.</h3>
              <div className="preview-cart-line">
                <ProductImage product={product} />
                <div>
                  <strong>{product.name}</strong>
                  <span>1 unit · {product.sku}</span>
                </div>
                <strong>{money(product.price)}</strong>
              </div>
              <Button className="btn-primary" onClick={() => setStep(2)}>
                Continue to delivery
                <ArrowRight size={17} />
              </Button>
            </>
          ) : step === 2 ? (
            <>
              <MapPin size={32} weight="duotone" />
              <h3>Where should it go?</h3>
              <div className="preview-address">
                <label htmlFor="preview-name">Full name</label>
                <Input id="preview-name" defaultValue="Riya Nair" />
                <label htmlFor="preview-address">Delivery address</label>
                <Input id="preview-address" defaultValue="12, Garden Avenue, Kochi" />
              </div>
              <Button className="btn-primary" onClick={() => setStep(3)}>
                Preview payment step
                <ArrowRight size={17} />
              </Button>
            </>
          ) : step === 3 ? (
            <>
              <CreditCard size={34} weight="duotone" />
              <h3>A clear, secure handoff.</h3>
              <p>
                The implemented checkout will reserve available stock, then open Stripe test
                checkout. A verified payment event will confirm the order.
              </p>
              <Button className="btn-secondary" onClick={() => setStep(4)}>
                Preview confirmation
                <ArrowRight size={17} />
              </Button>
              <span className="tiny muted">Payment integration arrives in Phase 5.</span>
            </>
          ) : (
            <>
              <CheckCircle size={44} weight="duotone" className="success-text" />
              <h3>Every detail, accounted for.</h3>
              <p>
                The confirmation screen will show order, payment, and fulfillment states separately,
                with a link to track the order.
              </p>
              <Button className="btn-primary" onClick={() => setStep(0)}>
                Explore the flow again
                <ArrowCounterClockwise size={17} />
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function Settings() {
  const { previewState, setPreviewState, resetDemo } = useDemo()
  const { go } = useWorkspace()
  return (
    <>
      <PageHeader
        title="Make yourself at home."
        description="Your sample business, workspace details, and prototype controls."
      />
      <div className="settings-grid">
        <section className="panel settings-business">
          <PanelHeading title="Your workspace" description="The business behind the sample data." />
          <div className="business-profile">
            <span className="workspace-avatar">N</span>
            <div>
              <h3>Northstar Supply</h3>
              <span>Single business · 3 warehouses · INR</span>
            </div>
          </div>
          <dl className="settings-details">
            <div>
              <dt>Workspace admin</dt>
              <dd>Ben Thomas</dd>
            </div>
            <div>
              <dt>Default currency</dt>
              <dd>Indian rupee (INR)</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>Asia/Kolkata</dd>
            </div>
            <div>
              <dt>Sample date</dt>
              <dd>18 November 2026</dd>
            </div>
            <div>
              <dt>Identity</dt>
              <dd>Demo profile; authentication in Phase 2</dd>
            </div>
          </dl>
          <div className="settings-permissions">
            <Users size={21} />
            <p>
              Planned roles: <strong>Admin, Operator, Customer.</strong> API-side permissions will
              be implemented with the identity foundation.
            </p>
          </div>
        </section>
        <section className="panel preview-settings">
          <PanelHeading
            title="Explore every state"
            description="Check how Docklane responds when data is loading, missing, or unavailable."
          />
          <fieldset className="preview-state-options">
            <legend className="sr-only">Workspace data preview</legend>
            {[
              ['populated', 'Sample data', 'The complete populated workspace.'],
              ['loading', 'Loading', 'Stable skeletons while data is fetched.'],
              ['empty', 'Empty workspace', 'A useful next step for a fresh start.'],
              ['error', 'Unavailable', 'A clear error and a route to recovery.'],
            ].map(([value, label, description]) => (
              <label key={value} className={previewState === value ? 'selected' : ''}>
                <input
                  type="radio"
                  name="preview-state"
                  value={value}
                  checked={previewState === value}
                  onChange={() => setPreviewState(value as PreviewState)}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                {previewState === value && <CheckCircle size={20} />}
              </label>
            ))}
          </fieldset>
          <Button className="btn-primary full-width" onClick={() => go('/')}>
            View this state in the overview
            <ArrowRight size={16} />
          </Button>
        </section>
        <section className="panel customer-flow-settings">
          <PanelHeading
            title="On the other side of an order"
            description="Explore the customer journey planned around your inventory engine."
          />
          <div className="customer-flow-visual">
            {[ShoppingBag, Receipt, MapPin, CreditCard, Truck].map((Icon, index) => (
              <span key={index}>
                <Icon size={24} weight="duotone" />
                {index < 4 && <ArrowRight size={14} />}
              </span>
            ))}
          </div>
          <CustomerPreview />
        </section>
        <section className="panel reset-settings">
          <PanelHeading
            title="A fresh sample workspace"
            description="Restore the original inventory and orders after trying demo actions."
          />
          <div className="demo-note">
            <Info size={18} />
            <span>
              Demo changes are held in memory and reset on reload. No real inventory, payment, or
              shipment is changed.
            </span>
          </div>
          <Button className="btn-secondary" onClick={resetDemo}>
            <ArrowCounterClockwise size={17} />
            Reset sample data
          </Button>
        </section>
      </div>
    </>
  )
}
