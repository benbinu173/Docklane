import { useMemo } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown } from '@phosphor-icons/react/dist/csr/ArrowDown'
import { ArrowUp } from '@phosphor-icons/react/dist/csr/ArrowUp'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowsDownUp } from '@phosphor-icons/react/dist/csr/ArrowsDownUp'
import { CaretLeft } from '@phosphor-icons/react/dist/csr/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight'
import { DownloadSimple } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { X } from '@phosphor-icons/react/dist/csr/X'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataBoundary, EmptyResults, PageHeader, StageBadge } from '@/components/shared'
import { WarehouseSelect } from '@/components/workspace-shell'
import { useDemo } from '@/lib/demo-context'
import { useWorkspace } from '@/hooks/use-workspace'
import { downloadCsv } from '@/lib/export'
import {
  getWarehouse,
  money,
  orderTotal,
  orderUnits,
  stageLabels,
  time,
  type Order,
} from '@/data/demo'

export default function Orders() {
  const { orders } = useDemo()
  const { warehouse, params, update } = useWorkspace()
  const query = params.get('q') ?? ''
  const stage = params.get('stage') ?? 'all'
  const sorting: SortingState = params.get('sort')
    ? [{ id: params.get('sort')!.split(':')[0], desc: params.get('sort')!.endsWith(':desc') }]
    : []
  const warehouseOrders = useMemo(
    () => orders.filter((order) => warehouse === 'all' || order.warehouse === warehouse),
    [orders, warehouse],
  )
  const filtered = useMemo(
    () =>
      warehouseOrders.filter(
        (order) =>
          `${order.id} ${order.customer} ${order.email}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()) &&
          (stage === 'all' ||
            stage === order.stage ||
            (stage === 'open' && ['awaiting', 'ready', 'packed'].includes(order.stage))),
      ),
    [warehouseOrders, query, stage],
  )
  const pageIndex = Math.max(
    0,
    Math.min(Number(params.get('page') ?? 1) - 1 || 0, Math.ceil(filtered.length / 8) - 1),
  )
  const columns: ColumnDef<Order>[] = [
    {
      accessorKey: 'id',
      header: 'Order',
      cell: ({ row }) => (
        <button
          className="order-id"
          data-order-id={row.original.id}
          aria-label={`Open order ${row.original.id}`}
          onClick={() => update({ order: row.original.id })}
        >
          {row.original.id}
        </button>
      ),
    },
    {
      accessorKey: 'customer',
      header: 'Customer',
      cell: ({ row }) => (
        <div className="customer-cell">
          <span className="avatar customer-avatar" style={{ background: row.original.avatarColor }}>
            {row.original.initials}
          </span>
          <div>
            <strong>{row.original.customer}</strong>
            <span>{row.original.email}</span>
          </div>
        </div>
      ),
    },
    {
      id: 'units',
      accessorFn: orderUnits,
      header: 'Items',
      cell: ({ getValue }) => <span className="muted">{getValue<number>()} units</span>,
    },
    {
      accessorKey: 'stage',
      header: 'Status',
      cell: ({ row }) => <StageBadge stage={row.original.stage} />,
      enableSorting: false,
    },
    {
      id: 'warehouse',
      accessorFn: (order) => getWarehouse(order.warehouse).city,
      header: 'Warehouse',
    },
    {
      id: 'total',
      accessorFn: orderTotal,
      header: 'Amount',
      cell: ({ getValue }) => <strong className="numeric">{money(getValue<number>())}</strong>,
    },
    {
      accessorKey: 'createdAt',
      header: 'Placed at',
      cell: ({ getValue }) => <span className="muted tiny">{time(getValue<string>())}</span>,
    },
    {
      id: 'open',
      header: () => <span className="sr-only">Open order</span>,
      cell: ({ row }) => (
        <button
          className="icon-button row-open"
          aria-label={`View details for ${row.original.id}`}
          onClick={() => update({ order: row.original.id })}
        >
          <ArrowUpRight size={17} />
        </button>
      ),
      enableSorting: false,
    },
  ]
  const table = useReactTable({
    data: filtered,
    columns,
    defaultColumn: { sortDescFirst: false },
    state: { sorting, pagination: { pageIndex, pageSize: 8 } },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      update({
        sort: next[0] ? `${next[0].id}:${next[0].desc ? 'desc' : 'asc'}` : null,
        page: null,
      })
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater({ pageIndex, pageSize: 8 }) : updater
      update({ page: String(next.pageIndex + 1) })
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  })
  function clearFilters() {
    update({ q: null, stage: null, warehouse: null, page: null, sort: null })
  }
  return (
    <>
      <PageHeader
        title="Every order, accounted for."
        description="From the first reservation to the final handoff. Follow every step."
      >
        <WarehouseSelect />
        <Button
          className="btn-primary"
          onClick={() =>
            downloadCsv('docklane-orders-demo.csv', [
              ['Order', 'Customer', 'Status', 'Warehouse', 'Amount INR', 'Placed at'],
              ...table
                .getPrePaginationRowModel()
                .rows.map(({ original: order }) => [
                  order.id,
                  order.customer,
                  stageLabels[order.stage],
                  getWarehouse(order.warehouse).name,
                  orderTotal(order) / 100,
                  order.createdAt,
                ]),
            ])
          }
        >
          <DownloadSimple size={17} />
          Export orders
        </Button>
      </PageHeader>
      <DataBoundary>
        <section className="panel orders-panel">
          <div className="filter-tabs order-tabs" aria-label="Filter orders by status">
            {[
              ['all', 'All orders', warehouseOrders.length],
              [
                'open',
                'Open',
                warehouseOrders.filter((order) =>
                  ['awaiting', 'ready', 'packed'].includes(order.stage),
                ).length,
              ],
              [
                'awaiting',
                'Awaiting payment',
                warehouseOrders.filter((order) => order.stage === 'awaiting').length,
              ],
              [
                'ready',
                'Ready to pack',
                warehouseOrders.filter((order) => order.stage === 'ready').length,
              ],
              [
                'packed',
                'Packed',
                warehouseOrders.filter((order) => order.stage === 'packed').length,
              ],
              [
                'shipped',
                'Shipped',
                warehouseOrders.filter((order) => order.stage === 'shipped').length,
              ],
            ].map(([value, label, total]) => (
              <button
                key={value}
                className={stage === value ? 'selected' : ''}
                aria-pressed={stage === value}
                onClick={() => update({ stage: String(value), page: null })}
              >
                {label}
                <span>{total}</span>
              </button>
            ))}
          </div>
          <div className="inventory-toolbar">
            <div className="search-field">
              <MagnifyingGlass size={18} />
              <Input
                aria-label="Search orders"
                placeholder="Search orders or customers..."
                value={query}
                onChange={(event) => update({ q: event.target.value, page: null })}
              />
              {query && (
                <button
                  aria-label="Clear order search"
                  onClick={() => update({ q: null, page: null })}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {(query || stage !== 'all' || warehouse !== 'all') && (
              <button className="clear-filters" onClick={clearFilters}>
                Clear filters
                <X size={14} />
              </button>
            )}
            <span className="result-count">{filtered.length} orders</span>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Orders table">
            <table className="data-table orders-table">
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        aria-sort={
                          header.column.getIsSorted() === 'asc'
                            ? 'ascending'
                            : header.column.getIsSorted() === 'desc'
                              ? 'descending'
                              : undefined
                        }
                      >
                        {header.column.getCanSort() ? (
                          <button
                            className="sort-header"
                            aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getIsSorted() === 'asc' ? (
                              <ArrowUp size={13} />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ArrowDown size={13} />
                            ) : (
                              <ArrowsDownUp size={12} className="sort-icon" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <EmptyResults title="No orders match this view" onClear={clearFilters} />
          )}
          <div className="table-footer">
            <span>
              {filtered.length
                ? `Showing ${pageIndex * 8 + 1}–${Math.min((pageIndex + 1) * 8, filtered.length)} of ${filtered.length} orders`
                : 'No matching orders'}
            </span>
            <div className="pagination">
              <button
                aria-label="Previous orders page"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <CaretLeft size={16} />
              </button>
              <span>
                Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
              </span>
              <button
                aria-label="Next orders page"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <CaretRight size={16} />
              </button>
            </div>
          </div>
        </section>
        <div className="order-note">
          <span className="note-line" />
          <p>
            Stock stays reserved from checkout through packing. Shipment is the point where physical
            stock moves.
          </p>
          <span className="subtle-pill">Sample orders</span>
        </div>
      </DataBoundary>
    </>
  )
}
