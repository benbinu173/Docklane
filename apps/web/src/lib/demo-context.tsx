import { createContext, useContext, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  initialOrders,
  initialStock,
  type Order,
  type PreviewState,
  type StockItem,
} from '@/data/demo'

interface DemoContextValue {
  orders: Order[]
  stock: StockItem[]
  previewState: PreviewState
  setPreviewState: (state: PreviewState) => void
  resetDemo: () => void
  packOrder: (id: string) => void
  adjustStock: (id: string, quantity: number, reason: string) => string | null
}
const DemoContext = createContext<DemoContextValue | null>(null)

export function DemoProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState(initialOrders)
  const [stock, setStock] = useState(initialStock)
  const [previewState, setPreviewState] = useState<PreviewState>('populated')

  function resetDemo() {
    setOrders(initialOrders)
    setStock(initialStock)
    setPreviewState('populated')
    toast.success('Demo restored', {
      description: 'The original sample orders and stock are back.',
    })
  }
  function packOrder(id: string) {
    const order = orders.find((item) => item.id === id)
    if (order?.stage !== 'ready') return
    setOrders((current) =>
      current.map((item) => (item.id === id ? { ...item, stage: 'packed' } : item)),
    )
    toast.success(`${id} marked packed in the demo`, {
      description: 'Sample changes reset when you reload.',
    })
  }
  function adjustStock(id: string, quantity: number, reason: string) {
    const item = stock.find((row) => row.id === id)
    if (!item) return 'This stock item could not be found.'
    if (!Number.isSafeInteger(quantity) || quantity === 0 || Math.abs(quantity) > 100_000)
      return 'Enter a whole number between -100,000 and 100,000, excluding zero.'
    if (item.onHand + quantity < item.reserved)
      return `This would leave fewer than ${item.reserved} reserved units. Reduce the adjustment.`
    if (reason.trim().length < 3) return 'Add a reason with at least 3 characters.'
    setStock((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              onHand: row.onHand + quantity,
              adjustments: [
                { quantity, reason: reason.trim(), time: new Date().toISOString() },
                ...row.adjustments,
              ],
            }
          : row,
      ),
    )
    toast.success('Demo stock updated', {
      description: 'This is a sample adjustment. Changes reset when you reload.',
    })
    return null
  }
  return (
    <DemoContext.Provider
      value={{ orders, stock, previewState, setPreviewState, resetDemo, packOrder, adjustStock }}
    >
      {children}
    </DemoContext.Provider>
  )
}

// The provider and its hook share a file deliberately.
// eslint-disable-next-line react-refresh/only-export-components
export function useDemo() {
  const context = useContext(DemoContext)
  if (!context) throw new Error('useDemo must be called inside DemoProvider')
  return context
}
