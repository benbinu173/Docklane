import type { ReactNode } from 'react'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { Clock } from '@phosphor-icons/react/dist/csr/Clock'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDemo } from '@/lib/demo-context'
import { getProduct, stageLabels, type OrderStage, type Product } from '@/data/demo'

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  )
}
export function PanelHeading({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  )
}
export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
export function StageBadge({ stage }: { stage: OrderStage }) {
  const Icon = stage === 'shipped' ? CheckCircle : stage === 'awaiting' ? Clock : null
  return (
    <span className={`status status-${stage}`}>
      {Icon && <Icon size={13} weight="bold" />}
      {stageLabels[stage]}
    </span>
  )
}
export function ProductImage({ product, small = false }: { product: Product; small?: boolean }) {
  return (
    <div
      className={`product-image ${small ? 'small' : ''}`}
      style={{ backgroundColor: product.color }}
    >
      <img src={product.image} alt="" loading="lazy" width={64} height={64} />
    </div>
  )
}
export function ProductName({ sku, children }: { sku: string; children?: ReactNode }) {
  const product = getProduct(sku)
  return (
    <div className="product-cell">
      <ProductImage product={product} />
      <div>
        <span className="product-name">{product.name} </span>
        <span className="mono muted tiny">{sku}</span>
        {children}
      </div>
    </div>
  )
}
export function EmptyResults({
  title = 'No matches just yet',
  description = 'Try another search or clear your filters.',
  onClear,
}: {
  title?: string
  description?: string
  onClear?: () => void
}) {
  return (
    <div className="empty-state">
      <div className="state-icon">
        <Cube size={30} weight="duotone" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {onClear && (
        <Button className="btn-secondary" onClick={onClear}>
          Clear filters <ArrowRight size={16} />
        </Button>
      )}
    </div>
  )
}
export function DataBoundary({ children }: { children: ReactNode }) {
  const { previewState, setPreviewState } = useDemo()
  if (previewState === 'populated') return children
  if (previewState === 'loading')
    return (
      <div
        role="region"
        aria-busy="true"
        aria-label="Loading workspace"
        className="loading-preview"
      >
        <div className="skeleton-grid">
          {[1, 2, 3, 4].map((i) => (
            <div className="skeleton-stat" key={i}>
              <div className="skeleton short" />
              <div className="skeleton number" />
            </div>
          ))}
        </div>
        <div className="skeleton-panel">
          <div className="skeleton short" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div className="skeleton row" key={i} />
          ))}
        </div>
        <span className="sr-only">
          Sample loading state. Return to demo using the preview banner.
        </span>
      </div>
    )
  return (
    <div className="panel">
      <div className="empty-state spacious">
        <div className={`state-icon ${previewState === 'error' ? 'error' : ''}`}>
          {previewState === 'error' ? (
            <WarningCircle size={32} weight="duotone" />
          ) : (
            <Cube size={32} weight="duotone" />
          )}
        </div>
        <h2>
          {previewState === 'error'
            ? 'We couldn’t load your workspace'
            : 'A fresh start for your operations'}
        </h2>
        <p>
          {previewState === 'error'
            ? 'Your sample data is safe. Try loading the workspace again.'
            : 'When products and orders are added, they’ll appear here. Explore the populated demo to see Docklane in action.'}
        </p>
        <Button className="btn-primary" onClick={() => setPreviewState('populated')}>
          {previewState === 'error' ? 'Try again' : 'Explore sample data'}
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  )
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  )
}
