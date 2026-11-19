import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { Paginated } from '@docklane/contracts'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'

export function ResourceHeading({
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
export function ResourceState({
  loading,
  error,
  retry,
}: {
  loading?: boolean
  error?: unknown
  retry?: () => void
}) {
  return (
    <div className="p3-state" role={error ? 'alert' : 'status'}>
      {loading ? (
        <>
          <span className="connected-spinner" />
          <p>Getting your latest records ready…</p>
        </>
      ) : (
        <>
          <p>{error instanceof Error ? error.message : 'This view is temporarily unavailable.'}</p>
          {retry && (
            <Button className="btn-secondary" onClick={retry}>
              Try again
            </Button>
          )}
        </>
      )}
    </div>
  )
}
export function ResourceEmpty({
  title = 'Nothing matches this view.',
  description = 'Try another search or clear the filters.',
  clear,
}: {
  title?: string
  description?: string
  clear?: () => void
}) {
  return (
    <div className="p3-empty">
      <h2>{title}</h2>
      <p>{description}</p>
      {clear && (
        <Button className="btn-secondary" onClick={clear}>
          Clear filters
          <ArrowRight size={16} />
        </Button>
      )}
    </div>
  )
}
export function ResourcePagination({
  pagination,
  update,
  noun = 'records',
}: {
  pagination: Paginated<unknown>['pagination']
  update: (values: Record<string, string | null>, resetPage?: boolean) => void
  noun?: string
}) {
  const { page, pageSize, total, pages } = pagination
  return (
    <div className="p3-pagination">
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total} ${noun}`
          : `0 ${noun}`}
      </span>
      <div>
        <Button
          className="btn-secondary"
          disabled={page <= 1}
          onClick={() => update({ page: String(page - 1) }, false)}
        >
          Previous
        </Button>
        <span>
          Page {page} of {Math.max(1, pages)}
        </span>
        <Button
          className="btn-secondary"
          disabled={page >= pages}
          onClick={() => update({ page: String(page + 1) }, false)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
export function ProductImage({ src, className }: { src: string; className?: string }) {
  return (
    <img
      src={src}
      className={className}
      alt=""
      loading="lazy"
      onError={(event) => {
        if (!event.currentTarget.src.endsWith('/product-placeholder.svg'))
          event.currentTarget.src = '/product-placeholder.svg'
      }}
    />
  )
}
export function StockBadge({
  available,
  threshold,
  archived,
}: {
  available: number
  threshold: number
  archived?: boolean
}) {
  return (
    <span
      className={`connected-badge ${archived ? '' : available === 0 ? 'attention' : available <= threshold ? 'attention' : 'good'}`}
    >
      {archived
        ? 'Archived'
        : available === 0
          ? 'Out of stock'
          : available <= threshold
            ? 'Low stock'
            : 'In stock'}
    </span>
  )
}
