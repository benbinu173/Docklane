import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { Package } from '@phosphor-icons/react/dist/csr/Package'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useIdentity, useProfile } from '@/lib/identity-context'
import { useCart } from '@/lib/cart-context'
import { money, useResourceView } from '@/lib/inventory-client'
import type { CatalogProduct, Paginated } from '@docklane/contracts'
import { ProductImage, ResourceState, ResourceEmpty, ResourcePagination } from './phase3-shared'

export default function CustomerCatalog() {
  const { api } = useIdentity(),
    view = useResourceView(8)
  const query = useQuery({
    queryKey: ['phase3', 'catalog', view.query],
    queryFn: () => api<Paginated<CatalogProduct>>(`/catalog?${view.query}`),
    placeholderData: keepPreviousData,
  })
  const categories = useQuery({
    queryKey: ['phase3', 'catalog-categories'],
    queryFn: () => api<{ data: string[] }>('/catalog/categories'),
  })
  return (
    <>
      <section className="p3-shop-intro">
        <div>
          <span className="auth-eyebrow">THE NORTHSTAR COLLECTION</span>
          <h1>
            Small finds.
            <br />
            Good everyday.
          </h1>
          <p>
            Useful things, thoughtful details. Find your next favorite in the Northstar Supply
            collection.
          </p>
          <span className="p3-shop-note">
            <Package size={18} />
            Find your favorite · Make it yours
          </span>
        </div>
        <div className="p3-shop-art" aria-hidden="true">
          <span className="p3-art-label">MADE FOR YOUR EVERYDAY</span>
          <div className="p3-art-parcel">
            <img src="/product-placeholder.svg" alt="" />
          </div>
          <span className="p3-art-stamp">
            NORTHSTAR
            <br />
            SUPPLY / 01
          </span>
        </div>
      </section>
      <div className="p3-shop-tools">
        <h2>Find something good.</h2>
        <Input
          aria-label="Search catalog"
          placeholder="Search the collection…"
          value={view.params.get('q') ?? ''}
          onChange={(event) => view.update({ q: event.target.value })}
        />
      </div>
      <div className="p3-shop-categories" aria-label="Catalog categories">
        <button
          className={!view.params.get('category') ? 'active' : ''}
          aria-pressed={!view.params.get('category')}
          onClick={() => view.update({ category: null })}
        >
          All products
        </button>
        {categories.data?.data.map((category) => (
          <button
            key={category}
            className={view.params.get('category') === category ? 'active' : ''}
            aria-pressed={view.params.get('category') === category}
            onClick={() => view.update({ category })}
          >
            {category}
          </button>
        ))}
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
        <div className="p3-shop-grid">
          {query.data.data.map((product) => (
            <Link
              className="p3-shop-product"
              key={product.sku}
              to={`/account/catalog/${encodeURIComponent(product.sku)}`}
            >
              <div className="p3-shop-image" style={{ backgroundColor: product.color }}>
                <ProductImage src={product.image} />
                <span className="p3-shop-open">
                  <ArrowUpRight size={20} />
                </span>
                {product.available === 0 && (
                  <span className="p3-sold-out">Currently out of stock</span>
                )}
              </div>
              <span className="p3-shop-category">{product.category}</span>
              <div className="p3-shop-product-title">
                <h3>{product.name}</h3>
                <strong>{money(product.pricePaise)}</strong>
              </div>
              <small>
                {product.available > 0
                  ? 'Available in our collection'
                  : 'Check back for availability'}
              </small>
            </Link>
          ))}
        </div>
      ) : (
        <ResourceEmpty
          title="No finds here yet."
          description="Try another search or explore a different category."
          clear={view.clear}
        />
      )}
      {query.data && (
        <ResourcePagination
          pagination={query.data.pagination}
          update={view.update}
          noun="products"
        />
      )}
    </>
  )
}

export function CatalogDetail() {
  const { sku } = useParams(),
    { api } = useIdentity()
  const cart = useCart(),
    profile = useProfile().data!.data,
    navigate = useNavigate()
  const [quantity, setQuantity] = useState(1)
  const query = useQuery({
    queryKey: ['phase3', 'catalog-product', sku],
    queryFn: () => api<{ data: CatalogProduct }>(`/catalog/${encodeURIComponent(sku!)}`),
  })
  return (
    <>
      <Link to="/account/catalog" className="text-link p3-back">
        <ArrowLeft size={16} />
        Back to the collection
      </Link>
      {query.isPending ? (
        <>
          <h1>Loading your selected item…</h1>
          <ResourceState loading />
        </>
      ) : query.isError ? (
        <>
          <h1>This item couldn’t be loaded.</h1>
          <ResourceState
            error={query.error}
            retry={() => {
              void query.refetch()
            }}
          />
        </>
      ) : (
        <section className="p3-product-detail">
          <div className="p3-detail-image" style={{ backgroundColor: query.data.data.color }}>
            <ProductImage src={query.data.data.image} />
          </div>
          <div className="p3-detail-copy">
            <span className="auth-eyebrow">{query.data.data.category.toUpperCase()}</span>
            <h1>{query.data.data.name}</h1>
            <strong className="p3-detail-price">{money(query.data.data.pricePaise)}</strong>
            <span className={`connected-badge ${query.data.data.available ? 'good' : 'attention'}`}>
              {query.data.data.available ? 'In stock' : 'Currently out of stock'}
            </span>
            <p>A part of the Northstar Supply collection.</p>
            <div className="p4-product-order">
              <label htmlFor="product-quantity">
                Quantity
                <Input
                  id="product-quantity"
                  type="number"
                  min={1}
                  max={99}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(
                      Math.min(99, Math.max(1, Math.round(Number(event.target.value)) || 1)),
                    )
                  }
                />
              </label>
              <Button
                className="btn-primary"
                disabled={
                  profile.role !== 'CUSTOMER' ||
                  !query.data.data.available ||
                  (cart.items.length >= 20 &&
                    !cart.items.some((item) => item.sku === query.data.data.sku)) ||
                  (cart.items.find((item) => item.sku === query.data.data.sku)?.quantity ?? 0) +
                    quantity >
                    99
                }
                onClick={() => {
                  cart.add(query.data.data.sku, quantity)
                  toast.success('Added to your bag.', {
                    action: { label: 'View bag', onClick: () => navigate('/account/cart') },
                  })
                }}
              >
                Add to bag <Package size={18} />
              </Button>
              <Link className="text-link" to="/account/cart">
                View your bag <ArrowUpRight size={17} />
              </Link>
              <small>
                Pick up to 20 products, with up to 99 of each. Stock is checked at checkout.
              </small>
            </div>
            <Link to="/account/orders" className="text-link">
              Your order history
              <ArrowUpRight size={17} />
            </Link>
            <small className="mono">SKU / {query.data.data.sku}</small>
          </div>
        </section>
      )}
    </>
  )
}
