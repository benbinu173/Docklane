import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIdentity } from './identity-context'
import type {
  InventoryRecord,
  InventorySummary,
  Paginated,
  ProductRecord,
  WarehouseRecord,
} from '@docklane/contracts'

export const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100)
export const timestamp = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
export type InventoryPage = Paginated<InventoryRecord> & { summary: InventorySummary }
export function useResourceView(pageSize = 8) {
  const [params, setParams] = useSearchParams()
  const query = new URLSearchParams(params)
  query.delete('stockId')
  query.delete('product')
  query.set('pageSize', String(pageSize))
  function update(values: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true, preventScrollReset: true })
  }
  return { params, query: query.toString(), update, clear: () => setParams({}) }
}
export function useStockOptions({
  productSearch = '',
  warehouseSearch = '',
  archive = 'all',
}: { productSearch?: string; warehouseSearch?: string; archive?: 'active' | 'all' } = {}) {
  const { api } = useIdentity()
  const products = useQuery({
    queryKey: ['phase3', 'products', 'options', productSearch, archive],
    queryFn: () =>
      api<Paginated<ProductRecord>>(
        `/products?pageSize=100&archive=${archive}&q=${encodeURIComponent(productSearch)}`,
      ),
  })
  const warehouses = useQuery({
    queryKey: ['phase3', 'warehouses', 'options', warehouseSearch, archive],
    queryFn: () =>
      api<Paginated<WarehouseRecord>>(
        `/warehouses?pageSize=100&archive=${archive}&q=${encodeURIComponent(warehouseSearch)}`,
      ),
  })
  return { products, warehouses }
}
export function useRefreshStock() {
  const cache = useQueryClient()
  return async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['phase3'] }),
      cache.invalidateQueries({ queryKey: ['connected', 'workspace'] }),
    ])
  }
}
