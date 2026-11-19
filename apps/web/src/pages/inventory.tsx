import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown } from '@phosphor-icons/react/dist/csr/ArrowDown'
import { ArrowUp } from '@phosphor-icons/react/dist/csr/ArrowUp'
import { ArrowsDownUp } from '@phosphor-icons/react/dist/csr/ArrowsDownUp'
import { CaretLeft } from '@phosphor-icons/react/dist/csr/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { DownloadSimple } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { X } from '@phosphor-icons/react/dist/csr/X'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataBoundary, EmptyResults, PageHeader, ProductName } from '@/components/shared'
import { WarehouseSelect } from '@/components/workspace-shell'
import { useWorkspace } from '@/hooks/use-workspace'
import { useDemo } from '@/lib/demo-context'
import { downloadCsv } from '@/lib/export'
import {
  available,
  count,
  getProduct,
  getWarehouse,
  isLow,
  products,
  type StockItem,
} from '@/data/demo'

export default function Inventory() {
  const { stock } = useDemo()
  const { warehouse, params, update } = useWorkspace()
  const query = params.get('q') ?? ''
  const stockFilter = params.get('stock') ?? 'all'
  const category = params.get('category') ?? 'all'
  const [selection, setSelection] = useState({})
  const sorting: SortingState = params.get('sort')
    ? [{ id: params.get('sort')!.split(':')[0], desc: params.get('sort')!.endsWith(':desc') }]
    : []
  const warehouseStock = useMemo(
    () => stock.filter((item) => warehouse === 'all' || item.warehouse === warehouse),
    [stock, warehouse],
  )
  const filtered = useMemo(
    () =>
      warehouseStock.filter((item) => {
        const product = getProduct(item.sku)
        const term = query.trim().toLowerCase()
        return (
          `${product.name} ${product.sku} ${product.category} ${getWarehouse(item.warehouse).name}`
            .toLowerCase()
            .includes(term) &&
          (category === 'all' || product.category === category) &&
          (stockFilter === 'all' ||
            (stockFilter === 'low' && isLow(item)) ||
            (stockFilter === 'reserved' && item.reserved > 0) ||
            (stockFilter === 'out' && available(item) === 0))
        )
      }),
    [warehouseStock, query, category, stockFilter],
  )
  const pageIndex = Math.max(
    0,
    Math.min(Number(params.get('page') ?? 1) - 1 || 0, Math.ceil(filtered.length / 8) - 1),
  )
  const columns: ColumnDef<StockItem>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all filtered stock"
          checked={
            table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select ${getProduct(row.original.sku).name} at ${getWarehouse(row.original.warehouse).city}`}
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      ),
      enableSorting: false,
    },
    {
      id: 'name',
      accessorFn: (item) => getProduct(item.sku).name,
      header: 'Product',
      cell: ({ row }) => (
        <button
          className="product-open"
          data-stock-id={row.original.id}
          aria-label={`Open ${getProduct(row.original.sku).name} ${row.original.sku} at ${getWarehouse(row.original.warehouse).city}`}
          onClick={() => update({ item: row.original.id })}
        >
          <ProductName sku={row.original.sku} />
        </button>
      ),
    },
    {
      id: 'warehouse',
      accessorFn: (item) => getWarehouse(item.warehouse).name,
      header: 'Warehouse',
      cell: ({ row }) => (
        <div className="warehouse-table-cell">
          <strong>{getWarehouse(row.original.warehouse).city}</strong>
          <span className="mono tiny muted">{getWarehouse(row.original.warehouse).code}</span>
        </div>
      ),
    },
    {
      accessorKey: 'onHand',
      header: 'On hand',
      cell: ({ getValue }) => <span className="numeric">{count(getValue<number>())}</span>,
    },
    {
      accessorKey: 'reserved',
      header: 'Reserved',
      cell: ({ getValue }) => (
        <span className={`numeric ${getValue<number>() ? '' : 'muted'}`}>
          {count(getValue<number>())}
        </span>
      ),
    },
    {
      id: 'available',
      accessorFn: available,
      header: 'Available',
      cell: ({ row }) => (
        <div className="availability-cell">
          <strong className={`numeric ${isLow(row.original) ? 'warning-text' : ''}`}>
            {count(available(row.original))}
            <span>units</span>
          </strong>
          <div
            className="stock-bar"
            role="img"
            aria-label={`${available(row.original)} available, ${row.original.reserved} reserved, ${row.original.onHand} on hand`}
          >
            <span
              className={isLow(row.original) ? 'low-fill' : ''}
              style={{
                width: `${row.original.onHand ? (available(row.original) / row.original.onHand) * 100 : 0}%`,
              }}
            />
            <i
              style={{
                width: `${row.original.onHand ? (row.original.reserved / row.original.onHand) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Stock status',
      cell: ({ row }) => (
        <span
          className={`stock-status ${available(row.original) === 0 ? 'out' : isLow(row.original) ? 'low' : 'healthy'}`}
        >
          <span />
          {available(row.original) === 0
            ? 'Out of stock'
            : isLow(row.original)
              ? 'Low stock'
              : 'In stock'}
        </span>
      ),
      enableSorting: false,
    },
  ]
  const table = useReactTable({
    data: filtered,
    columns,
    defaultColumn: { sortDescFirst: false },
    getRowId: (item) => item.id,
    state: { rowSelection: selection, sorting, pagination: { pageIndex, pageSize: 8 } },
    onRowSelectionChange: setSelection,
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
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  })
  const selected = table.getFilteredSelectedRowModel().rows
  function exportStock() {
    const rows = selected.length ? selected : table.getPrePaginationRowModel().rows
    downloadCsv('docklane-inventory-demo.csv', [
      ['Product', 'SKU', 'Warehouse', 'On hand', 'Reserved', 'Available', 'Reorder threshold'],
      ...rows.map(({ original: item }) => [
        getProduct(item.sku).name,
        item.sku,
        getWarehouse(item.warehouse).name,
        item.onHand,
        item.reserved,
        available(item),
        item.threshold,
      ]),
    ])
  }
  function clearFilters() {
    update({ q: null, warehouse: null, stock: null, category: null, page: null, sort: null })
    setSelection({})
  }
  const hasFilters = !!query || warehouse !== 'all' || category !== 'all' || stockFilter !== 'all'
  return (
    <>
      <PageHeader
        title="A place for every product."
        description="Know what’s available, what’s reserved, and what needs a little attention."
      >
        <WarehouseSelect />
        <Button className="btn-primary" onClick={exportStock}>
          <DownloadSimple size={17} />
          Export {selected.length ? `${selected.length} selected` : 'inventory'}
        </Button>
      </PageHeader>
      <DataBoundary>
        <div className="inventory-summary">
          <div>
            <span className="inventory-summary-icon">
              <Cube size={24} weight="duotone" />
            </span>
            <div>
              <strong>
                {new Set(warehouseStock.map((item) => item.sku)).size} products
                <span>
                  across{' '}
                  {warehouse === 'all'
                    ? '3 warehouses'
                    : getWarehouse(warehouse as StockItem['warehouse']).name}
                </span>
              </strong>
              <p>{warehouseStock.length} stock levels, all in one place.</p>
            </div>
          </div>
          <div className="inventory-summary-numbers">
            <span>
              <strong>
                {count(warehouseStock.reduce((sum, item) => sum + available(item), 0))}
              </strong>
              available units
            </span>
            <span>
              <strong>{count(warehouseStock.reduce((sum, item) => sum + item.reserved, 0))}</strong>
              reserved units
            </span>
            <span className="warning-text">
              <strong>{warehouseStock.filter(isLow).length}</strong>need attention
            </span>
          </div>
        </div>
        <section className="panel inventory-panel">
          <div className="inventory-panel-top">
            <div className="filter-tabs" aria-label="Filter inventory by stock status">
              {[
                ['all', 'All inventory', warehouseStock.length],
                ['low', 'Low stock', warehouseStock.filter(isLow).length],
                ['reserved', 'Reserved', warehouseStock.filter((item) => item.reserved > 0).length],
                [
                  'out',
                  'Out of stock',
                  warehouseStock.filter((item) => available(item) === 0).length,
                ],
              ].map(([value, label, total]) => (
                <button
                  key={value}
                  aria-pressed={stockFilter === value}
                  className={stockFilter === value ? 'selected' : ''}
                  onClick={() => update({ stock: String(value), page: null })}
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
                  aria-label="Search inventory"
                  placeholder="Search products or SKUs..."
                  value={query}
                  onChange={(event) => update({ q: event.target.value, page: null })}
                />
                {query && (
                  <button
                    aria-label="Clear inventory search"
                    onClick={() => update({ q: null, page: null })}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <Select
                value={category}
                onValueChange={(value) => update({ category: value, page: null })}
              >
                <SelectTrigger className="category-select" aria-label="Filter by category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {[...new Set(products.map((product) => product.category))].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFilters && (
                <button className="clear-filters" onClick={clearFilters}>
                  Clear filters
                  <X size={14} />
                </button>
              )}
              <span className="result-count">{filtered.length} results</span>
            </div>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Inventory table">
            <table className="data-table inventory-table">
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
                        className={
                          ['onHand', 'reserved', 'available'].includes(header.id)
                            ? 'number-column'
                            : ''
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
                  <tr key={row.id} data-selected={row.getIsSelected()}>
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
          {!filtered.length && <EmptyResults onClear={clearFilters} />}
          <div className="table-footer">
            <span>
              {selected.length
                ? `${selected.length} stock levels selected`
                : filtered.length
                  ? `Showing ${pageIndex * 8 + 1}–${Math.min((pageIndex + 1) * 8, filtered.length)} of ${filtered.length} stock levels`
                  : 'No stock levels match your filters'}
            </span>
            <div className="pagination">
              <button
                aria-label="Previous inventory page"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <CaretLeft size={16} />
              </button>
              <span>
                Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
              </span>
              <button
                aria-label="Next inventory page"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <CaretRight size={16} />
              </button>
            </div>
          </div>
        </section>
        <div className="inventory-footnote">
          <span>
            <i className="legend-available" />
            Available
          </span>
          <span>
            <i className="legend-reserved" />
            Reserved
          </span>
          <p>Available stock = on hand − reserved. Reorder threshold: 12 units per stock level.</p>
        </div>
      </DataBoundary>
    </>
  )
}
