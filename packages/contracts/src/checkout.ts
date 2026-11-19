import { z } from 'zod'

export const cartItemsSchema = z
  .array(
    z.strictObject({
      sku: z.string().trim().min(1).max(40),
      quantity: z.number().int().min(1).max(99),
    }),
  )
  .min(1)
  .max(20)
export const deliveryAddressSchema = z.strictObject({
  line: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(80),
  postalCode: z
    .string()
    .trim()
    .regex(/^[1-9]\d{5}$/, 'Enter a valid six-digit Indian PIN code.'),
  country: z.literal('IN'),
})
export const checkoutQuoteSchema = z.strictObject({ items: cartItemsSchema })
export const checkoutSchema = checkoutQuoteSchema.extend({
  deliveryAddress: deliveryAddressSchema,
  quoteFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.uuid(),
})
export const cancellationSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.uuid(),
})
export type CartItem = z.infer<typeof cartItemsSchema>[number]
export type CheckoutInput = z.infer<typeof checkoutSchema>
export type CancellationInput = z.infer<typeof cancellationSchema>
export interface CheckoutQuote {
  items: {
    sku: string
    name: string
    image: string
    quantity: number
    unitPricePaise: number
    totalPaise: number
    available: number
  }[]
  subtotalPaise: number
  shippingPaise: number
  totalPaise: number
  currency: 'INR'
  warehouse: { id: string; name: string; city: string } | null
  quoteFingerprint: string
  canOrder: boolean
}
