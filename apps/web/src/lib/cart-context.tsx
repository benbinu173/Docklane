import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { cartItemsSchema, type CartItem } from '@docklane/contracts'
import { useIdentity } from './identity-context'

interface CartValue {
  items: CartItem[]
  count: number
  add: (sku: string, quantity: number) => void
  quantity: (sku: string, quantity: number) => void
  remove: (sku: string) => void
  clear: () => void
  complete: (submitted: CartItem[]) => void
}
const CartContext = createContext<CartValue | null>(null)
function savedBag(key: string): CartItem[] {
  try {
    const parsed = cartItemsSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? '[]'))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}
export function CartProvider({ children }: { children: ReactNode }) {
  const { session } = useIdentity()
  const owner = session?.user.id ?? 'signed-out'
  const key = `docklane.bag:${owner}`
  const [bags, setBags] = useState<Record<string, CartItem[]>>({})
  const items = useMemo(() => bags[owner] ?? savedBag(key), [bags, owner, key])
  function setItems(change: (current: CartItem[]) => CartItem[]) {
    setBags((current) => ({ ...current, [owner]: change(current[owner] ?? savedBag(key)) }))
  }
  useEffect(() => {
    try {
      if (items.length) localStorage.setItem(key, JSON.stringify(items))
      else localStorage.removeItem(key)
    } catch {
      /* The current tab remains usable if browser storage is unavailable. */
    }
  }, [items, key])
  return (
    <CartContext.Provider
      value={{
        items,
        count: items.reduce((sum, line) => sum + line.quantity, 0),
        add: (sku, quantity) =>
          setItems((current) =>
            current.some((line) => line.sku === sku)
              ? current.map((line) =>
                  line.sku === sku
                    ? { ...line, quantity: Math.min(99, line.quantity + quantity) }
                    : line,
                )
              : current.length < 20
                ? [...current, { sku, quantity: Math.min(99, Math.max(1, quantity)) }]
                : current,
          ),
        quantity: (sku, quantity) =>
          setItems((current) =>
            current.map((line) =>
              line.sku === sku
                ? { ...line, quantity: Math.min(99, Math.max(1, Math.round(quantity) || 1)) }
                : line,
            ),
          ),
        remove: (sku) => setItems((current) => current.filter((line) => line.sku !== sku)),
        clear: () => setItems(() => []),
        complete: (submitted) =>
          setItems((current) => {
            const counts = new Map<string, number>()
            for (const line of submitted)
              counts.set(line.sku, (counts.get(line.sku) ?? 0) + line.quantity)
            return current
              .map((line) => ({ ...line, quantity: line.quantity - (counts.get(line.sku) ?? 0) }))
              .filter((line) => line.quantity > 0)
          }),
      }}
    >
      {children}
    </CartContext.Provider>
  )
}
// Context and its hook share the same lifetime.
// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const cart = useContext(CartContext)
  if (!cart) throw new Error('CartProvider is required.')
  return cart
}
