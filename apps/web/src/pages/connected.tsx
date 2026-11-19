import { Suspense, useState, type ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { House } from '@phosphor-icons/react/dist/csr/House'
import { Receipt } from '@phosphor-icons/react/dist/csr/Receipt'
import { Users } from '@phosphor-icons/react/dist/csr/Users'
import { UserCircle } from '@phosphor-icons/react/dist/csr/UserCircle'
import { SignOut } from '@phosphor-icons/react/dist/csr/SignOut'
import { List } from '@phosphor-icons/react/dist/csr/List'
import { Warehouse } from '@phosphor-icons/react/dist/csr/Warehouse'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { Storefront } from '@phosphor-icons/react/dist/csr/Storefront'
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { ShoppingBag } from '@phosphor-icons/react/dist/csr/ShoppingBag'
import { Clock } from '@phosphor-icons/react/dist/csr/Clock'
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
import { useIdentity, useProfile } from '@/lib/identity-context'
import { useCart } from '@/lib/cart-context'
import { OrderReservation } from './order-reservation'
import { OrderPayment } from './order-payment'
import { OrderOperations, OrderTimeline } from './order-operations'
import { ApiError } from '@/lib/auth-client'
import type {
  Profile,
  Role,
  OrderSummary,
  OrderDetail,
  WorkspaceSummary,
  Paginated,
} from '@docklane/contracts'

const roleLabels: Record<Role, string> = {
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  CUSTOMER: 'Customer',
}
const statusLabels: Record<string, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  PENDING: 'Pending',
  CAPTURED: 'Captured',
  FAILED: 'Failed',
  REFUND_PENDING: 'Refund pending',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
  UNFULFILLED: 'Unfulfilled',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
}
const price = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100)
const date = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
function Busy() {
  return (
    <div className="connected-state" role="status" aria-busy="true">
      <span className="connected-spinner" />
      <h1>Opening your workspace…</h1>
      <p>Getting your latest account and orders ready.</p>
    </div>
  )
}
function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="connected-state">
      <h1>Let’s try that again.</h1>
      <p role="alert">
        {error instanceof Error ? error.message : 'We couldn’t load this view. Try again shortly.'}
      </p>
      {retry && (
        <Button className="btn-primary" onClick={retry}>
          Try again
        </Button>
      )}
      <Link to="/auth/sign-in" className="text-link">
        Return to sign in
      </Link>
    </div>
  )
}
export function Protected({ children, staff = false }: { children: ReactNode; staff?: boolean }) {
  const identity = useIdentity()
  const profile = useProfile()
  const location = useLocation()
  if (!identity.configured)
    return (
      <Failure
        error={
          new Error(
            'Sign-in is being configured. The sample workspace is available at the Docklane home page.',
          )
        }
      />
    )
  if (identity.loading) return <Busy />
  if (identity.sessionError)
    return (
      <Failure
        error={new Error(identity.sessionError)}
        retry={() => {
          void identity.refresh()
        }}
      />
    )
  if (!identity.session || (profile.error instanceof ApiError && profile.error.status === 401))
    return (
      <Navigate
        to={`/auth/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  if (profile.isPending) return <Busy />
  if (profile.isError)
    return (
      <Failure
        error={profile.error}
        retry={() => {
          void profile.refetch()
        }}
      />
    )
  if (staff && profile.data?.data.role === 'CUSTOMER')
    return <Navigate to="/account/orders" replace />
  return children
}
export function ConnectedLayout() {
  const profile = useProfile().data!.data
  const identity = useIdentity()
  const cart = useCart()
  const { pathname } = useLocation()
  const [menu, setMenu] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const customer = profile.role === 'CUSTOMER'
  const links = [
    ...(!customer
      ? [
          { path: '/workspace', label: 'Overview', icon: House },
          { path: '/workspace/products', label: 'Products', icon: Storefront },
          { path: '/workspace/inventory', label: 'Inventory', icon: Cube },
          { path: '/workspace/warehouses', label: 'Warehouses', icon: Warehouse },
          { path: '/workspace/orders', label: 'Orders', icon: Receipt },
          { path: '/workspace/operations', label: 'Background tasks', icon: Clock },
        ]
      : [
          { path: '/account/catalog', label: 'Collection', icon: Storefront },
          {
            path: '/account/cart',
            label: `My bag${cart.count ? ` (${cart.count})` : ''}`,
            icon: ShoppingBag,
          },
          { path: '/account/orders', label: 'My orders', icon: Receipt },
        ]),
    ...(profile.role === 'ADMIN'
      ? [{ path: '/workspace/team', label: 'People & access', icon: Users }]
      : []),
    { path: '/account', label: 'My account', icon: UserCircle },
  ]
  const navigation = (
    <>
      <Link to="/" className="auth-wordmark">
        <img src="/favicon.svg" alt="" width={26} height={26} />
        docklane<span>.</span>
      </Link>
      <div className="connected-business">
        <span className="workspace-avatar">N</span>
        <div>
          <strong>Northstar Supply</strong>
          <span>{customer ? 'Customer account' : 'Operations workspace'}</span>
        </div>
      </div>
      <span className="connected-nav-label">YOUR WORKSPACE</span>
      <nav aria-label="Workspace navigation">
        {links.map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            onClick={() => setMenu(false)}
            className={
              (
                path === '/workspace' || path === '/account'
                  ? pathname === path
                  : pathname.startsWith(path)
              )
                ? 'active'
                : ''
            }
          >
            <Icon size={20} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="connected-nav-bottom">
        <span className="connected-seed-label">
          <span />
          Development workspace
        </span>
        <Link to="/">
          Explore the sample workspace
          <ArrowUpRight size={16} />
        </Link>
        <p>
          Development accounts and sample payments.
          <br />
          Your bag, orders, and stock are saved.
        </p>
      </div>
    </>
  )
  return (
    <div className="connected-layout">
      <a className="skip-link" href="#connected-main">
        Skip to content
      </a>
      <aside className="connected-sidebar" aria-label="Workspace sidebar">
        {navigation}
      </aside>
      <div className="connected-main">
        <header className="connected-topbar">
          <div>
            <Dialog open={menu} onOpenChange={setMenu}>
              <DialogTrigger asChild>
                <button
                  className="icon-button connected-menu"
                  aria-label="Open workspace navigation"
                >
                  <List size={23} />
                </button>
              </DialogTrigger>
              <DialogContent className="connected-mobile-nav" centered={false}>
                <DialogTitle className="sr-only">Workspace navigation</DialogTitle>
                <DialogDescription className="sr-only">
                  Navigate your account and orders.
                </DialogDescription>
                {navigation}
              </DialogContent>
            </Dialog>
            <span>
              {customer ? 'Your account' : 'Workspace'}
              <span className="muted"> / </span>
              {links.find((link) => link.path === pathname)?.label ??
                (pathname === '/account/checkout'
                  ? 'Checkout'
                  : pathname.startsWith('/workspace/warehouses/')
                    ? 'Warehouse details'
                    : pathname.startsWith('/account/catalog/')
                      ? 'Product details'
                      : 'Order details')}
            </span>
          </div>
          <div>
            <span className="connected-role">{roleLabels[profile.role]}</span>
            <span className="connected-avatar" aria-hidden="true">
              {profile.name
                .split(' ')
                .slice(0, 2)
                .map((part) => part[0])
                .join('')}
            </span>
            <button
              className="connected-signout"
              disabled={leaving}
              onClick={async () => {
                setLeaving(true)
                try {
                  await identity.signOut()
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : 'Unable to sign out. Try again.',
                  )
                } finally {
                  setLeaving(false)
                }
              }}
            >
              <SignOut size={18} />
              <span>{leaving ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </header>
        <main id="connected-main" className="connected-content" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="p3-state" role="status">
                Opening this view…
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
        <footer className="connected-footer">
          <span>Docklane · Every order, moving forward.</span>
          <span>Seeded development data · INR</span>
        </footer>
      </div>
    </div>
  )
}
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`connected-badge ${['CAPTURED', 'CONFIRMED', 'COMPLETED', 'SHIPPED'].includes(value) ? 'good' : ['PENDING', 'AWAITING_PAYMENT', 'REFUND_PENDING'].includes(value) ? 'attention' : ''}`}
    >
      {statusLabels[value] ?? value}
    </span>
  )
}
function PageTitle({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="connected-page-title">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}
export function ConnectedOverview() {
  const { api } = useIdentity()
  const query = useQuery({
    queryKey: ['connected', 'workspace'],
    queryFn: () => api<{ data: WorkspaceSummary }>('/workspace'),
  })
  if (query.isPending) return <Busy />
  if (query.isError)
    return (
      <Failure
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  const workspace = query.data.data
  return (
    <>
      <PageTitle
        title="Your day, moving forward."
        description={`${workspace.business.name} · A clear view of your saved orders and stock.`}
        action={
          <Link className="btn-primary connected-link-button" to="/workspace/orders">
            View orders
            <ArrowUpRight size={17} />
          </Link>
        }
      />
      <div className="connected-metrics">
        {[
          ['Open orders', workspace.metrics.openOrders, 'Awaiting payment or fulfillment'],
          ['Reserved units', workspace.metrics.reservedUnits, 'Allocated to active sample orders'],
          [
            'Available stock',
            workspace.metrics.availableUnits,
            'On hand, excluding reserved units',
          ],
          [
            'Low-stock levels',
            workspace.metrics.lowStockLevels,
            'At or below the reorder threshold',
          ],
        ].map(([label, value, note]) => (
          <div key={label} className={label === 'Low-stock levels' ? 'highlight' : ''}>
            <span>{label}</span>
            <strong>{Number(value).toLocaleString('en-IN')}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <section className="panel connected-warehouse-panel">
        <div className="connected-section-title">
          <div>
            <h2>Every place. One connected view.</h2>
            <p>
              {workspace.metrics.products} products across {workspace.metrics.warehouses}{' '}
              warehouses.
            </p>
          </div>
          <Warehouse size={27} weight="duotone" />
        </div>
        <div className="connected-sites">
          {workspace.warehouses.map((warehouse) => (
            <div key={warehouse.id}>
              <span className="mono">{warehouse.code}</span>
              <h3>
                <Link to={`/workspace/warehouses/${encodeURIComponent(warehouse.id)}`}>
                  {warehouse.name}
                  <ArrowUpRight size={14} />
                </Link>
              </h3>
              <p>{warehouse.city}</p>
              <div>
                <strong>{warehouse.availableUnits}</strong>
                <span>available units</span>
                <strong>{warehouse.reservedUnits}</strong>
                <span>reserved</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel connected-orders-panel">
        <div className="connected-section-title">
          <div>
            <h2>Every order has a next move.</h2>
            <p>Your most recent sample orders, saved in this workspace.</p>
          </div>
          <Link to="/workspace/orders" className="text-link">
            All orders
            <ArrowRight size={16} />
          </Link>
        </div>
        <OrdersTable orders={workspace.recentOrders} customer={false} />
      </section>
      <div className="connected-callout">
        <CheckCircle size={23} weight="duotone" />
        <div>
          <strong>Every count has a story.</strong>
          <p>
            Track products across warehouses, correct stock counts, and follow every saved movement.
          </p>
        </div>
        <Link to="/workspace/inventory" className="text-link">
          Explore inventory
          <ArrowUpRight size={16} />
        </Link>
      </div>
    </>
  )
}
function OrdersTable({ orders, customer }: { orders: OrderSummary[]; customer: boolean }) {
  return (
    <div className="table-scroll" role="region" aria-label="Saved orders" tabIndex={0}>
      <table className="data-table connected-orders-table">
        <thead>
          <tr>
            <th>Order</th>
            {!customer && <th>Customer</th>}
            <th>Status</th>
            <th>Payment</th>
            <th>Amount</th>
            <th>Placed</th>
            <th>
              <span className="sr-only">Open order</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <Link
                  className="order-id"
                  to={`${customer ? '/account' : '/workspace'}/orders/${order.number}`}
                  aria-label={`Open order ${order.number}`}
                >
                  {order.number}
                </Link>
              </td>
              {!customer && <td>{order.customerName}</td>}
              <td>
                <Badge value={order.orderStatus} />
              </td>
              <td>
                <Badge value={order.paymentStatus} />
              </td>
              <td className="numeric">{price(order.totalPaise)}</td>
              <td className="muted">{date(order.createdAt)}</td>
              <td>
                <ArrowUpRight size={16} aria-hidden="true" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export function ConnectedOrders() {
  const { api } = useIdentity()
  const profile = useProfile().data!.data
  const customer = profile.role === 'CUSTOMER'
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const query = useQuery({
    queryKey: ['connected', 'orders', profile.id, params.toString()],
    queryFn: () => api<Paginated<OrderSummary>>(`/orders?${params}`),
  })
  function change(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next, { replace: true })
  }
  return (
    <>
      <PageTitle
        title={customer ? 'Every order, close at hand.' : 'Every order, accounted for.'}
        description={
          customer
            ? 'Your order history, with every detail in one place.'
            : 'Track customer orders, reserved stock, and each separate payment and fulfillment state.'
        }
      />
      <section className="panel connected-orders-panel">
        <div className="connected-orders-tools">
          <Input
            aria-label="Search saved orders"
            placeholder={customer ? 'Search order number…' : 'Search order or customer…'}
            value={params.get('q') ?? ''}
            onChange={(event) => change('q', event.target.value)}
          />
          <select
            aria-label="Filter saved order status"
            value={params.get('status') ?? ''}
            onChange={(event) => change('status', event.target.value)}
          >
            <option value="">All statuses</option>
            {['AWAITING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED'].map(
              (status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ),
            )}
          </select>
          <span>
            {query.data?.pagination.total ?? '…'}{' '}
            {query.data?.pagination.total === 1 ? 'order' : 'orders'}
          </span>
        </div>
        {query.isPending ? (
          <div className="connected-table-loading" role="status">
            Loading your orders…
          </div>
        ) : query.isError ? (
          <Failure
            error={query.error}
            retry={() => {
              void query.refetch()
            }}
          />
        ) : query.data.data.length ? (
          <OrdersTable orders={query.data.data} customer={customer} />
        ) : (
          <div className="connected-empty">
            <Receipt size={36} weight="duotone" />
            <h2>{params.size ? 'No orders match this view.' : 'Your next order starts here.'}</h2>
            <p>
              {params.size
                ? 'Try another search or clear the filters.'
                : customer
                  ? 'Your reserved orders appear here. Explore the collection to find something good.'
                  : 'New orders will appear here when customers start checking out.'}
            </p>
            {params.size ? (
              <Button className="btn-secondary" onClick={() => setParams({})}>
                Clear filters
              </Button>
            ) : (
              <Link
                to={customer ? '/account/catalog' : '/workspace/products'}
                className="text-link"
              >
                {customer ? 'Browse the collection' : 'View products'}
                <ArrowRight size={16} />
              </Link>
            )}
          </div>
        )}
        {query.data && query.data.pagination.pages > 1 && (
          <div className="connected-pagination">
            <span>
              Page {page} of {query.data.pagination.pages}
            </span>
            <Button
              className="btn-secondary"
              disabled={page <= 1}
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set('page', String(page - 1))
                setParams(next)
              }}
            >
              Previous
            </Button>
            <Button
              className="btn-secondary"
              disabled={page >= query.data.pagination.pages}
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set('page', String(page + 1))
                setParams(next)
              }}
            >
              Next
            </Button>
          </div>
        )}
      </section>
    </>
  )
}
export function ConnectedOrderDetail() {
  const { identifier } = useParams()
  const { api } = useIdentity()
  const profile = useProfile().data!.data
  const [openedAt] = useState(() => Date.now())
  const query = useQuery({
    queryKey: ['connected', 'order', profile.id, identifier],
    queryFn: () => api<{ data: OrderDetail }>(`/orders/${encodeURIComponent(identifier ?? '')}`),
    refetchInterval: (query) =>
      Date.now() - openedAt < 120_000 &&
      (query.state.data?.data.orderStatus === 'AWAITING_PAYMENT' ||
        query.state.data?.data.paymentStatus === 'REFUND_PENDING')
        ? 5000
        : false,
  })
  if (query.isPending) return <Busy />
  if (query.isError)
    return (
      <Failure
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  const order = query.data.data
  return (
    <>
      <Link
        className="text-link connected-back"
        to={profile.role === 'CUSTOMER' ? '/account/orders' : '/workspace/orders'}
      >
        <ArrowLeft size={16} />
        All orders
      </Link>
      <PageTitle
        title={order.number}
        description={`${order.customerName} · Placed ${date(order.createdAt)} · ${order.warehouse.name}`}
      />
      <OrderPayment order={order} />
      <OrderOperations order={order} />
      <div className="connected-detail-grid">
        <section className="panel">
          <div className="connected-section-title">
            <h2>Every step, in one place.</h2>
          </div>
          <div className="connected-statuses">
            {[
              ['Order', order.orderStatus],
              ['Payment', order.paymentStatus],
              ['Fulfillment', order.fulfillmentStatus],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <Badge value={value} />
              </div>
            ))}
          </div>
          <div className="connected-items">
            <h2>What’s inside</h2>
            {order.items.map((item) => (
              <div className="connected-item" key={item.sku}>
                <img src={item.image} alt="" width={52} height={52} />
                <div>
                  <strong>{item.name}</strong>
                  <span className="mono">{item.sku}</span>
                  <span>
                    {item.quantity} × {price(item.unitPricePaise)}
                  </span>
                </div>
                <strong>{price(item.totalPaise)}</strong>
              </div>
            ))}
          </div>
          <div className="connected-totals">
            <div>
              <span>Subtotal</span>
              <span>{price(order.subtotalPaise)}</span>
            </div>
            <div>
              <span>Shipping</span>
              <span>{price(order.shippingPaise)}</span>
            </div>
            <div>
              <strong>Total</strong>
              <strong>{price(order.totalPaise)}</strong>
            </div>
          </div>
        </section>
        <aside className="panel connected-delivery" aria-label="Delivery details">
          <span className="connected-detail-icon">
            <Warehouse size={27} weight="duotone" />
          </span>
          <h2>A clear destination.</h2>
          <h3>Delivery address</h3>
          <p>{order.deliveryAddress.line}</p>
          <p>
            {order.deliveryAddress.city} · {order.deliveryAddress.postalCode}
          </p>
          <p>{order.deliveryAddress.country === 'IN' ? 'India' : order.deliveryAddress.country}</p>
          <h3>Fulfilled from</h3>
          <p>
            {order.warehouse.name}
            <br />
            {order.warehouse.city}
          </p>
          <div className="connected-detail-note">
            <strong>Development order</strong>
            <p>
              Stock and order changes are saved. Payments and refunds use Stripe test mode. Shipment
              details are recorded manually.
            </p>
          </div>
          <OrderReservation order={order} />
        </aside>
      </div>
      <OrderTimeline order={order} />
    </>
  )
}
export function Team() {
  const profile = useProfile().data!.data
  const { api } = useIdentity()
  const cache = useQueryClient()
  const [pending, setPending] = useState<{ member: Profile; role: Role } | null>(null)
  const query = useQuery({
    queryKey: ['connected', 'team'],
    queryFn: () => api<Paginated<Profile>>('/team?pageSize=100'),
    enabled: profile.role === 'ADMIN',
  })
  const change = useMutation({
    mutationFn: ({ member, role }: { member: Profile; role: Role }) =>
      api<{ data: Profile }>(`/team/${member.id}`, { method: 'PATCH', body: { role } }),
    onSuccess: async (result) => {
      await cache.invalidateQueries({ queryKey: ['connected', 'team'] })
      setPending(null)
      toast.success(`${result.data.name} now has ${roleLabels[result.data.role]} access.`)
    },
  })
  if (profile.role !== 'ADMIN')
    return <Failure error={new Error('People and access are managed by a workspace admin.')} />
  return (
    <>
      <PageTitle
        title="The people behind every order."
        description="Give each member the right access to your workspace."
      />
      <section className="panel connected-team-panel">
        <div className="connected-section-title">
          <div>
            <h2>People & access</h2>
            <p>{query.data?.pagination.total ?? '…'} accounts in Northstar Supply</p>
          </div>
          <Users size={25} weight="duotone" />
        </div>
        {query.isPending ? (
          <div className="connected-table-loading" role="status">
            Loading workspace members…
          </div>
        ) : query.isError ? (
          <Failure
            error={query.error}
            retry={() => {
              void query.refetch()
            }}
          />
        ) : (
          <div className="table-scroll" role="region" aria-label="Workspace members" tabIndex={0}>
            <table className="data-table connected-team-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Workspace role</th>
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.name}</strong>
                      {member.id === profile.id && <small className="muted"> · You</small>}
                    </td>
                    <td className="muted">{member.email}</td>
                    <td>
                      <span className={`connected-badge ${member.active ? 'good' : ''}`}>
                        {member.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <select
                        aria-label={`Role for ${member.name}`}
                        disabled={member.id === profile.id}
                        value={member.role}
                        onChange={(event) => {
                          change.reset()
                          setPending({ member, role: event.target.value as Role })
                        }}
                      >
                        {Object.entries(roleLabels).map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="connected-callout">
        <Users size={23} />
        <div>
          <strong>Access follows responsibility.</strong>
          <p>
            Admins manage workspace access. Operators use staff views. Customers see their own
            orders. Ask another admin to change your own role.
          </p>
        </div>
      </div>
      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !change.isPending) setPending(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change {pending?.member.name}’s role?</DialogTitle>
            <DialogDescription>
              This account will receive {pending ? roleLabels[pending.role] : ''} access. The change
              takes effect on its next workspace request.
            </DialogDescription>
          </DialogHeader>
          {change.isError && (
            <p className="auth-error" role="alert">
              {change.error.message}
            </p>
          )}
          <div className="connected-dialog-actions">
            <Button
              className="btn-secondary"
              disabled={change.isPending}
              onClick={() => setPending(null)}
            >
              Keep current role
            </Button>
            <Button
              className="btn-primary"
              disabled={change.isPending || !pending}
              onClick={() => pending && change.mutate(pending)}
            >
              {change.isPending ? 'Saving…' : 'Confirm role change'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
export function Account() {
  const profile = useProfile().data!.data
  return (
    <>
      <PageTitle
        title="Your place in Docklane."
        description="Your account details and workspace access, in one view."
      />
      <section className="panel connected-account">
        <span className="connected-account-avatar">
          {profile.name
            .split(' ')
            .slice(0, 2)
            .map((part) => part[0])
            .join('')}
        </span>
        <h2>{profile.name}</h2>
        <p>{profile.email}</p>
        <dl>
          <div>
            <dt>Workspace</dt>
            <dd>Northstar Supply</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{roleLabels[profile.role]}</dd>
          </div>
          <div>
            <dt>Account status</dt>
            <dd>{profile.active ? 'Active' : 'Inactive'}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>Indian rupee (INR)</dd>
          </div>
        </dl>
        <Link to="/auth/forgot-password" className="text-link">
          Reset your password
          <ArrowRight size={16} />
        </Link>
      </section>
    </>
  )
}
