import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { Barcode } from '@phosphor-icons/react/dist/csr/Barcode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIdentity, useProfile } from '@/lib/identity-context'
import { money, useResourceView } from '@/lib/inventory-client'
import type { Paginated, ProductRecord } from '@docklane/contracts'
import {
  ProductImage,
  ResourceHeading,
  ResourceState,
  ResourceEmpty,
  ResourcePagination,
} from './phase3-shared'
import { ProductEditor, ArchiveResource } from './resource-editors'

export default function ProductsWorkspace() {
  const { api } = useIdentity(),
    view = useResourceView(8)
  const admin = useProfile().data?.data.role === 'ADMIN'
  const [editor, setEditor] = useState<ProductRecord | null | undefined>(undefined)
  const [archive, setArchive] = useState<ProductRecord | null>(null)
  const query = useQuery({
    queryKey: ['phase3', 'products', view.query],
    queryFn: () => api<Paginated<ProductRecord>>(`/products?${view.query}`),
    placeholderData: keepPreviousData,
  })
  const categories = useQuery({
    queryKey: ['phase3', 'categories'],
    queryFn: () => api<{ data: string[] }>('/products/categories'),
  })
  return (
    <>
      <ResourceHeading
        title="Good products. Great beginnings."
        description="Your catalog, with the details every order depends on."
        action={
          admin && (
            <Button className="btn-primary" onClick={() => setEditor(null)}>
              <Plus size={17} />
              New product
            </Button>
          )
        }
      />
      <div className="p3-catalog-intro">
        <Barcode size={40} weight="duotone" />
        <div>
          <span className="auth-eyebrow">BUILT AROUND THE SKU</span>
          <h2>One identity. Every warehouse.</h2>
          <p>A product’s SKU connects its stock, movement history, and order snapshots.</p>
        </div>
        <Link className="text-link" to="/workspace/inventory">
          View stock
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <section className="panel p3-products-panel">
        <div className="p3-filters">
          <Input
            aria-label="Search saved products"
            placeholder="Search product or SKU…"
            value={view.params.get('q') ?? ''}
            onChange={(event) => view.update({ q: event.target.value })}
          />
          <select
            aria-label="Filter product category"
            value={view.params.get('category') ?? ''}
            onChange={(event) => view.update({ category: event.target.value })}
          >
            <option value="">All categories</option>
            {categories.data?.data.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          <select
            aria-label="Filter product status"
            value={view.params.get('archive') ?? 'active'}
            onChange={(event) =>
              view.update({ archive: event.target.value === 'active' ? null : event.target.value })
            }
          >
            <option value="active">Active products</option>
            <option value="archived">Archived products</option>
            <option value="all">All products</option>
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
          <div className="table-scroll" role="region" aria-label="Saved products" tabIndex={0}>
            <table className="data-table p3-products-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Product actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((product) => (
                  <tr key={product.sku}>
                    <td>
                      <div className="p3-product-cell">
                        <ProductImage src={product.image} />
                        <div>
                          <strong>{product.name}</strong>
                          <small className="mono">{product.sku}</small>
                        </div>
                      </div>
                    </td>
                    <td>{product.category}</td>
                    <td className="numeric">{money(product.pricePaise)}</td>
                    <td>
                      <span className={`connected-badge ${product.archived ? '' : 'good'}`}>
                        {product.archived ? 'Archived' : 'Active'}
                      </span>
                    </td>
                    <td>
                      <div className="p3-row-actions">
                        <Link
                          className="text-link"
                          to={`/workspace/inventory?q=${encodeURIComponent(product.sku)}${product.archived ? '&archive=all' : ''}`}
                          aria-label={`View stock for ${product.name}`}
                        >
                          Stock
                          <ArrowUpRight size={14} />
                        </Link>
                        {admin && (
                          <>
                            <button
                              className="text-link"
                              aria-label={`Edit ${product.name}`}
                              onClick={() => setEditor(product)}
                            >
                              Edit
                            </button>
                            <button
                              className="text-link muted"
                              aria-label={`${product.archived ? 'Restore' : 'Archive'} ${product.name}`}
                              onClick={() => setArchive(product)}
                            >
                              {product.archived ? 'Restore' : 'Archive'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ResourceEmpty
            title={view.params.size ? 'Nothing matches this view.' : 'Your catalog starts here.'}
            description={
              view.params.size
                ? 'Try another search or clear the filters.'
                : 'Create your first product to give your stock a clear identity.'
            }
            clear={view.params.size ? view.clear : undefined}
          />
        )}
        {query.data && (
          <ResourcePagination
            pagination={query.data.pagination}
            update={view.update}
            noun="products"
          />
        )}
      </section>
      <p className="p3-footnote">
        Catalog prices are saved in INR. Editing a price preserves every existing order’s original
        amount.
      </p>
      {editor !== undefined && (
        <ProductEditor product={editor} close={() => setEditor(undefined)} />
      )}
      {archive && (
        <ArchiveResource resource={archive} kind="product" close={() => setArchive(null)} />
      )}
    </>
  )
}
