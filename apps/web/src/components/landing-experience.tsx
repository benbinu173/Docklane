import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as Tabs from '@radix-ui/react-tabs'
import { AnimatePresence, motion, useInView, useMotionValue, useSpring } from 'motion/react'
import { useMotionPreference } from '@/hooks/use-motion-preference'
import { useTheme } from '@/lib/theme'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { CreditCard } from '@phosphor-icons/react/dist/csr/CreditCard'
import { Package } from '@phosphor-icons/react/dist/csr/Package'
import { Truck } from '@phosphor-icons/react/dist/csr/Truck'
import { Play } from '@phosphor-icons/react/dist/csr/Play'
import { Pause } from '@phosphor-icons/react/dist/csr/Pause'

const previews = [
  {
    id: 'overview',
    label: 'Overview',
    src: '/previews/overview.webp',
    darkSrc: '/previews/overview-dark.webp',
    href: '/',
    alt: 'Real Docklane operations overview with order queues, saved stock, and warehouse balances',
    caption: 'See the next decision before the next delivery.',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    src: '/previews/inventory.webp',
    darkSrc: '/previews/inventory-dark.webp',
    href: '/inventory',
    alt: 'Real Docklane inventory screen with product counts, filters, and warehouse records',
    caption: 'Every count, with the movement behind it.',
  },
  {
    id: 'orders',
    label: 'Orders',
    src: '/previews/order.webp',
    darkSrc: '/previews/order-dark.webp',
    href: '/orders',
    alt: 'Real Docklane order screen showing payment, fulfillment, and recorded history',
    caption: 'One order, from its first hold to its last handoff.',
  },
]

