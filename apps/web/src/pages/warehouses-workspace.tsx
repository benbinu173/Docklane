import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { Warehouse } from '@phosphor-icons/react/dist/csr/Warehouse'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIdentity, useProfile } from '@/lib/identity-context'
import { useResourceView, type InventoryPage } from '@/lib/inventory-client'
import type { Paginated, WarehouseRecord } from '@docklane/contracts'
import {
  ProductImage,
  ResourceHeading,
  ResourceState,
  ResourceEmpty,
  ResourcePagination,
  StockBadge,
} from './phase3-shared'
import { WarehouseEditor, ArchiveResource } from './resource-editors'

export default function WarehousesWorkspace() {
  const { api } = useIdentity(),
    view = useResourceView(6)
  const admin = useProfile().data?.data.role === 'ADMIN'
  const [editor, setEditor] = useState<WarehouseRecord | null | undefined>(undefined)
  const [archive, setArchive] = useState<WarehouseRecord | null>(null)
  const query = useQuery({
    queryKey: ['phase3', 'warehouses', view.query],
    queryFn: () => api<Paginated<WarehouseRecord>>(`/warehouses?${view.query}`),
    placeholderData: keepPreviousData,
  })
  return (
    <>
      <ResourceHeading
        title="Every place, connected."
        description="A clear view of the sites that keep your business moving."
        action={
          admin && (
            <Button className="btn-primary" onClick={() => setEditor(null)}>
              <Plus size={17} />
              New warehouse
            </Button>
          )
        }
      />
      <section className="p3-network">
        <div className="p3-network-heading">
          <span className="auth-eyebrow">YOUR WAREHOUSE NETWORK</span>
          <span>{query.data?.pagination.total ?? '…'} sites in this view</span>
        </div>
        <div className="p3-network-hub">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <span>Northstar Supply</span>
          <small>One business · Connected stock</small>
        </div>
        <div className="p3-network-sites">
          {query.data?.data.map((warehouse) => (
            <Link
              key={warehouse.id}
              to={`/workspace/warehouses/${encodeURIComponent(warehouse.id)}`}
              className={warehouse.archived ? 'archived' : ''}
            >
              <span className="sr-only">Explore warehouse {warehouse.name}. </span>
              <span className="p3-site-symbol">
                <Warehouse size={26} weight="duotone" />
              </span>
              <strong>{warehouse.city}</strong>
              <span className="mono">{warehouse.code}</span>
              <small>
                {warehouse.archived
                  ? 'Archived site'
                  : `${warehouse.available.toLocaleString('en-IN')} available`}
              </small>
            </Link>
          ))}
        </div>
        <p>Site overview · Select a warehouse to explore its stock.</p>
      </section>
      <section className="panel p3-warehouses-panel">
        <div className="p3-filters">
          <Input
            aria-label="Search saved warehouses"
            placeholder="Search site, city, or code…"
            value={view.params.get('q') ?? ''}
            onChange={(event) => view.update({ q: event.target.value })}
          />
          <select
            aria-label="Filter warehouse status"
            value={view.params.get('archive') ?? 'active'}
            onChange={(event) =>
              view.update({ archive: event.target.value === 'active' ? null : event.target.value })
            }
          >
            <option value="active">Active warehouses</option>
            <option value="archived">Archived warehouses</option>
            <option value="all">All warehouses</option>
          </select>
          {view.params.size > 0 && (
            <button className="text-link" onClick={view.clear}>
              Clear filters
            </button>
          )}
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
          <div className="p3-warehouse-list">
            {query.data.data.map((warehouse) => (
              <article key={warehouse.id}>
                <div className="p3-site-symbol">
                  <Warehouse size={27} weight="duotone" />
                </div>
                <div className="p3-site-name">
                  <span className="mono">
                    {warehouse.code} <span className="muted">/ {warehouse.city}</span>
                  </span>
                  <h2>
                    <Link to={`/workspace/warehouses/${encodeURIComponent(warehouse.id)}`}>
                      {warehouse.name}
                      <ArrowUpRight size={17} />
                    </Link>
                  </h2>
                  <p>
                    {warehouse.lead} · Site lead{warehouse.archived ? ' · Archived' : ''}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Available</dt>
                    <dd>{warehouse.available.toLocaleString('en-IN')}</dd>
                  </div>
                  <div>
                    <dt>Reserved</dt>
                    <dd>{warehouse.reserved.toLocaleString('en-IN')}</dd>
                  </div>
                  <div>
                    <dt>Stock levels</dt>
                    <dd>{warehouse.levels}</dd>
                  </div>
                </dl>
                {admin && (
                  <div className="p3-row-actions">
                    <button
                      className="text-link"
                      aria-label={`Edit ${warehouse.name}`}
                      onClick={() => setEditor(warehouse)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-link muted"
                      aria-label={`${warehouse.archived ? 'Restore' : 'Archive'} ${warehouse.name}`}
                      onClick={() => setArchive(warehouse)}
                    >
                      {warehouse.archived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <ResourceEmpty
            title={
              view.params.size ? 'Nothing matches this view.' : 'Your network starts with a place.'
            }
            description={
              view.params.size
                ? 'Try another search or clear the filters.'
                : 'Create a warehouse, then assign products to start tracking stock.'
            }
            clear={view.params.size ? view.clear : undefined}
          />
        )}
        {query.data && (
          <ResourcePagination
            pagination={query.data.pagination}
            update={view.update}
            noun="warehouses"
          />
        )}
      </section>
      {editor !== undefined && (
        <WarehouseEditor warehouse={editor} close={() => setEditor(undefined)} />
      )}
      {archive && (
        <ArchiveResource resource={archive} kind="warehouse" close={() => setArchive(null)} />
      )}
    </>
  )
}

export function WarehouseDetail() {
  const { id } = useParams(),
    { api } = useIdentity(),
    view = useResourceView(8)
  const admin = useProfile().data?.data.role === 'ADMIN'
  const [editing, setEditing] = useState(false),
    [archiving, setArchiving] = useState(false)
  const query = useQuery({
    queryKey: ['phase3', 'warehouse', id],
    queryFn: () => api<{ data: WarehouseRecord }>(`/warehouses/${encodeURIComponent(id!)}`),
  })
  const stock = useQuery({
    queryKey: ['phase3', 'warehouse-stock', id, view.query],
    queryFn: () =>
      api<InventoryPage>(
        `/inventory?${view.query}&warehouse=${encodeURIComponent(id!)}&archive=all`,
      ),
    enabled: !!query.data,
  })
  if (query.isPending) return <ResourceState loading />
  if (query.isError)
    return (
      <ResourceState
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  const warehouse = query.data.data
  return (
    <>
      <Link className="text-link p3-back" to="/workspace/warehouses">
        <ArrowLeft size={16} />
        Warehouse network
      </Link>
      <ResourceHeading
        title={warehouse.name}
        description={`${warehouse.code} · ${warehouse.city}${warehouse.archived ? ' · Archived' : ''}`}
        action={
          admin && (
            <div className="p3-row-actions">
              <Button className="btn-secondary" onClick={() => setArchiving(true)}>
                {warehouse.archived ? 'Restore warehouse' : 'Archive warehouse'}
              </Button>
              <Button className="btn-primary" onClick={() => setEditing(true)}>
                Edit warehouse
              </Button>
            </div>
          )
        }
      />
      <div className="p3-site-detail">
        <span className="p3-site-symbol">
          <Warehouse size={40} weight="duotone" />
        </span>
        <div>
          <span className="auth-eyebrow">A PLACE FOR EVERY PRODUCT</span>
          <p>{warehouse.address}</p>
          <small>
            {warehouse.lead} · Site lead · Fulfillment priority {warehouse.priority}
          </small>
        </div>
        <dl>
          <div>
            <dt>On hand</dt>
            <dd>{warehouse.onHand.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt>Reserved</dt>
            <dd>{warehouse.reserved.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{warehouse.available.toLocaleString('en-IN')}</dd>
          </div>
        </dl>
      </div>
      <section className="panel">
        <div className="connected-section-title">
          <div>
            <h2>What’s here, right now.</h2>
            <p>{warehouse.levels} tracked stock levels at this site.</p>
          </div>
          <Link
            className="text-link"
            to={`/workspace/inventory?warehouse=${encodeURIComponent(warehouse.id)}&archive=all`}
          >
            Manage stock
            <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="p3-filters">
          <Input
            aria-label="Search warehouse stock"
            placeholder="Search product or SKU…"
            value={view.params.get('q') ?? ''}
            onChange={(event) => view.update({ q: event.target.value })}
          />
        </div>
        {stock.isPending ? (
          <ResourceState loading />
        ) : stock.isError ? (
          <ResourceState
            error={stock.error}
            retry={() => {
              void stock.refetch()
            }}
          />
        ) : stock.data.data.length ? (
          <div className="table-scroll" role="region" aria-label="Warehouse stock" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>On hand</th>
                  <th>Reserved</th>
                  <th>Available</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stock.data.data.map((balance) => (
                  <tr key={balance.id}>
                    <td>
                      <Link
                        className="p3-product-cell"
                        to={`/workspace/inventory?warehouse=${encodeURIComponent(warehouse.id)}&archive=all&stockId=${encodeURIComponent(balance.id)}`}
                      >
                        <ProductImage src={balance.product.image} />
                        <div>
                          <strong>{balance.product.name}</strong>
                          <small className="mono">{balance.sku}</small>
                        </div>
                      </Link>
                    </td>
                    <td className="numeric">{balance.onHand}</td>
                    <td className="numeric">{balance.reserved}</td>
                    <td className="numeric p3-available">{balance.available}</td>
                    <td>
                      <StockBadge
                        available={balance.available}
                        threshold={balance.threshold}
                        archived={balance.product.archived || warehouse.archived}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ResourceEmpty
            title="No stock in this view."
            description="Track a product at this warehouse from the inventory workspace, or try another search."
          />
        )}
        {stock.data && (
          <ResourcePagination
            pagination={stock.data.pagination}
            update={view.update}
            noun="stock levels"
          />
        )}
      </section>
      {editing && <WarehouseEditor warehouse={warehouse} close={() => setEditing(false)} />}
      {archiving && (
        <ArchiveResource resource={warehouse} kind="warehouse" close={() => setArchiving(false)} />
      )}
    </>
  )
}
