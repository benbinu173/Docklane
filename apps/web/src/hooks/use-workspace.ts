import { useNavigate, useSearchParams } from 'react-router-dom'
import { warehouses } from '@/data/demo'

export function useWorkspace() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const rawWarehouse = params.get('warehouse') ?? 'all'
  const warehouse = warehouses.some((item) => item.id === rawWarehouse) ? rawWarehouse : 'all'
  function update(values: Record<string, string | null>) {
    // Router transitions may still be rendering the preceding filter selection.
    // Compose a new action with the URL already committed by the previous one.
    const next = new URLSearchParams(window.location.search)
    Object.entries(values).forEach(([key, value]) =>
      value && value !== 'all' ? next.set(key, value) : next.delete(key),
    )
    setParams(next, { replace: true, preventScrollReset: true })
  }
  function go(path: string, values: Record<string, string> = {}) {
    const next = new URLSearchParams(warehouse === 'all' ? {} : { warehouse })
    Object.entries(values).forEach(([key, value]) =>
      value !== 'all' ? next.set(key, value) : next.delete(key),
    )
    navigate(`${path}${next.size ? `?${next}` : ''}`)
  }
  return { params, warehouse, update, go }
}
