import { useRef, useState, type FormEvent } from 'react'
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIdentity } from '@/lib/identity-context'
import {
  useResourceView,
  useStockOptions,
  useRefreshStock,
  timestamp,
  type InventoryPage,
} from '@/lib/inventory-client'
import {
  stockAdjustmentSchema,
  type InventoryRecord,
  type StockMovement,
  type StockAdjustment,
  type AdjustmentResult,
  type Paginated,
  type WarehouseRecord,
} from '@docklane/contracts'
import {
  ResourceHeading,
  ResourceState,
  ResourceEmpty,
  ResourcePagination,
  ProductImage,
  StockBadge,
} from './phase3-shared'

export function InventoryWorkspace() {
  const { api } = useIdentity()
  const view = useResourceView()
  const [warehouseSearch, setWarehouseSearch] = useState('')
  const options = useStockOptions({ warehouseSearch })
  const categories = useQuery({
    queryKey: ['phase3', 'categories'],
    queryFn: () => api<{ data: string[] }>('/products/categories'),
  })
  const selectedWarehouseId = view.params.get('warehouse')
  const selectedWarehouse = useQuery({
    queryKey: ['phase3', 'warehouse', selectedWarehouseId],
    queryFn: () =>
      api<{ data: WarehouseRecord }>(`/warehouses/${encodeURIComponent(selectedWarehouseId!)}`),
    enabled:
      !!selectedWarehouseId &&
      !options.warehouses.data?.data.some((warehouse) => warehouse.id === selectedWarehouseId),
  })
  const [tracking, setTracking] = useState(false)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const query = useQuery({
    queryKey: ['phase3', 'inventory', view.query],
    queryFn: () => api<InventoryPage>(`/inventory?${view.query}`),
    placeholderData: keepPreviousData,
  })
  const summary = query.data?.summary
  const stockId = view.params.get('stockId')
  const sort = view.params.get('sort') ?? 'product'
  function sorting(key: string) {
    view.update({
      sort: key,
      direction: key === sort && view.params.get('direction') !== 'desc' ? 'desc' : 'asc',
    })
  }
  return (
    <>
      <ResourceHeading
        title="Stock, with a clear story."
        description="Every product, every warehouse, and a count you can trace."
        action={
          <Button className="btn-primary" onClick={() => setTracking(true)}>
            <Plus size={17} />
            Track stock
          </Button>
        }
      />
      <div className="p3-stock-summary">
        <span className="p3-summary-icon">
          <Cube size={28} weight="duotone" />
        </span>
        <div>
          <strong>{summary?.levels ?? '…'} stock levels</strong>
          <p>Across the products and warehouses in this view.</p>
        </div>
        <dl>
          <div>
            <dt>Available</dt>
            <dd>{summary?.available.toLocaleString('en-IN') ?? '…'}</dd>
          </div>
          <div>
            <dt>Reserved</dt>
            <dd>{summary?.reserved.toLocaleString('en-IN') ?? '…'}</dd>
          </div>
          <div>
            <dt>Need attention</dt>
            <dd>{summary ? summary.low + summary.out : '…'}</dd>
          </div>
        </dl>
      </div>
      <section className="panel p3-inventory-panel">
        <div className="p3-tabs" aria-label="Stock views">
          {[
            ['all', 'All stock', summary?.levels],
            ['low', 'Low stock', summary?.low],
            ['reserved', 'Reserved', summary?.withReservations],
            ['out', 'Out of stock', summary?.out],
          ].map(([value, label, count]) => (
            <button
              key={value}
              className={(view.params.get('stock') ?? 'all') === value ? 'active' : ''}
              aria-pressed={(view.params.get('stock') ?? 'all') === value}
              onClick={() => view.update({ stock: value === 'all' ? null : String(value) })}
            >
              {label}
              <span>{count ?? '…'}</span>
            </button>
          ))}
        </div>
        <div className="p3-filters">
          <Input
            aria-label="Search saved inventory"
            placeholder="Search product or SKU…"
            value={view.params.get('q') ?? ''}
            onChange={(event) => view.update({ q: event.target.value })}
          />
          <select
            aria-label="Filter stock warehouse"
            value={view.params.get('warehouse') ?? ''}
            onChange={(event) => view.update({ warehouse: event.target.value })}
          >
            <option value="">All warehouses</option>
            {selectedWarehouseId &&
              !options.warehouses.data?.data.some(
                (warehouse) => warehouse.id === selectedWarehouseId,
              ) && (
                <option value={selectedWarehouseId}>
                  {selectedWarehouse.data?.data.name ?? 'Selected warehouse'}
                </option>
              )}
            {options.warehouses.data?.data.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
                {warehouse.archived ? ' · Archived' : ''}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter stock category"
            value={view.params.get('category') ?? ''}
            onChange={(event) => view.update({ category: event.target.value })}
          >
            <option value="">All categories</option>
            {categories.data?.data.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          {((options.warehouses.data?.pagination.total ?? 0) > 100 || warehouseSearch) && (
            <Input
              aria-label="Search warehouse choices"
              placeholder="Find a warehouse by name or code…"
              value={warehouseSearch}
              onChange={(event) => setWarehouseSearch(event.target.value)}
              maxLength={100}
            />
          )}
          <select
            aria-label="Filter stock record status"
            value={view.params.get('archive') ?? 'active'}
            onChange={(event) =>
              view.update({ archive: event.target.value === 'active' ? null : event.target.value })
            }
          >
            <option value="active">Active records</option>
            <option value="all">Include archived</option>
            <option value="archived">Archived records</option>
          </select>
          {view.params.size > 0 && (
            <button className="text-link" onClick={view.clear}>
              Clear filters
            </button>
          )}
        </div>
        <div aria-busy={query.isFetching}>
          {query.isPlaceholderData && (
            <p className="p3-updating" role="status">
              Updating this view…
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
          ) : query.data.data.length ? (
            <div className="table-scroll" role="region" aria-label="Saved inventory" tabIndex={0}>
              <table className="data-table p3-inventory-table">
                <thead>
                  <tr>
                    {[
                      ['product', 'Product'],
                      ['warehouse', 'Warehouse'],
                      ['onHand', 'On hand'],
                      ['reserved', 'Reserved'],
                      ['available', 'Available'],
                    ].map(([key, label]) => (
                      <th
                        key={key}
                        aria-sort={
                          sort === key
                            ? view.params.get('direction') === 'desc'
                              ? 'descending'
                              : 'ascending'
                            : 'none'
                        }
                      >
                        <button
                          onClick={() => sorting(key)}
                          aria-label={`Sort saved stock by ${label}`}
                        >
                          {label}
                          <span aria-hidden="true">
                            {sort === key
                              ? view.params.get('direction') === 'desc'
                                ? '↓'
                                : '↑'
                              : '↕'}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th>Stock status</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.map((stock) => (
                    <tr key={stock.id}>
                      <td>
                        <button
                          className="p3-product-open"
                          onClick={(event) => {
                            returnFocus.current = event.currentTarget
                            view.update({ stockId: stock.id }, false)
                          }}
                        >
                          <span className="sr-only">Open stock </span>
                          <ProductImage src={stock.product.image} />
                          <span>
                            <strong>{stock.product.name}</strong>
                            <small className="mono">{stock.sku}</small>
                          </span>
                          <ArrowUpRight size={15} />
                          <span className="sr-only"> at {stock.warehouse.name}</span>
                        </button>
                      </td>
                      <td>
                        <strong>{stock.warehouse.city}</strong>
                        <small className="mono">{stock.warehouse.code}</small>
                      </td>
                      <td className="numeric">{stock.onHand}</td>
                      <td className="numeric">{stock.reserved}</td>
                      <td className="numeric p3-available">
                        {stock.available}
                        <span className="p3-stock-bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${stock.onHand ? (stock.available / stock.onHand) * 100 : 0}%`,
                            }}
                          />
                          <span
                            style={{
                              width: `${stock.onHand ? (stock.reserved / stock.onHand) * 100 : 0}%`,
                            }}
                          />
                        </span>
                      </td>
                      <td>
                        <StockBadge
                          available={stock.available}
                          threshold={stock.threshold}
                          archived={stock.product.archived || stock.warehouse.archived}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ResourceEmpty clear={view.clear} />
          )}
        </div>
        {query.data && (
          <ResourcePagination
            pagination={query.data.pagination}
            update={view.update}
            noun="stock levels"
          />
        )}
      </section>
      <p className="p3-footnote">
        Available stock = on hand − reserved. Stock corrections keep every reserved unit protected.
      </p>
      <Dialog
        open={!!stockId}
        onOpenChange={(open) => {
          if (!open) view.update({ stockId: null }, false)
        }}
      >
        <DialogContent
          className="p3-drawer"
          centered={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current?.isConnected) returnFocus.current.focus()
            else document.getElementById('connected-main')?.focus()
          }}
        >
          <StockInspector key={stockId} id={stockId} />
        </DialogContent>
      </Dialog>
      <TrackStock
        open={tracking}
        close={() => setTracking(false)}
        onCreated={(id) => {
          setTracking(false)
          view.update(
            {
              stockId: id,
              q: null,
              warehouse: null,
              category: null,
              stock: null,
              page: null,
              archive: null,
            },
            false,
          )
        }}
      />
    </>
  )
}
function TrackStock({
  open,
  close,
  onCreated,
}: {
  open: boolean
  close: () => void
  onCreated: (id: string) => void
}) {
  const { api } = useIdentity(),
    refresh = useRefreshStock()
  const [productSearch, setProductSearch] = useState(''),
    [warehouseSearch, setWarehouseSearch] = useState('')
  const options = useStockOptions({ productSearch, warehouseSearch, archive: 'active' })
  const mutation = useMutation({
    mutationFn: (body: { sku: string; warehouseId: string }) =>
      api<{ data: { id: string } }>('/inventory', { method: 'POST', body }),
    onSuccess: async (result) => {
      await refresh()
      toast.success('Stock level created. Record your opening count next.')
      onCreated(result.data.id)
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    mutation.mutate({ sku: String(form.get('sku')), warehouseId: String(form.get('warehouseId')) })
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !mutation.isPending) close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give a product a place.</DialogTitle>
          <DialogDescription>
            Track a product at a warehouse. Its stock starts at zero; record an adjustment when you
            receive or count goods.
          </DialogDescription>
        </DialogHeader>
        <form className="p3-form" onSubmit={submit}>
          <fieldset disabled={mutation.isPending}>
            {((options.products.data?.pagination.total ?? 0) > 100 || productSearch) && (
              <label>
                Find a product
                <Input
                  aria-label="Find a product"
                  placeholder="Product name or SKU…"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  maxLength={100}
                />
              </label>
            )}
            <label>
              Product
              <select name="sku" required defaultValue="">
                <option value="" disabled>
                  Choose a product
                </option>
                {options.products.data?.data
                  .filter((product) => !product.archived)
                  .map((product) => (
                    <option key={product.sku} value={product.sku}>
                      {product.name} · {product.sku}
                    </option>
                  ))}
              </select>
            </label>
            {((options.warehouses.data?.pagination.total ?? 0) > 100 || warehouseSearch) && (
              <label>
                Find a warehouse
                <Input
                  aria-label="Find a warehouse"
                  placeholder="Warehouse name or code…"
                  value={warehouseSearch}
                  onChange={(event) => setWarehouseSearch(event.target.value)}
                  maxLength={100}
                />
              </label>
            )}
            <label>
              Warehouse
              <select name="warehouseId" required defaultValue="">
                <option value="" disabled>
                  Choose a warehouse
                </option>
                {options.warehouses.data?.data
                  .filter((warehouse) => !warehouse.archived)
                  .map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
              </select>
            </label>
            {(options.products.isError || options.warehouses.isError) && (
              <p className="auth-error" role="alert">
                We couldn’t load the product and warehouse choices. Close this form and try again.
              </p>
            )}
            {mutation.isError && (
              <p className="auth-error" role="alert">
                {mutation.error.message}
              </p>
            )}
            <div className="p3-form-actions">
              <Button type="button" className="btn-secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" className="btn-primary" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating…' : 'Create stock level'}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
function StockInspector({ id }: { id: string | null }) {
  const { api } = useIdentity()
  const query = useQuery({
    queryKey: ['phase3', 'stock', id],
    queryFn: () => api<{ data: InventoryRecord }>(`/inventory/${encodeURIComponent(id!)}`),
    enabled: !!id,
  })
  return (
    <>
      <DialogHeader className="p3-drawer-header">
        <span className="auth-eyebrow">EVERY COUNT, ACCOUNTED FOR</span>
        <DialogTitle>{query.data?.data.product.name ?? 'Stock details'}</DialogTitle>
        <DialogDescription>
          {query.data
            ? `${query.data.data.sku} · ${query.data.data.warehouse.name}`
            : 'View the stock balance, make a correction, or follow its movement history.'}
        </DialogDescription>
      </DialogHeader>
      <div className="p3-drawer-body">
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
          <StockContent
            key={`${id}:${query.data.data.version}`}
            stock={query.data.data}
            reload={() => {
              void query.refetch()
            }}
          />
        )}
      </div>
    </>
  )
}
function StockContent({ stock, reload }: { stock: InventoryRecord; reload: () => void }) {
  const { api } = useIdentity(),
    refresh = useRefreshStock()
  const [review, setReview] = useState<StockAdjustment | null>(null)
  const [validation, setValidation] = useState('')
  const [lastCommand, setLastCommand] = useState<StockAdjustment | null>(null)
  const adjustment = useMutation({
    mutationFn: (body: StockAdjustment) =>
      api<{ data: AdjustmentResult }>(`/inventory/${encodeURIComponent(stock.id)}/adjustments`, {
        method: 'POST',
        body,
      }),
    onSuccess: async () => {
      await refresh()
      setReview(null)
      setLastCommand(null)
      toast.success('Stock adjusted. The count and movement are saved.')
    },
  })
  const threshold = useMutation({
    mutationFn: (body: { threshold: number; reason: string; expectedVersion: number }) =>
      api(`/inventory/${encodeURIComponent(stock.id)}/threshold`, { method: 'PATCH', body }),
    onSuccess: async () => {
      await refresh()
      toast.success('Reorder threshold updated.')
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = {
      type: String(form.get('type')),
      quantity: Number(form.get('quantity')),
      reason: String(form.get('reason')).trim(),
      expectedVersion: stock.version,
    }
    const previous = lastCommand
    const key =
      previous &&
      previous.type === body.type &&
      previous.quantity === body.quantity &&
      previous.reason === body.reason &&
      previous.expectedVersion === body.expectedVersion
        ? previous.idempotencyKey
        : crypto.randomUUID()
    const result = stockAdjustmentSchema.safeParse({ ...body, idempotencyKey: key })
    if (!result.success) {
      setValidation(result.error.issues[0].message)
      return
    }
    setValidation('')
    adjustment.reset()
    setReview(result.data)
    setLastCommand(result.data)
  }
  const next = review
    ? review.type === 'SET'
      ? review.quantity
      : stock.onHand + (review.type === 'INCREASE' ? review.quantity : -review.quantity)
    : stock.onHand
  return (
    <>
      <div className="p3-drawer-product">
        <ProductImage src={stock.product.image} />
        <div>
          <StockBadge
            available={stock.available}
            threshold={stock.threshold}
            archived={stock.product.archived || stock.warehouse.archived}
          />
          <p>Updated {timestamp(stock.updatedAt)}</p>
        </div>
      </div>
      <dl className="p3-stock-counts">
        {[
          ['On hand', stock.onHand],
          ['Reserved', stock.reserved],
          ['Available', stock.available],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className="p3-adjustment">
        <h3>A count worth keeping.</h3>
        <p>
          Add received stock, remove damaged goods, or correct a physical count. Give every change a
          reason.
        </p>
        {review ? (
          <div className="p3-review" aria-label="Review stock adjustment">
            <span className="auth-eyebrow">REVIEW YOUR CHANGE</span>
            <div className="p3-count-change">
              <strong>{stock.onHand}</strong>
              <span>→</span>
              <strong>{next}</strong>
              <small>on hand</small>
            </div>
            <p>{review.reason}</p>
            <small>{stock.reserved} reserved units stay protected.</small>
            {next < stock.reserved && (
              <p className="auth-error" role="alert">
                This count would consume reserved stock. Keep at least {stock.reserved} units on
                hand.
              </p>
            )}
            {next === stock.onHand && (
              <p className="p3-form-note">This count is already saved. No adjustment is needed.</p>
            )}
            {adjustment.isError && (
              <p className="auth-error" role="alert">
                {adjustment.error.message}
              </p>
            )}
            <div className="p3-form-actions">
              <Button
                className="btn-secondary"
                disabled={adjustment.isPending}
                onClick={() => setReview(null)}
              >
                Edit change
              </Button>
              <Button
                className="btn-primary"
                disabled={adjustment.isPending || next < stock.reserved || next === stock.onHand}
                onClick={() => adjustment.mutate(review)}
              >
                {adjustment.isPending ? 'Saving…' : 'Confirm adjustment'}
              </Button>
            </div>
            {adjustment.isError && (
              <button className="text-link" onClick={reload}>
                Reload latest count
              </button>
            )}
          </div>
        ) : (
          <form className="p3-form" onSubmit={submit}>
            <fieldset disabled={adjustment.isPending || threshold.isPending}>
              <label>
                Adjustment type
                <select name="type" defaultValue={lastCommand?.type ?? 'INCREASE'}>
                  <option value="INCREASE">Add stock</option>
                  <option value="DECREASE">Remove stock</option>
                  <option value="SET">Set physical count</option>
                </select>
              </label>
              <div className="p3-two-fields">
                <label>
                  Quantity
                  <Input
                    name="quantity"
                    type="number"
                    min={0}
                    max={1_000_000_000}
                    step={1}
                    required
                    placeholder="0"
                    defaultValue={lastCommand?.quantity}
                  />
                </label>
                <div className="p3-protected">
                  <span>Reserved</span>
                  <strong>{stock.reserved} units</strong>
                </div>
              </div>
              <label>
                Reason
                <Input
                  name="reason"
                  required
                  minLength={5}
                  maxLength={300}
                  placeholder="e.g. Received a supplier delivery"
                  defaultValue={lastCommand?.reason}
                />
              </label>
              {validation && (
                <p className="auth-error" role="alert">
                  {validation}
                </p>
              )}
              <Button type="submit" className="btn-primary full-width">
                Review adjustment
              </Button>
            </fieldset>
          </form>
        )}
      </section>
      <details className="p3-threshold">
        <summary>
          Reorder threshold<span>{stock.threshold} units</span>
        </summary>
        <p>Flag this stock level when available units reach the threshold.</p>
        <form
          className="p3-form"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            threshold.mutate({
              threshold: Number(form.get('threshold')),
              reason: String(form.get('reason')),
              expectedVersion: stock.version,
            })
          }}
        >
          <fieldset disabled={threshold.isPending || adjustment.isPending}>
            <label>
              Threshold
              <Input
                name="threshold"
                type="number"
                min={0}
                step={1}
                max={1_000_000_000}
                required
                defaultValue={stock.threshold}
              />
            </label>
            <label>
              Reason for threshold change
              <Input
                name="reason"
                required
                minLength={5}
                maxLength={300}
                placeholder="e.g. Updated replenishment schedule"
              />
            </label>
            {threshold.isError && (
              <button type="button" className="text-link" onClick={reload}>
                Reload latest count
              </button>
            )}
            {threshold.isError && (
              <p className="auth-error" role="alert">
                {threshold.error.message}
              </p>
            )}
            <Button type="submit" className="btn-secondary" disabled={threshold.isPending}>
              {threshold.isPending ? 'Saving…' : 'Save threshold'}
            </Button>
          </fieldset>
        </form>
      </details>
      <StockHistory id={stock.id} />
    </>
  )
}
function StockHistory({ id }: { id: string }) {
  const { api } = useIdentity(),
    [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['phase3', 'movements', id, page],
    queryFn: () =>
      api<Paginated<StockMovement>>(
        `/inventory/${encodeURIComponent(id)}/movements?pageSize=5&page=${page}`,
      ),
  })
  const labels: Record<string, string> = {
    OPENING: 'Opening count',
    RESERVE: 'Stock reserved',
    RELEASE: 'Reservation released',
    SHIP: 'Stock shipped',
    ADJUST: 'Stock adjusted',
    RETURN: 'Return received',
  }
  return (
    <section className="p3-history">
      <div>
        <h3>Every movement has a reason.</h3>
        <span>{query.data?.pagination.total ?? '…'} entries</span>
      </div>
      {query.isPending ? (
        <ResourceState loading />
      ) : query.isError ? (
        <ResourceState
          error={query.error}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : query.data.data.length ? (
        <ol>
          {query.data.data.map((movement) => (
            <li key={movement.id}>
              <span className="p3-history-dot" />
              <div>
                <div className="p3-history-title">
                  <strong>{labels[movement.type] ?? movement.type}</strong>
                  <span>
                    {movement.deltaOnHand
                      ? `${movement.deltaOnHand > 0 ? '+' : ''}${movement.deltaOnHand} on hand`
                      : `${movement.deltaReserved > 0 ? '+' : ''}${movement.deltaReserved} reserved`}
                  </span>
                </div>
                <p>{movement.reason}</p>
                <small>
                  {movement.actor} · {timestamp(movement.createdAt)}
                  {movement.orderNumber ? ` · ${movement.orderNumber}` : ''}
                </small>
                <span className="p3-history-balance">
                  {movement.onHandAfter} on hand · {movement.reservedAfter} reserved
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Your first count will start this history.</p>
      )}
      {query.data && query.data.pagination.pages > 1 && (
        <div className="p3-history-pager">
          <Button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <span>
            {page} / {query.data.pagination.pages}
          </span>
          <Button
            className="btn-secondary"
            disabled={page >= query.data.pagination.pages}
            onClick={() => setPage(page + 1)}
          >
            Earlier
          </Button>
        </div>
      )}
    </section>
  )
}
