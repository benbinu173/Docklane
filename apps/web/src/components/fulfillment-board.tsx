import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { Package } from '@phosphor-icons/react/dist/csr/Package'

type Lane = {
  id: string
  label: string
  note: string
  count: number
  icon: typeof Package
  href: string
  priority?: boolean
}

export function FulfillmentBoard({
  title,
  description,
  lanes,
  note,
  href,
}: {
  title: string
  description: string
  lanes: Lane[]
  note: string
  href: string
}) {
  return (
    <section className="fulfillment-board" aria-label="Fulfillment queues">
      <div className="fulfillment-board-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="fulfillment-board-mark" aria-hidden="true">
          <Package size={28} weight="duotone" />
        </span>
      </div>
      <div
        className="fulfillment-board-lanes"
        style={{ '--lane-count': lanes.length } as CSSProperties}
      >
        {lanes.map(
          ({ id, label, note: detail, count, icon: Icon, href: destination, priority }) => (
            <Link
              key={id}
              to={destination}
              className={`fulfillment-lane${priority && count > 0 ? ' priority' : ''}`}
            >
              <span className="fulfillment-lane-icon" aria-hidden="true">
                <Icon size={24} weight="duotone" />
              </span>
              <span className="fulfillment-lane-count">{count.toLocaleString('en-IN')}</span>
              <strong>{label}</strong>
              <span className="fulfillment-lane-note">{detail}</span>
              <ArrowUpRight className="fulfillment-lane-arrow" size={20} aria-hidden="true" />
            </Link>
          ),
        )}
      </div>
      <div className="fulfillment-board-footer">
        <span>{note}</span>
        <Link to={href}>
          Follow your orders <ArrowUpRight size={15} />
        </Link>
      </div>
    </section>
  )
}
