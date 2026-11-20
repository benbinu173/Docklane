import { z } from 'zod'
import type { PrismaClient } from '@docklane/database'
import { initialStock, products, warehouses } from '../apps/web/src/data/demo.js'

const identitiesSchema = z
  .array(
    z.object({
      authSubject: z.string().min(1).max(300),
      email: z.email(),
      role: z.enum(['ADMIN', 'OPERATOR', 'CUSTOMER']),
    }),
  )
  .min(3)
  .max(20)

export async function bootstrapDemo(db: PrismaClient, rawIdentities: unknown, businessId: string) {
  const parsed = identitiesSchema.safeParse(rawIdentities)
  if (!parsed.success) throw new Error('Supply valid private demo identity records.')
  const identities = parsed.data
  if (
    new Set(identities.map((identity) => identity.authSubject)).size !== identities.length ||
    new Set(identities.map((identity) => identity.email.toLowerCase())).size !==
      identities.length ||
    identities.filter((identity) => identity.role === 'ADMIN').length !== 1 ||
    !identities.some((identity) => identity.role === 'OPERATOR') ||
    !identities.some((identity) => identity.role === 'CUSTOMER')
  )
    throw new Error(
      'Demo identities require unique subjects/emails and Admin, Operator, Customer roles.',
    )
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(684921907)`
      // Bootstrap once. Never overwrite orders, profiles, balances, or audit history.
      const counts = [
        await tx.business.count(),
        await tx.userProfile.count(),
        await tx.product.count(),
        await tx.warehouse.count(),
        await tx.inventoryBalance.count(),
        await tx.order.count(),
        await tx.outboxEvent.count(),
        await tx.webhookReceipt.count(),
      ]
      if (counts.some((count) => count > 0))
        throw new Error(
          'Demo bootstrap requires empty application tables. Rotate to a new demo branch.',
        )
      const verified = []
      for (const identity of identities) {
        const rows = await tx.$queryRaw<{ id: string; name: string; email: string }[]>`
        SELECT id, name, email FROM neon_auth."user" WHERE id = ${identity.authSubject}`
        if (rows.length !== 1 || rows[0].email.toLowerCase() !== identity.email.toLowerCase())
          throw new Error('A demo identity does not match a user in this demo Auth database.')
        verified.push({ ...identity, name: rows[0].name })
      }
      await tx.business.create({ data: { id: businessId, name: 'Northstar Supply' } })
      const profiles = []
      for (const identity of verified)
        profiles.push(await tx.userProfile.create({ data: { ...identity, businessId } }))
      const admin = profiles.find((profile) => profile.role === 'ADMIN')!
      await tx.product.createMany({
        data: products.map((product) => ({
          sku: product.sku,
          name: product.name,
          category: product.category,
          pricePaise: product.price,
          image: product.image,
          color: product.color,
          businessId,
        })),
      })
      await tx.warehouse.createMany({
        data: warehouses.map((warehouse, priority) => ({
          ...warehouse,
          priority,
          businessId,
        })),
      })
      const openingTime = new Date()
      await tx.inventoryBalance.createMany({
        data: initialStock.map((stock) => ({
          id: stock.id,
          sku: stock.sku,
          warehouseId: stock.warehouse,
          onHand: stock.onHand,
          reserved: 0,
          threshold: stock.threshold,
          version: 1,
        })),
      })
      await tx.inventoryMovement.createMany({
        data: initialStock.map((stock) => ({
          id: `demo-opening:${stock.id}`,
          balanceId: stock.id,
          type: 'OPENING' as const,
          deltaOnHand: stock.onHand,
          deltaReserved: 0,
          onHandAfter: stock.onHand,
          reservedAfter: 0,
          balanceVersion: 1,
          reason: 'Opening isolated demo inventory',
          actorId: admin.id,
          createdAt: openingTime,
        })),
      })
      await tx.auditEvent.create({
        data: {
          businessId,
          actorId: admin.id,
          action: 'DEMO_BOOTSTRAP',
          entityType: 'business',
          entityId: businessId,
          metadata: {
            products: products.length,
            warehouses: warehouses.length,
            balances: initialStock.length,
            profiles: profiles.length,
            syntheticOrders: 0,
          },
        },
      })
      return {
        products: products.length,
        warehouses: warehouses.length,
        balances: initialStock.length,
        profiles: profiles.length,
        orders: 0,
      }
    },
    { timeout: 120_000, maxWait: 20_000 },
  )
}