export function WorkspacePreview() {
  const { resolved } = useTheme()
  const [selected, setSelected] = useState('overview')
  const [interacted, setInteracted] = useState(false)
  const reduced = useMotionPreference()
  const tiltX = useMotionValue(0),
    tiltY = useMotionValue(0)
  const rotateX = useSpring(tiltX, { stiffness: 180, damping: 28 })
  const rotateY = useSpring(tiltY, { stiffness: 180, damping: 28 })
  useEffect(() => {
    if (reduced) {
      tiltX.set(0)
      tiltY.set(0)
    }
  }, [reduced, tiltX, tiltY])
  return (
    <div className="landing-preview-scene">
      <motion.div
        className="landing-hero-preview"
        style={{ rotateX, rotateY }}
        onPointerMove={(event) => {
          if (
            reduced ||
            event.pointerType !== 'mouse' ||
            !matchMedia('(hover: hover) and (pointer: fine)').matches
          )
            return
          const bounds = event.currentTarget.getBoundingClientRect()
          tiltX.set((0.5 - (event.clientY - bounds.top) / bounds.height) * 4)
          tiltY.set(((event.clientX - bounds.left) / bounds.width - 0.5) * 4)
        }}
        onPointerLeave={() => {
          tiltX.set(0)
          tiltY.set(0)
        }}
      >
        <Tabs.Root
          value={selected}
          onValueChange={(value) => {
            setInteracted(true)
            setSelected(value)
          }}
        >
          <div className="landing-preview-top">
            <span>Inside Docklane</span>
            <span>Sample data</span>
          </div>
          <Tabs.List className="landing-preview-tabs" aria-label="Workspace previews">
            {previews.map((preview) => (
              <Tabs.Trigger key={preview.id} value={preview.id}>
                {preview.label}
                {selected === preview.id && (
                  <motion.span
                    className="landing-tab-indicator"
                    layoutId="preview-tab"
                    transition={
                      reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 35 }
                    }
                  />
                )}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {previews.map((preview) => (
            <Tabs.Content
              key={preview.id}
              value={preview.id}
              className="landing-preview-content"
              data-interacted={interacted}
            >
              <img
                src={resolved === 'dark' ? preview.darkSrc : preview.src}
                width={1366}
                height={900}
                alt={preview.alt}
                fetchPriority={preview.id === 'overview' ? 'high' : 'auto'}
              />
              <div className="landing-preview-caption">
                <p>{preview.caption}</p>
                <Link to={preview.href} aria-label={`Open ${preview.label.toLowerCase()} demo`}>
                  Open {preview.label.toLowerCase()} <ArrowUpRight size={15} />
                </Link>
              </div>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </motion.div>
    </div>
  )
}

const journey = [
  {
    title: 'Reserve stock',
    subtitle: 'Every item held together, or none at all.',
    icon: Cube,
    status: 'Stock reserved',
    detail: 'The order holds one unit. Other checkouts see one fewer unit available.',
    stock: [
      ['On hand', '12'],
      ['Reserved', '1'],
      ['Available', '11'],
    ],
    event: 'Stock hold recorded',
  },
  {
    title: 'Confirm payment',
    subtitle: 'Verified test payment allocates the hold.',
    icon: CreditCard,
    status: 'Payment confirmed',
    detail: 'A verified test payment confirms the order. The same reserved unit stays allocated.',
    stock: [
      ['On hand', '12'],
      ['Reserved', '1'],
      ['Available', '11'],
    ],
    event: 'Test payment verified',
  },
  {
    title: 'Pack the order',
    subtitle: 'Review contents before recording shipment.',
    icon: Package,
    status: 'Packed for dispatch',
    detail:
      'The team checks the contents and marks the order packed. Physical stock stays on hand.',
    stock: [
      ['On hand', '12'],
      ['Reserved', '1'],
      ['Available', '11'],
    ],
    event: 'Packing recorded',
  },
  {
    title: 'Ship with a trail',
    subtitle: 'Tracking saved. Physical stock consumed once.',
    icon: Truck,
    status: 'Shipment recorded',
    detail:
      'Dispatch consumes the unit and clears its reservation in one transaction. Tracking stays with the order.',
    stock: [
      ['On hand', '11'],
      ['Reserved', '0'],
      ['Available', '11'],
    ],
    event: 'Shipment and stock movement saved',
  },
]

export function OrderJourney() {
  const [stage, setStage] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [visible, setVisible] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.25 })
  const reduced = useMotionPreference()
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    if (!playing || !inView || !visible || reduced || stage === journey.length - 1) return
    const timer = setTimeout(() => setStage((value) => value + 1), 2600)
    return () => clearTimeout(timer)
  }, [playing, inView, visible, reduced, stage])
  const step = journey[stage]
  const Icon = step.icon
  const playingNow = playing && stage < journey.length - 1 && !reduced
  return (
    <div className="landing-order-story" ref={ref}>
      <Tabs.Root
        value={String(stage)}
        onValueChange={(value) => {
          setPlaying(false)
          setStage(Number(value))
        }}
      >
        <div className="landing-story-header">
          <span>One sample order. Four recorded steps.</span>
          {!reduced && (
            <button
              className="landing-story-play"
              onClick={() => {
                if (playingNow) setPlaying(false)
                else {
                  setStage(0)
                  setPlaying(true)
                }
              }}
            >
              {playingNow ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
              {playingNow ? 'Pause journey' : 'Play journey'}
            </button>
          )}
        </div>
        <Tabs.List className="landing-story-stages" aria-label="Order journey stages">
          {journey.map(({ title, subtitle, icon: StageIcon }, index) => (
            <Tabs.Trigger key={title} value={String(index)}>
              <span
                className={`landing-story-stage-icon${index < stage ? ' complete' : ''}`}
                aria-hidden="true"
              >
                {index < stage ? (
                  <Check size={22} weight="bold" />
                ) : (
                  <StageIcon size={22} weight="duotone" />
                )}
              </span>
              <strong>{title}</strong>
              <span>{subtitle}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {journey.map((item, index) => (
          <Tabs.Content key={item.title} value={String(index)} className="landing-story-content">
            <div className="landing-story-explanation">
              <p className="landing-story-label">{item.status}</p>
              <h3>
                {item.title === 'Ship with a trail'
                  ? 'The handoff changes stock.'
                  : item.title === 'Pack the order'
                    ? 'Ready for its next stop.'
                    : item.title === 'Confirm payment'
                      ? 'Confirmed, with stock intact.'
                      : 'A hold makes room for certainty.'}
              </h3>
              <p>{item.detail}</p>
              <span className="landing-story-record">
                <Check size={16} /> {item.event}
              </span>
            </div>
            <div className="landing-story-order">
              <div className="landing-story-order-top">
                <span className="mono">SAMPLE ORDER</span>
                <span>1 item</span>
              </div>
              <div className="landing-story-product">
                <span className="landing-story-product-icon" aria-hidden="true">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={stage}
                      initial={reduced ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduced ? 0 : 0.16 }}
                    >
                      <Icon size={36} weight="duotone" />
                    </motion.span>
                  </AnimatePresence>
                </span>
                <div>
                  <strong>{step.status}</strong>
                  <span>One unit, accounted for.</span>
                </div>
                <ArrowRight size={19} aria-hidden="true" />
              </div>
              <dl className="landing-story-stock">
                {item.stock.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p>Illustrative quantities. Your workspace uses saved stock.</p>
            </div>
          </Tabs.Content>
        ))}
      </Tabs.Root>
      <p className="landing-journey-note">
        A payment refund changes money. Received, inspected returns change stock.
      </p>
    </div>
  )
}
