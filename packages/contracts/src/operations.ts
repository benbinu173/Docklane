import { z } from 'zod'
import type { OrderSummary } from './index.js'

export const calendarDate = z.iso.date()
export const dateFilters = { from: calendarDate.optional(), to: calendarDate.optional() }
export const validDateRange = (query: { from?: string; to?: string }) =>
  !query.from || !query.to || query.from <= query.to
export const orderQueues = ['open', 'payment', 'pack', 'ship', 'refund', 'returns'] as const
export const workspaceQuerySchema = z
  .object({
    warehouse: z.string().trim().min(1).max(80).optional(),
    ...dateFilters,
  })
  .refine(validDateRange, { message: 'The end date must be on or after the start date.' })
export const quickSearchSchema = z.object({ q: z.string().trim().min(2).max(100) })
export interface OperationsOverview {
  business: { id: string; name: string; timezone: string; currency: string }
  asOf: string
  metrics: {
    openOrders: number
    orders: number
    availableUnits: number
    reservedUnits: number
    lowStockLevels: number
    outOfStockLevels: number
    capturedPaise: number
    refundedPaise: number
  }
  queues: Record<(typeof orderQueues)[number], number>
  warehouses: {
    id: string
    name: string
    city: string
    code: string
    availableUnits: number
    reservedUnits: number
  }[]
  recentOrders: OrderSummary[]
  activity: {
    id: string
    action: string
    entityType: string
    entityId: string
    actor: string
    createdAt: string
    href: string | null
  }[]
}
export interface SearchResult {
  id: string
  label: string
  detail: string
  href: string
  kind: 'Order' | 'Product' | 'Warehouse'
}
