import { z } from 'zod'

export const operationSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.uuid(),
})
export const shipmentSchema = operationSchema.extend({
  carrier: z.string().trim().min(2).max(100),
  trackingReference: z.string().trim().min(2).max(150),
  trackingUrl: z
    .url()
    .max(1000)
    .refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS tracking address.')
    .nullable()
    .default(null),
})
export const returnReceiptSchema = operationSchema.extend({
  items: z
    .array(
      z.strictObject({
        sku: z.string().trim().min(1).max(40),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (items) => new Set(items.map((item) => item.sku)).size === items.length,
      'Choose each item once.',
    ),
})
export const restockSchema = operationSchema.extend({ quantity: z.number().int().min(1).max(99) })
export const refundRequestSchema = operationSchema.extend({
  amountPaise: z.number().int().positive().max(2_000_000_000),
})
export type OperationInput = z.infer<typeof operationSchema>
export type ShipmentInput = z.infer<typeof shipmentSchema>
export type ReturnReceiptInput = z.infer<typeof returnReceiptSchema>
export type RestockInput = z.infer<typeof restockSchema>
export type RefundRequestInput = z.infer<typeof refundRequestSchema>
export interface OrderTimelineEvent {
  id: string
  action: string
  actor: string
  createdAt: string
  metadata: Record<string, unknown>
}
