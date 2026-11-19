import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
} from 'recharts'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { Clock } from '@phosphor-icons/react/dist/csr/Clock'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { Info } from '@phosphor-icons/react/dist/csr/Info'
import { Package } from '@phosphor-icons/react/dist/csr/Package'
import { Receipt } from '@phosphor-icons/react/dist/csr/Receipt'
import { Truck } from '@phosphor-icons/react/dist/csr/Truck'
import { WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { Warehouse } from '@phosphor-icons/react/dist/csr/Warehouse'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DataBoundary,
  Hint,
  PageHeader,
  PanelHeading,
  ProductImage,
  StageBadge,
  TextLink,
} from '@/components/shared'
import { WarehouseSelect } from '@/components/workspace-shell'
import { useDemo } from '@/lib/demo-context'
import { useWorkspace } from '@/hooks/use-workspace'
import {
  available,
  count,
  getProduct,
  getWarehouse,
  isLow,
  money,
  orderHistory,
  orderTotal,
  products,
  warehouses,
} from '@/data/demo'

export default function Overview() {
  const { orders, stock } = useDemo()
  const { warehouse, go, update } = useWorkspace()
  const [days, setDays] = useState('7')
  const filteredOrders = orders.filter(
    (order) => warehouse === 'all' || order.warehouse === warehouse,
  )
  const filteredStock = stock.filter((item) => warehouse === 'all' || item.warehouse === warehouse)
  const openOrders = filteredOrders.filter(
    (order) => !['shipped', 'cancelled'].includes(order.stage),
  ).length
  const reserved = filteredStock.reduce((sum, item) => sum + item.reserved, 0)
  const availableUnits = filteredStock.reduce((sum, item) => sum + available(item), 0)
  const low = filteredStock.filter(isLow)
  const awaiting = filteredOrders.filter((order) => order.stage === 'awaiting')
  const ready = filteredOrders.filter((order) => order.stage === 'ready')
  const shipped = filteredOrders.filter((order) => order.stage === 'shipped')
  const history = orderHistory(warehouse, orders, Number(days))
  const stages = [
    {
      id: 'awaiting',
      name: 'Awaiting payment',
      icon: Clock,
      subtitle: 'Stock held for checkout',
      className: 'waiting',
    },
    {
      id: 'ready',
      name: 'Ready to pack',
      icon: Cube,
      subtitle: 'Paid and ready to move',
      className: 'ready',
    },
    {
      id: 'packed',
      name: 'Packed',
      icon: Package,
      subtitle: 'Next stop: dispatch',
      className: 'packed',
    },
    {
      id: 'shipped',
      name: 'Shipped',
      icon: Truck,
      subtitle: 'On the way to customers',
      className: 'shipped',
    },
  ]
  const topProducts = products
    .map((product) => ({
      product,
      units: filteredOrders
        .filter((order) => order.stage !== 'cancelled')
        .reduce(
          (sum, order) =>
            sum +
            order.items
              .filter((item) => item.sku === product.sku)
              .reduce((subtotal, item) => subtotal + item.quantity, 0),
          0,
        ),
    }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 3)
  return (
    <>
      <PageHeader
        title="Your day, in motion."
        description="A clear view of your stock, orders, and everything in between."
      >
        <WarehouseSelect />
        <Button className="btn-primary" onClick={() => go('/orders')}>
          View orders
          <ArrowUpRight size={17} />
        </Button>
      </PageHeader>
      <DataBoundary>
        <div className="overview-stats">
          {[
            {
              label: 'Open orders',
              value: openOrders,
              note: 'Awaiting payment or shipment',
              icon: Receipt,
              action: () => go('/orders', { stage: 'open' }),
              info: 'Orders awaiting payment, ready to pack, or packed.',
            },
            {
              label: 'Reserved units',
              value: reserved,
              note: 'Held safely for active orders',
              icon: Package,
              action: () => go('/inventory', { stock: 'reserved' }),
              info: 'Units held for checkout or allocated to unshipped orders.',
            },
            {
              label: 'Available stock',
              value: availableUnits,
              note: 'Ready for your next order',
              icon: Cube,
              action: () => go('/inventory'),
              info: 'On-hand units minus reserved units across the selected warehouses.',
            },
            {
              label: 'Low-stock levels',
              value: low.length,
              note: low.length
                ? 'A little attention goes a long way'
                : 'Your stock is looking healthy',
              icon: WarningCircle,
              action: () => go('/inventory', { stock: 'low' }),
              info: 'Warehouse/SKU balances with available units at or below their reorder threshold.',
            },
          ].map(({ label, value, note, icon: Icon, action, info }, index) => (
            <div key={label} className={`metric ${index === 3 ? 'metric-attention' : ''}`}>
              <div className="metric-label">
                <span>{label}</span>
                <Hint label={info}>
                  <button className="metric-info" aria-label={`About ${label.toLowerCase()}`}>
                    <Info size={15} />
                  </button>
                </Hint>
              </div>
              <button
                className="metric-value"
                aria-label={`View ${count(value)} ${label.toLowerCase()}`}
                onClick={action}
              >
                <span>{count(value)}</span>
                <ArrowUpRight size={18} />
              </button>
              <div className="metric-note">
                <Icon size={14} />
                {note}
              </div>
            </div>
          ))}
        </div>
        <section className="panel fulfillment-panel">
          <PanelHeading
            title="Every order has a next move."
            description="Your fulfillment pipeline, at a glance."
            action={
              <span className="subtle-pill">
                <span className="semantic-dot" />
                {filteredOrders.length} sample orders today
              </span>
            }
          />
          <div className="fulfillment-flow">
            {stages.map(({ id, name, icon: Icon, subtitle, className }, index) => (
              <button
                key={id}
                className={`flow-stage ${className}`}
                onClick={() => go('/orders', { stage: id })}
              >
                <div className="flow-stage-top">
                  <span className="flow-icon">
                    <Icon size={23} weight="duotone" />
                  </span>
                  <span className="flow-step">0{index + 1}</span>
                </div>
                <div className="flow-number">
                  {filteredOrders.filter((order) => order.stage === id).length}
                  <ArrowRight size={20} />
                </div>
                <strong>{name}</strong>
                <span className="flow-caption">{subtitle}</span>
              </button>
            ))}
          </div>
          <div className="pipeline-footer">
            <span>
              <Check size={15} weight="bold" />
              {shipped.length} orders have reached dispatch today.
            </span>
            <TextLink onClick={() => go('/orders')}>Follow your orders</TextLink>
          </div>
        </section>
        <div className="overview-middle">
          <section className="panel activity-chart-panel">
            <PanelHeading
              title="A week of moving forward"
              description="Order volume across your selected warehouses."
              action={
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger className="chart-select" aria-label="Order activity date range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="14">Last 14 days</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <div className="chart-summary">
              <strong>
                {filteredOrders.length}
                <span> orders today</span>
              </strong>
              <span className="chart-legend">
                <span />
                Orders placed
              </span>
            </div>
            <div
              className="order-chart"
              role="img"
              aria-label={`Sample order activity: ${history.map((day) => `${day.day}: ${day.orders} orders`).join(', ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={history}
                  margin={{ top: 14, right: 10, bottom: 0, left: 10 }}
                  accessibilityLayer
                >
                  <defs>
                    <linearGradient id="orderFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#b9f36b" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#b9f36b" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#e8edf0" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#677484', fontSize: 11 }}
                    minTickGap={15}
                    dy={8}
                  />
                  <ChartTooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid #d9e0e7', fontSize: 12 }}
                    formatter={(value) => [value, 'Orders']}
                    cursor={{ stroke: '#a8b994', strokeDasharray: '4 4' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="orders"
                    stroke="#617a42"
                    strokeWidth={2.5}
                    fill="url(#orderFill)"
                    isAnimationActive={false}
                    activeDot={{ r: 5, fill: '#101d2c', stroke: '#b9f36b', strokeWidth: 3 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="panel focus-panel">
            <PanelHeading
              title="A little attention"
              description="Small actions that keep things flowing."
              action={
                <span className="focus-count">{low.length + awaiting.length + ready.length}</span>
              }
            />
            <button className="focus-item" onClick={() => go('/inventory', { stock: 'low' })}>
              <span className="focus-icon amber">
                <WarningCircle size={21} />
              </span>
              <div>
                <strong>{low.length} stock levels are running low</strong>
                <span>
                  {low[0]
                    ? `${getProduct(low[0].sku).name} and more`
                    : 'Your inventory is looking healthy'}
                </span>
              </div>
              <ArrowUpRight size={18} />
            </button>
            <button className="focus-item" onClick={() => go('/orders', { stage: 'ready' })}>
              <span className="focus-icon green">
                <Package size={21} />
              </span>
              <div>
                <strong>{ready.length} orders are ready to pack</strong>
                <span>Payment received. Let’s get them moving.</span>
              </div>
              <ArrowUpRight size={18} />
            </button>
            <button className="focus-item" onClick={() => go('/orders', { stage: 'awaiting' })}>
              <span className="focus-icon neutral">
                <Clock size={21} />
              </span>
              <div>
                <strong>{awaiting.length} checkouts await payment</strong>
                <span>Stock is temporarily reserved.</span>
              </div>
              <ArrowUpRight size={18} />
            </button>
            <div className="focus-bottom">
              <span className="mini-brand">
                <img src="/favicon.svg" alt="" width={22} height={22} />
              </span>
              <span>
                A place for everything.
                <br />
                <strong>A next step for every order.</strong>
              </span>
            </div>
          </section>
        </div>
        <div className="overview-bottom">
          <section className="panel recent-orders">
            <PanelHeading
              title="Fresh off the checkout"
              description="The latest orders in your workspace."
              action={<TextLink onClick={() => go('/orders')}>All orders</TextLink>}
            />
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Recent orders table"
            >
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                    <th>
                      <span className="sr-only">Open order</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.slice(0, 4).map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => update({ order: order.id })}
                      className="clickable-row"
                    >
                      <td>
                        <button
                          className="order-id"
                          data-order-id={order.id}
                          aria-label={`Open order ${order.id}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            update({ order: order.id })
                          }}
                        >
                          {order.id}
                        </button>
                      </td>
                      <td>
                        <span className="customer-name">{order.customer}</span>
                      </td>
                      <td>
                        <StageBadge stage={order.stage} />
                      </td>
                      <td className="text-right numeric">{money(orderTotal(order))}</td>
                      <td>
                        <ArrowUpRight size={16} className="muted" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel top-products">
            <PanelHeading
              title="Making moves"
              description="Today’s most-ordered products."
              action={<Cube size={21} className="muted" />}
            />
            {topProducts.map(({ product, units }, index) => (
              <button
                className="top-product-row"
                key={product.sku}
                onClick={() => go('/inventory', { q: product.sku })}
              >
                <span className="product-rank">0{index + 1}</span>
                <ProductImage product={product} small />
                <div>
                  <strong>{product.name}</strong>
                  <span>{product.category}</span>
                </div>
                <span className="product-unit-count">
                  {units}
                  <span>units</span>
                </span>
              </button>
            ))}
          </section>
        </div>
        <section className="warehouse-strip">
          <div className="warehouse-strip-title">
            <Warehouse size={22} weight="duotone" />
            <div>
              <strong>Your warehouse network</strong>
              <span>Three locations. One connected view.</span>
            </div>
          </div>
          {warehouses.map((item) => {
            const balances = stock.filter((row) => row.warehouse === item.id)
            return (
              <button
                key={item.id}
                className={`warehouse-strip-item ${warehouse === item.id ? 'selected' : ''}`}
                onClick={() => go('/inventory', { warehouse: item.id })}
              >
                <span className="warehouse-code">{item.code}</span>
                <strong>{getWarehouse(item.id).city}</strong>
                <span>
                  {count(balances.reduce((sum, row) => sum + available(row), 0))} available units
                </span>
                <ArrowUpRight size={16} />
              </button>
            )
          })}
        </section>
      </DataBoundary>
    </>
  )
}
