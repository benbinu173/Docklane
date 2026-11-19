import { z } from 'zod'
import { paginationSchema } from './pagination.js'

export const resourceIdSchema = z.string().min(1).max(80)
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, 'Use 2–32 letters, numbers, dashes, or underscores.')
const imageSchema = z
  .string()
  .max(500)
  .refine(
    (value) =>
      value === '/product-placeholder.svg' ||
      /^\/images\/[a-zA-Z0-9_.-]+$/.test(value) ||
      /^https:\/\//.test(value),
    'Use a local product image or an HTTPS image URL.',
  )
const productFields = {
  name: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(60),
  pricePaise: z.number().int().positive().max(2_000_000_000),
  image: imageSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}
export const productCreateSchema = z.strictObject({
  sku: skuSchema,
  ...productFields,
  image: imageSchema.default('/product-placeholder.svg'),
  color: productFields.color.default('#EDF2E8'),
})
export const productUpdateSchema = z
  .strictObject({
    ...z.object(productFields).partial().shape,
    archived: z.boolean().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine((value) => Object.keys(value).length > 1, 'Choose a field to change.')
const warehouseFields = {
  name: z.string().trim().min(2).max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/),
  city: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(300),
  lead: z.string().trim().min(2).max(80),
  priority: z.number().int().min(0).max(1000),
}
export const warehouseCreateSchema = z.strictObject({
  ...warehouseFields,
  priority: warehouseFields.priority.default(0),
})
export const warehouseUpdateSchema = z
  .strictObject({
    ...z.object(warehouseFields).partial().shape,
    archived: z.boolean().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine((value) => Object.keys(value).length > 1, 'Choose a field to change.')
export const resourceQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  category: z.string().trim().max(60).optional(),
  archive: z.enum(['active', 'archived', 'all']).default('active'),
})
export const inventoryQuerySchema = resourceQuerySchema.extend({
  warehouse: resourceIdSchema.optional(),
  stock: z.enum(['all', 'low', 'reserved', 'out']).default('all'),
  sort: z
    .enum(['product', 'warehouse', 'onHand', 'reserved', 'available', 'updated'])
    .default('product'),
  direction: z.enum(['asc', 'desc']).default('asc'),
})
export const balanceCreateSchema = z.strictObject({ sku: skuSchema, warehouseId: resourceIdSchema })
export const stockAdjustmentSchema = z
  .strictObject({
    type: z.enum(['INCREASE', 'DECREASE', 'SET']),
    quantity: z.number().int().min(0).max(1_000_000_000),
    reason: z.string().trim().min(5).max(300),
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
  })
  .refine(
    (value) => value.type === 'SET' || value.quantity > 0,
    'Use a positive adjustment quantity.',
  )
export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>
export const thresholdSchema = z.strictObject({
  threshold: z.number().int().min(0).max(1_000_000_000),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(5).max(300),
})
export interface ProductRecord {
  sku: string
  name: string
  category: string
  pricePaise: number
  image: string
  color: string
  archived: boolean
  version: number
}
export interface CatalogProduct extends ProductRecord {
  available: number
}
export interface WarehouseRecord {
  id: string
  code: string
  name: string
  city: string
  address: string
  lead: string
  priority: number
  archived: boolean
  version: number
  available: number
  reserved: number
  onHand: number
  levels: number
}
export interface InventoryRecord {
  id: string
  sku: string
  warehouseId: string
  onHand: number
  reserved: number
  available: number
  threshold: number
  version: number
  updatedAt: string
  product: ProductRecord
  warehouse: { id: string; name: string; city: string; code: string; archived: boolean }
}
export interface InventorySummary {
  levels: number
  available: number
  reserved: number
  low: number
  out: number
  withReservations: number
}
export interface StockMovement {
  id: string
  type: string
  deltaOnHand: number
  deltaReserved: number
  onHandAfter: number
  reservedAfter: number
  reason: string
  actor: string
  orderNumber: string | null
  balanceVersion: number | null
  createdAt: string
}
export interface AdjustmentResult {
  balance: { id: string; onHand: number; reserved: number; available: number; version: number }
  movementId: string
}
