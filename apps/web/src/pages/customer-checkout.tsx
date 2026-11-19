import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ShoppingBag } from '@phosphor-icons/react/dist/csr/ShoppingBag'
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle'
import {
  checkoutSchema,
  deliveryAddressSchema,
  type CheckoutInput,
  type CheckoutQuote,
  type OrderDetail,
} from '@docklane/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIdentity, useProfile } from '@/lib/identity-context'
import { useCart } from '@/lib/cart-context'
import { ApiError } from '@/lib/auth-client'
import { money } from '@/lib/inventory-client'
import { ProductImage, ResourceState } from './phase3-shared'

function useQuote() {
  const { api } = useIdentity(),
    profile = useProfile().data!.data,
    cart = useCart()
  return useQuery({
    queryKey: ['checkout', 'quote', profile.id, JSON.stringify(cart.items)],
    queryFn: () =>
      api<{ data: CheckoutQuote }>('/checkout/quote', {
        method: 'POST',
        body: { items: cart.items },
      }),
    enabled: cart.items.length > 0 && profile.role === 'CUSTOMER',
    staleTime: 0,
  })
}
function EmptyBag() {
  return (
    <section className="p4-empty">
      <ShoppingBag size={48} weight="duotone" />
      <span className="auth-eyebrow">ROOM FOR SOMETHING GOOD</span>
      <h1>Your next find starts here.</h1>
      <p>Explore the collection and make a little room for your everyday.</p>
      <Link className="btn-primary p4-link-button" to="/account/catalog">
        Explore the collection <ArrowRight size={18} />
      </Link>
    </section>
  )
}
function OrderSummary({ quote }: { quote: CheckoutQuote }) {
  return (
    <aside className="p4-summary" aria-label="Order summary">
      <span className="auth-eyebrow">THE DETAILS, ALL HERE</span>
      <h2>A good little lineup.</h2>
      <div className="p4-summary-items">
        {quote.items.map((item) => (
          <div key={item.sku}>
            <ProductImage src={item.image} />
            <div>
              <strong>{item.name}</strong>
              <span>
                {item.quantity} × {money(item.unitPricePaise)}
              </span>
            </div>
            <strong>{money(item.totalPaise)}</strong>
          </div>
        ))}
      </div>
      <dl className="p4-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{money(quote.subtotalPaise)}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>On us</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{money(quote.totalPaise)}</dd>
        </div>
      </dl>
      <p className="p4-summary-note">
        <CheckCircle size={18} /> Prices checked with the collection.
      </p>
    </aside>
  )
}
export function CustomerBag() {
  const cart = useCart(),
    quote = useQuote(),
    profile = useProfile().data!.data
  if (profile.role !== 'CUSTOMER')
    return <ResourceState error={new Error('Use a Customer account to shop the collection.')} />
  if (!cart.items.length) return <EmptyBag />
  return (
    <>
      <Link className="text-link p3-back" to="/account/catalog">
        <ArrowLeft size={16} /> Keep exploring
      </Link>
      <header className="p4-heading">
        <span className="auth-eyebrow">YOUR EVERYDAY, SELECTED</span>
        <h1>A bag full of good things.</h1>
        <p>
          {cart.count} {cart.count === 1 ? 'item' : 'items'} picked. A little closer to your
          doorstep.
        </p>
      </header>
      <div className="p4-checkout-grid">
        <section className="p4-bag-list" aria-label="Shopping bag">
          {cart.items.map((line) => {
            const product = quote.data?.data.items.find((item) => item.sku === line.sku)
            return (
              <article className="p4-bag-item" key={line.sku}>
                <div className="p4-bag-image">
                  <ProductImage src={product?.image ?? '/product-placeholder.svg'} />
                </div>
                <div className="p4-bag-copy">
                  <span className="mono">{line.sku}</span>
                  <h2>{product?.name ?? line.sku}</h2>
                  <p>{product ? money(product.unitPricePaise) : 'Checking the collection…'}</p>
                  <button className="text-link" onClick={() => cart.remove(line.sku)}>
                    Remove<span className="sr-only"> {product?.name ?? line.sku}</span>
                  </button>
                </div>
                <label className="p4-bag-quantity">
                  Quantity
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    aria-label={`${product?.name ?? line.sku} quantity`}
                    value={line.quantity}
                    onChange={(event) => cart.quantity(line.sku, Number(event.target.value))}
                  />
                </label>
                <strong className="p4-bag-total">
                  {product ? money(product.totalPaise) : '—'}
                </strong>
              </article>
            )
          })}
          <p className="p4-bag-note">
            Your bag keeps your picks. Stock is held when you reserve your order.
          </p>
        </section>
        <div>
          {quote.isPending ? (
            <ResourceState loading />
          ) : quote.isError ? (
            <ResourceState
              error={quote.error}
              retry={() => {
                void quote.refetch()
              }}
            />
          ) : (
            <>
              <OrderSummary quote={quote.data.data} />
              {!quote.data.data.canOrder && (
                <p className="p4-error" role="alert">
                  No single warehouse can fill this bag right now. Reduce quantities or remove an
                  item to continue.
                </p>
              )}
              <Link
                to="/account/checkout"
                className={`btn-primary p4-link-button p4-continue ${!quote.data.data.canOrder || quote.isFetching ? 'p4-disabled' : ''}`}
                aria-disabled={!quote.data.data.canOrder || quote.isFetching}
                onClick={(event) => {
                  if (!quote.data.data.canOrder || quote.isFetching) event.preventDefault()
                }}
              >
                Continue to delivery <ArrowRight size={18} />
              </Link>
              <p className="p4-test-note">Test checkout. No payment is charged.</p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
function savedAttempt(key: string) {
  try {
    const parsed = checkoutSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
function forgetAttempt(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* A saved retry still resolves to the same order. */
  }
}
export function CustomerCheckout() {
  const { api } = useIdentity(),
    profile = useProfile().data!.data,
    cart = useCart(),
    quote = useQuote(),
    navigate = useNavigate(),
    cache = useQueryClient()
  const attemptKey = `docklane.checkout:${profile.id}`
  const [attempt, setAttempt] = useState<CheckoutInput | null>(() => savedAttempt(attemptKey))
  const [address, setAddress] = useState(
    () =>
      attempt?.deliveryAddress ?? { line: '', city: '', postalCode: '', country: 'IN' as const },
  )
  const [review, setReview] = useState(!!attempt),
    [fields, setFields] = useState<Record<string, string>>({}),
    [preparing, setPreparing] = useState(false)
  const reserve = useMutation({
    mutationFn: (input: CheckoutInput) =>
      api<{ data: OrderDetail }>('/orders', { method: 'POST', body: input }),
    onSuccess: async (result, submitted) => {
      forgetAttempt(attemptKey)
      setAttempt(null)
      cart.complete(submitted.items)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['phase3'] }),
        cache.invalidateQueries({ queryKey: ['connected'] }),
        cache.invalidateQueries({ queryKey: ['checkout'] }),
      ])
      cache.setQueryData(['connected', 'order', profile.id, result.data.id], result)
      toast.success(
        result.data.orderStatus === 'CANCELLED'
          ? 'This order was already cancelled.'
          : 'Your order is reserved.',
      )
      navigate(`/account/orders/${result.data.id}`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        forgetAttempt(attemptKey)
        setAttempt(null)
        if (error.code === 'PRICE_CHANGED' || error.code === 'INSUFFICIENT_STOCK')
          void quote.refetch()
      }
    },
  })
  async function prepare(event: FormEvent) {
    event.preventDefault()
    const parsed = deliveryAddressSchema.safeParse(address)
    if (!parsed.success) {
      setFields(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      )
      return
    }
    setFields({})
    setPreparing(true)
    try {
      const latest = await quote.refetch()
      if (latest.data?.data.canOrder && !latest.isError) {
        setAddress(parsed.data)
        setReview(true)
      }
    } finally {
      setPreparing(false)
    }
  }
  function submit() {
    if (attempt) {
      reserve.mutate(attempt)
      return
    }
    if (!quote.data?.data.canOrder || quote.isFetching) return
    const input: CheckoutInput = {
      items: quote.data.data.items.map(({ sku, quantity }) => ({ sku, quantity })),
      deliveryAddress: address,
      quoteFingerprint: quote.data.data.quoteFingerprint,
      idempotencyKey: crypto.randomUUID(),
    }
    try {
      sessionStorage.setItem(attemptKey, JSON.stringify(input))
    } catch {
      toast.error('Allow browser session storage so your order can be retried safely.')
      return
    }
    setAttempt(input)
    reserve.mutate(input)
  }
  if (profile.role !== 'CUSTOMER')
    return <ResourceState error={new Error('Use a Customer account to reserve an order.')} />
  if (!cart.items.length && !attempt) return <EmptyBag />
  return (
    <>
      <Link
        className="text-link p3-back"
        to="/account/cart"
        onClick={(event) => {
          if (attempt) event.preventDefault()
        }}
        aria-disabled={!!attempt}
      >
        <ArrowLeft size={16} /> Back to your bag
      </Link>
      <header className="p4-heading">
        <span className="auth-eyebrow">ONE STEP CLOSER</span>
        <h1>{review ? 'Looks good. Let’s hold it.' : 'Where should good things go?'}</h1>
        <p>
          {review
            ? 'Review your destination and total before reserving stock.'
            : 'A clear destination for everything you picked.'}
        </p>
      </header>
      <ol className="p4-steps" aria-label="Checkout progress">
        <li className="done">
          01 <span>Your bag</span>
        </li>
        <li className={!review ? 'current' : 'done'} aria-current={!review ? 'step' : undefined}>
          02 <span>Delivery</span>
        </li>
        <li className={review ? 'current' : ''} aria-current={review ? 'step' : undefined}>
          03 <span>Review & reserve</span>
        </li>
      </ol>
      <div className="p4-checkout-grid">
        <section className="p4-delivery-form">
          {attempt && !reserve.isPending && (
            <div className="p4-recovery" role="status">
              <strong>Confirm the order you already sent.</strong>
              <p>
                Retry the same reservation to check its result. Your bag will not be reserved twice.
              </p>
            </div>
          )}
          <span className="auth-eyebrow">THE DESTINATION</span>
          <h2>{profile.name}</h2>
          {review ? (
            <>
              <address>
                {address.line}
                <br />
                {address.city} · {address.postalCode}
                <br />
                India
              </address>
              {!attempt && (
                <button
                  className="text-link"
                  onClick={() => {
                    setReview(false)
                    reserve.reset()
                  }}
                >
                  Edit delivery details
                </button>
              )}
              <div className="p4-reserve-note">
                <ShoppingBag size={28} weight="duotone" />
                <div>
                  <h3>Your whole bag, together.</h3>
                  <p>
                    We choose a warehouse that can fill every item. Availability is checked again
                    when you reserve.
                  </p>
                </div>
              </div>
              {reserve.isError && (
                <p className="p4-error" role="alert">
                  {reserve.error.message}
                </p>
              )}
              <Button
                className="btn-primary p4-reserve"
                onClick={submit}
                disabled={
                  reserve.isPending ||
                  (!attempt && (!quote.data?.data.canOrder || quote.isFetching))
                }
              >
                {reserve.isPending
                  ? 'Reserving your order…'
                  : attempt
                    ? 'Retry same reservation'
                    : 'Reserve order'}
                <ArrowRight size={18} />
              </Button>
              <p className="p4-test-note">
                This step reserves stock. Continue to Stripe test payment from your saved order.
              </p>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                void prepare(event)
              }}
              noValidate
            >
              {(
                [
                  ['line', 'Street address', 'House, building, and street', 'street-address'],
                  ['city', 'City', 'Your city', 'address-level2'],
                  ['postalCode', 'PIN code', 'Six-digit PIN code', 'postal-code'],
                ] as const
              ).map(([name, label, placeholder, autoComplete]) => (
                <div key={name} className="p4-field">
                  <label htmlFor={`delivery-${name}`}>{label}</label>
                  <Input
                    id={`delivery-${name}`}
                    value={address[name]}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    inputMode={name === 'postalCode' ? 'numeric' : 'text'}
                    aria-invalid={!!fields[name]}
                    aria-describedby={fields[name] ? `delivery-${name}-error` : undefined}
                    onChange={(event) =>
                      setAddress((current) => ({ ...current, [name]: event.target.value }))
                    }
                  />
                  {fields[name] && (
                    <span className="p4-error" id={`delivery-${name}-error`}>
                      {fields[name]}
                    </span>
                  )}
                </div>
              ))}
              <p className="p4-country">Delivering within India · INR</p>
              <Button
                className="btn-primary p4-reserve"
                type="submit"
                disabled={preparing || quote.isPending}
              >
                {preparing ? 'Checking your bag…' : 'Review order'}
                <ArrowRight size={18} />
              </Button>
            </form>
          )}
        </section>
        <div>
          {attempt && quote.data?.data.quoteFingerprint !== attempt.quoteFingerprint ? (
            <div className="p4-summary">
              <h2>Your submitted order</h2>
              <p>
                {attempt.items.reduce((sum, item) => sum + item.quantity, 0)} items. Retry this
                saved request to confirm its original result.
              </p>
            </div>
          ) : quote.isPending && !attempt ? (
            <ResourceState loading />
          ) : quote.isError ? (
            <ResourceState
              error={quote.error}
              retry={() => {
                void quote.refetch()
              }}
            />
          ) : quote.data ? (
            <>
              <OrderSummary quote={quote.data.data} />
              {quote.data.data.warehouse && (
                <div className="p4-site-note">
                  <span className="auth-eyebrow">READY TO FILL YOUR BAG</span>
                  <strong>{quote.data.data.warehouse.name}</strong>
                  <p>
                    Selected automatically. The site may change if stock changes before you reserve.
                  </p>
                </div>
              )}
              {!quote.data.data.canOrder && !attempt && (
                <p className="p4-error" role="alert">
                  This bag cannot be filled from a single warehouse. Return to your bag to adjust
                  quantities.
                </p>
              )}
            </>
          ) : attempt ? (
            <div className="p4-summary">
              <h2>Your submitted order</h2>
              <p>
                {attempt.items.reduce((sum, item) => sum + item.quantity, 0)} items. Retry the saved
                request to confirm the result.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
