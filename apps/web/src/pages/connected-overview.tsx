import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowClockwise } from '@phosphor-icons/react/dist/csr/ArrowClockwise'
import { Package } from '@phosphor-icons/react/dist/csr/Package'
import { useIdentity } from '@/lib/identity-context'
import { useStockOptions, money, timestamp } from '@/lib/inventory-client'
import { useBoundedRefresh } from '@/lib/operations-client'
import { Button } from '@/components/ui/button'
import { ResourceHeading, ResourceState } from './phase3-shared'
import { OrdersTable } from './connected'
import type { OperationsOverview } from '@docklane/contracts'

export default function ConnectedOverview() {
  const { api } = useIdentity(),
    [params, setParams] = useSearchParams(),
    refresh = useBoundedRefresh()
  const options = useStockOptions({ archive: 'all' })
  const query = useQuery({
    queryKey: ['connected', 'workspace', params.toString()],
    queryFn: () => api<{ data: OperationsOverview }>(`/workspace?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: refresh,
  })
  const data = query.data?.data
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  const orderLink = (extra: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(extra)) next.set(key, value)
    return `/workspace/orders?${next}`
  }
  const stockLink = (stock?: string) => {
    const next = new URLSearchParams()
    if (params.get('warehouse')) next.set('warehouse', params.get('warehouse')!)
    if (stock) next.set('stock', stock)
    return `/workspace/inventory?${next}`
  }
  return (
    <>
      <ResourceHeading
        title="Your day, moving forward."
        description={
          data
            ? `${data.business.name} · A clear view of your saved orders and stock.`
            : 'A clear view of your saved orders and stock.'
        }
        action={
          <Button
            className="btn-secondary"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch()
            }}
          >
            <ArrowClockwise size={17} />
            Refresh overview
          </Button>
        }
      />
      <div className="p7-overview-filters">
        <label>
          Warehouse
          <select
            aria-label="Filter overview warehouse"
            value={params.get('warehouse') ?? ''}
            onChange={(e) => change('warehouse', e.target.value)}
          >
            <option value="">All warehouses</option>
            {params.get('warehouse') &&
              !options.warehouses.data?.data.some((w) => w.id === params.get('warehouse')) && (
                <option value={params.get('warehouse')!}>Selected warehouse</option>
              )}
            {options.warehouses.data?.data.map((w) => (
              <option value={w.id} key={w.id}>
                {w.name}
                {w.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Orders from
          <input
            type="date"
            aria-label="Overview start date"
            value={params.get('from') ?? ''}
            onChange={(e) => change('from', e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            aria-label="Overview end date"
            value={params.get('to') ?? ''}
            onChange={(e) => change('to', e.target.value)}
          />
        </label>
        <Button
          className="btn-secondary"
          onClick={() => {
            const today = new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Kolkata',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date())
            const next = new URLSearchParams(params)
            next.set('from', today)
            next.set('to', today)
            setParams(next)
          }}
        >
          Today
        </Button>
        {params.size > 0 && (
          <button className="text-link" onClick={() => setParams({})}>
            Clear filters
          </button>
        )}
      </div>
      {options.warehouses.isError && (
        <p role="alert" className="p7-refresh-note">
          Warehouse choices could not load.{' '}
          <button
            className="text-link"
            onClick={() => {
              void options.warehouses.refetch()
            }}
          >
            Retry choices
          </button>
        </p>
      )}
      {query.isPending ? (
        <ResourceState loading />
      ) : query.isError ? (
        <ResourceState
          error={query.error}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : (
        data && (
          <>
            <div className="p7-freshness">
              <span>
                {query.isFetching
                  ? 'Refreshing saved results…'
                  : `Snapshot ${timestamp(data.asOf)}`}
              </span>
              <span>Indian calendar days. Stock shows current balances.</span>
            </div>
            <div className="p7-metrics">
              {[
                [
                  'Open orders',
                  data.metrics.openOrders,
                  orderLink({ queue: 'open' }),
                  'Awaiting payment or fulfillment',
                ],
                [
                  'Available stock',
                  data.metrics.availableUnits,
                  stockLink(),
                  'On hand minus reserved',
                ],
                [
                  'Reserved units',
                  data.metrics.reservedUnits,
                  stockLink('reserved'),
                  'Held or allocated stock',
                ],
                [
                  'Stock to review',
                  data.metrics.lowStockLevels + data.metrics.outOfStockLevels,
                  stockLink('attention'),
                  `${data.metrics.lowStockLevels} low, ${data.metrics.outOfStockLevels} out of stock`,
                ],
              ].map(([label, value, href, note], i) => (
                <Link key={String(label)} to={String(href)} className={i === 3 ? 'attention' : ''}>
                  <span>
                    {label}
                    <ArrowUpRight size={16} />
                  </span>
                  <strong>{Number(value).toLocaleString('en-IN')}</strong>
                  <small>{note}</small>
                </Link>
              ))}
            </div>
            <div className="p7-operations-grid">
              <section className="panel p7-attention">
                <div className="connected-section-title">
                  <div>
                    <h2>Make the next move.</h2>
                    <p>Open the queue, then review the permitted order action.</p>
                  </div>
                  <Package size={26} weight="duotone" />
                </div>
                {(
                  [
                    ['pack', 'Ready to pack', 'Paid orders waiting for preparation'],
                    ['ship', 'Ready to ship', 'Packed orders ready for tracking'],
                    ['payment', 'Awaiting payment', 'Stock held while customers check out'],
                    ['refund', 'Refunds in progress', 'Follow money awaiting reconciliation'],
                    ['returns', 'Returns to inspect', 'Received items awaiting a restock decision'],
                  ] as const
                ).map(([key, label, note]) => (
                  <Link key={key} to={orderLink({ queue: key })}>
                    <span>
                      <strong>{label}</strong>
                      <small>{note}</small>
                    </span>
                    <b>{data.queues[key]}</b>
                    <ArrowUpRight size={18} />
                  </Link>
                ))}
              </section>
              <section className="panel p7-sites">
                <div className="connected-section-title">
                  <div>
                    <h2>Your warehouse network.</h2>
                    <p>Active sites and active product balances.</p>
                  </div>
                </div>
                {!data.warehouses.length ? (
                  <p className="p3-empty">
                    No active sites in this view.{' '}
                    <Link className="text-link" to="/workspace/warehouses">
                      Review warehouses
                    </Link>
                  </p>
                ) : (
                  data.warehouses.map((w) => (
                    <Link key={w.id} to={`/workspace/warehouses/${encodeURIComponent(w.id)}`}>
                      <span className="p7-site-code mono">{w.code}</span>
                      <span>
                        <strong>{w.name}</strong>
                        <small>{w.city}</small>
                      </span>
                      <span className="p7-site-stock">
                        <b>{w.availableUnits.toLocaleString('en-IN')}</b>
                        <small>available / {w.reservedUnits} reserved</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </Link>
                  ))
                )}
                <div className="p7-stock-links">
                  <Link to={stockLink('low')}>
                    Review low stock <b>{data.metrics.lowStockLevels}</b>
                  </Link>
                  <Link to={stockLink('out')}>
                    Review out of stock <b>{data.metrics.outOfStockLevels}</b>
                  </Link>
                </div>
              </section>
            </div>
            <section className="p7-money" aria-label="Test payment totals">
              <div>
                <span>Captured test payments</span>
                <strong>{money(data.metrics.capturedPaise)}</strong>
              </div>
              <div>
                <span>Successful test refunds</span>
                <strong>{money(data.metrics.refundedPaise)}</strong>
              </div>
              <div>
                <span>Net captured after refunds</span>
                <strong>{money(data.metrics.capturedPaise - data.metrics.refundedPaise)}</strong>
              </div>
              <p>
                {data.metrics.orders} orders placed in the selected period. Payment totals follow
                those orders.
              </p>
            </section>
            <section className="panel connected-orders-panel">
              <div className="connected-section-title">
                <div>
                  <h2>Recent orders.</h2>
                  <p>The latest five orders placed in this view.</p>
                </div>
                <Link to={orderLink({})} className="text-link">
                  All orders <ArrowUpRight size={16} />
                </Link>
              </div>
              {data.recentOrders.length ? (
                <OrdersTable orders={data.recentOrders} customer={false} />
              ) : (
                <p className="p3-empty">No orders were placed in this period.</p>
              )}
            </section>
            <section className="panel p7-activity">
              <div className="connected-section-title">
                <div>
                  <h2>The activity behind every count.</h2>
                  <p>Recent recorded actions in the selected dates and warehouse.</p>
                </div>
              </div>
              {data.activity.length ? (
                <ol>
                  {data.activity.map((event) => (
                    <li key={event.id}>
                      <span>
                        <strong>
                          {event.action
                            .toLowerCase()
                            .replaceAll('_', ' ')
                            .replace(/^./, (s) => s.toUpperCase())}
                        </strong>
                        <small>
                          {event.actor} · {event.entityType}
                        </small>
                      </span>
                      <time dateTime={event.createdAt}>{timestamp(event.createdAt)}</time>
                      {event.href && (
                        <Link
                          className="text-link"
                          to={event.href}
                          aria-label={`Review ${event.action.toLowerCase().replaceAll('_', ' ')}`}
                        >
                          Review <ArrowUpRight size={16} />
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="p3-empty">No recorded activity in this view.</p>
              )}
            </section>
            <details className="p7-definitions">
              <summary>How these numbers are calculated</summary>
              <p>
                Orders and queues use the current state of orders created between the selected
                dates, including the entire end day in Asia/Kolkata. Queue counts can overlap.
                Available and reserved units are current balances for active products at active
                warehouses, independent of the date filter. Low stock means available is positive
                and at or below its threshold; out of stock means available is zero.
              </p>
              <p>
                Captured totals sum saved payment amounts in captured, refund pending, partially
                refunded, or refunded states. Refund totals include succeeded refund attempts only.
                Both follow the selected order cohort; pending refunds remain in the net until
                confirmed. Activity uses the event date. This is development data and Stripe test
                money.
              </p>
              <p>
                Automatic refresh runs every 30 seconds for two minutes while this page is visible,
                and pauses during input or dialogs. Use Refresh overview for a new snapshot.
              </p>
            </details>
          </>
        )
      )}
    </>
  )
}
