import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { Package } from '@phosphor-icons/react/dist/csr/Package'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { Sun } from '@phosphor-icons/react/dist/csr/Sun'
import { Moon } from '@phosphor-icons/react/dist/csr/Moon'
import '@/landing.css'

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className} data-reveal>
      {children}
    </div>
  )
}
function OrderJourney() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 80%', 'end 30%'] })
  const x = useTransform(scrollYProgress, [0, 1], ['0%', '300%'])
  return (
    <div className="landing-journey-visual" ref={ref}>
      <div className="landing-lane" aria-hidden="true">
        <motion.div className="landing-parcel" style={{ x }}>
          <Package size={27} weight="duotone" />
        </motion.div>
      </div>
      <ol className="landing-journey-steps">
        {[
          ['Reserve stock', 'Every item held together, or none at all.'],
          ['Confirm payment', 'Verified test payment allocates the hold.'],
          ['Pack the order', 'Review contents before recording shipment.'],
          ['Ship with a trail', 'Tracking saved. Physical stock consumed once.'],
        ].map(([title, body]) => (
          <li key={title}>
            <Check size={18} />
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
      <p className="landing-journey-note">
        A payment refund changes money. Received, inspected returns change stock.
      </p>
    </div>
  )
}
function ReservationProof() {
  const [ran, setRan] = useState(false),
    reduce = useReducedMotion()
  return (
    <div className="landing-proof-demo">
      <div className="landing-proof-caption">
        <span>Illustrated reservation test</span>
        <span className="mono">10 available units</span>
      </div>
      <div
        className="landing-proof-units"
        aria-label={ran ? 'Ten units reserved once each' : 'Ten available units'}
      >
        {Array.from({ length: 10 }, (_, index) => (
          <motion.div
            key={`${ran}:${index}`}
            initial={ran && !reduce ? { opacity: 0, scale: 0.92 } : false}
            animate={{ opacity: 1, scale: 1 }}
            style={{ backgroundColor: ran ? '#b9f36b' : '#eef1f4' }}
            transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : index * 0.045 }}
          >
            <Cube size={24} />
            <span>{String(index + 1).padStart(2, '0')}</span>
          </motion.div>
        ))}
      </div>
      <div className="landing-proof-results" role="status" aria-live="polite">
        {ran ? (
          <>
            <div>
              <strong>10</strong>
              <span>Reserved</span>
            </div>
            <div>
              <strong>40</strong>
              <span>Insufficient stock</span>
            </div>
            <div>
              <strong>0</strong>
              <span>Units oversold</span>
            </div>
          </>
        ) : (
          <p>What happens when 50 customers request the same ten units?</p>
        )}
      </div>
      <button className="landing-button primary" onClick={() => setRan((value) => !value)}>
        {ran ? 'Reset illustration' : 'Illustrate 50 requests'}
        <ArrowRight size={18} />
      </button>
      <p className="landing-proof-note">
        This illustration shows the result of Docklane’s reproducible PostgreSQL test. It does not
        place orders.
      </p>
    </div>
  )
}
export default function Landing() {
  const [mode, setMode] = useState<'system' | 'light' | 'dark'>('system')
  useEffect(() => {
    const previous = document.title
    document.title = 'Docklane | Every order, moving forward'
    return () => {
      document.title = previous
    }
  }, [])
  return (
    <div className="landing" data-theme={mode}>
      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-nav">
        <Link to="/welcome" className="landing-wordmark">
          <img src="/favicon.svg" width={29} height={29} alt="" />
          docklane<span>.</span>
        </Link>
        <nav aria-label="Product navigation">
          <a href="#journey">How it works</a>
          <a href="#workspace">The workspace</a>
          <a href="#correctness">Stock correctness</a>
        </nav>
        <div>
          <button
            className="landing-theme"
            aria-label={`Change color theme, currently ${mode}`}
            onClick={() =>
              setMode((value) =>
                value === 'system' ? 'dark' : value === 'dark' ? 'light' : 'system',
              )
            }
          >
            {mode === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <Link className="landing-signin" to="/auth/sign-in">
            Sign in
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </header>
      <main id="landing-main">
        <section className="landing-hero">
          <Reveal className="landing-hero-copy">
            <p className="landing-eyebrow">Order & inventory platform</p>
            <h1>
              <span>Every order.</span>
              <span>Moving forward.</span>
            </h1>
            <p className="landing-intro">
              Reserve the right stock. Keep payments clear. Give every warehouse a shared view of
              what comes next.
            </p>
            <div className="landing-hero-actions">
              <Link to="/" className="landing-button primary">
                Explore the demo
                <ArrowUpRight size={19} />
              </Link>
              <a href="#journey" className="landing-text-link">
                Follow an order
                <ArrowRight size={18} />
              </a>
            </div>
          </Reveal>
          <div className="landing-hero-preview">
            <div className="landing-preview-top">
              <span>Docklane workspace</span>
              <span>Sample data</span>
            </div>
            <img
              src="/previews/overview.webp"
              onError={(e) => {
                if (!e.currentTarget.src.endsWith('/inventory.webp'))
                  e.currentTarget.src = '/previews/inventory.webp'
              }}
              width={1366}
              height={900}
              alt="Docklane operations workspace showing saved stock, warehouse balances, and order queues"
              fetchPriority="high"
            />
            <p>One workspace for the people keeping orders moving.</p>
          </div>
        </section>
        <section id="journey" className="landing-section landing-journey">
          <Reveal>
            <h2>A good order has a clear path.</h2>
            <p className="landing-section-copy">
              From a temporary stock hold to a tracked shipment, every transition has a purpose and
              a recorded outcome.
            </p>
          </Reveal>
          <OrderJourney />
        </section>
        <section id="workspace" className="landing-section landing-workspace">
          <Reveal>
            <h2>Built for the next decision.</h2>
            <p className="landing-section-copy">
              Know what needs packing, where stock is low, and which payment needs another look.
            </p>
          </Reveal>
          <div className="landing-preview-grid">
            <Reveal className="landing-inventory-preview">
              <img
                src="/previews/inventory.webp"
                width={1366}
                height={900}
                loading="lazy"
                alt="Real Docklane inventory screen with stock counts, filters, and warehouse records"
              />
              <div>
                <h3>Every count has a story.</h3>
                <p>Available, reserved, and on hand. Follow the movement behind each change.</p>
              </div>
            </Reveal>
            <Reveal className="landing-order-preview">
              <img
                src="/previews/order.webp"
                width={1366}
                height={900}
                loading="lazy"
                alt="Real Docklane order screen with fulfillment, refunds, and recorded order history"
              />
              <div>
                <h3>One order. The whole picture.</h3>
                <p>
                  Separate payment and fulfillment states, manual tracking, and a readable timeline.
                </p>
              </div>
            </Reveal>
          </div>
        </section>
        <section id="correctness" className="landing-section landing-correctness">
          <Reveal className="landing-proof-copy">
            <p className="landing-eyebrow">Correctness you can inspect</p>
            <h2>The last unit only sells once.</h2>
            <p>
              Simultaneous checkouts share a transactional inventory engine. Stock holds succeed
              together, and repeated commands preserve the original result.
            </p>
            <a
              className="landing-text-link"
              href="https://github.com/benbinu173/Docklane/blob/main/docs/CONCURRENCY_PROOF.md"
              target="_blank"
              rel="noreferrer"
            >
              Read the concurrency proof
              <ArrowUpRight size={18} />
            </a>
          </Reveal>
          <ReservationProof />
        </section>
        <section className="landing-section landing-customer">
          <Reveal className="landing-customer-copy">
            <h2>
              A considered checkout.
              <br />A traceable order.
            </h2>
            <p className="landing-section-copy">
              Browse the collection, review delivery and server-priced totals, then follow the saved
              payment and fulfillment journey.
            </p>
            <Link className="landing-text-link" to="/auth/sign-up">
              Create a customer account
              <ArrowUpRight size={18} />
            </Link>
          </Reveal>
          <Reveal className="landing-bag-preview">
            <img
              src="/previews/bag.webp"
              width={1366}
              height={900}
              loading="lazy"
              alt="Real Docklane customer bag with product photographs, quantities, and a clear order summary"
            />
          </Reveal>
        </section>
        <section className="landing-section landing-final">
          <Reveal>
            <h2>
              Give every order
              <br />
              its next move.
            </h2>
            <p>Explore the sample workspace, or sign in to use saved orders and inventory.</p>
            <Link className="landing-button primary" to="/auth/sign-in">
              Open your workspace
              <ArrowUpRight size={19} />
            </Link>
            <p className="landing-demo-note">
              Portfolio demo with sample data. Payments use Stripe test mode.
            </p>
          </Reveal>
        </section>
      </main>
      <footer className="landing-footer">
        <Link to="/welcome" className="landing-wordmark">
          docklane<span>.</span>
        </Link>
        <p>Every order, moving forward.</p>
        <a href="https://github.com/benbinu173/Docklane" target="_blank" rel="noreferrer">
          View the project
          <ArrowUpRight size={16} />
        </a>
      </footer>
    </div>
  )
}
