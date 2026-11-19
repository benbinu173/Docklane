import { randomUUID } from 'node:crypto'
import type { PrismaClient, Prisma } from '@docklane/database'
import {
  initialOrders,
  initialStock,
  products,
  warehouses,
  demoDate,
} from '../apps/web/src/data/demo.js'
import type { Role } from '@docklane/contracts'

export interface SeedIdentity {
  name: string
  email: string
  role: Role
  authSubject: string
}
export async function seedDevelopment(db: PrismaClient, identities: SeedIdentity[]) {
  const businessId = 'northstar-supply'
  return db.$transaction(
    async (tx) => {
      await tx.business.upsert({
        where: { id: businessId },
        create: { id: businessId, name: 'Northstar Supply' },
        update: {},
      })
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR UPDATE`
      const profiles = new Map<string, string>()
      const identityByName = new Map(identities.map((identity) => [identity.name, identity]))
      const members = [
        ...identities,
        ...initialOrders
          .filter((order) => !identityByName.has(order.customer))
          .map((order) => ({
            name: order.customer,
            email: `${order.customer.toLowerCase().replaceAll(' ', '.')}@docklane.example.test`,
            role: 'CUSTOMER' as const,
            authSubject: `seed-fixture:${order.customer.toLowerCase().replaceAll(' ', '-')}`,
          })),
      ]
      for (const identity of members) {
        const profile = await tx.userProfile.upsert({
          where: { authSubject: identity.authSubject },
          create: { ...identity, businessId },
          update: {},
        })
        profiles.set(identity.name, profile.id)
      }
      const adminId = profiles.get('Ben Thomas')!
      for (const product of products)
        await tx.product.upsert({
          where: { sku: product.sku },
          create: {
            sku: product.sku,
            name: product.name,
            category: product.category,
            pricePaise: product.price,
            image: product.image,
            color: product.color,
            businessId,
          },
          update: {},
        })
      for (const [priority, warehouse] of warehouses.entries())
        await tx.warehouse.upsert({
          where: { id: warehouse.id },
          create: { ...warehouse, priority, businessId },
          update: {},
        })
      const newBalances = new Set<string>()
      for (const stock of initialStock) {
        if (!(await tx.inventoryBalance.findUnique({ where: { id: stock.id } }))) {
          await tx.inventoryBalance.create({
            data: {
              id: stock.id,
              sku: stock.sku,
              warehouseId: stock.warehouse,
              onHand: stock.onHand,
              reserved: stock.reserved,
              threshold: stock.threshold,
            },
          })
          newBalances.add(stock.id)
        }
      }
      const ledger = new Map(
        initialStock.map((stock) => {
          const shipped = initialOrders
            .filter((order) => order.warehouse === stock.warehouse && order.stage === 'shipped')
            .flatMap((order) => order.items)
            .filter((item) => item.sku === stock.sku)
            .reduce((sum, item) => sum + item.quantity, 0)
          return [stock.id, { onHand: stock.onHand + shipped, reserved: 0 }]
        }),
      )
      for (const balanceId of newBalances) {
        const balance = ledger.get(balanceId)!
        await tx.inventoryMovement.create({
          data: {
            id: `seed-opening:${balanceId}`,
            balanceId,
            type: 'OPENING',
            deltaOnHand: balance.onHand,
            deltaReserved: 0,
            onHandAfter: balance.onHand,
            reservedAfter: 0,
            reason: 'Opening development balance',
            actorId: adminId,
            createdAt: new Date(demoDate.getTime() - 6 * 3_600_000),
          },
        })
      }
      let createdOrders = 0
      for (const sample of [...initialOrders].reverse()) {
        if (await tx.order.findUnique({ where: { number: sample.id } })) continue
        createdOrders++
        const id = randomUUID()
        const createdAt = new Date(sample.createdAt)
        const captured = sample.stage !== 'awaiting'
        const orderStatus =
          sample.stage === 'awaiting'
            ? 'AWAITING_PAYMENT'
            : sample.stage === 'shipped'
              ? 'COMPLETED'
              : sample.stage === 'cancelled'
                ? 'CANCELLED'
                : 'CONFIRMED'
        const paymentStatus =
          sample.stage === 'awaiting'
            ? 'PENDING'
            : sample.stage === 'cancelled'
              ? 'REFUNDED'
              : 'CAPTURED'
        const fulfillmentStatus =
          sample.stage === 'shipped'
            ? 'SHIPPED'
            : sample.stage === 'packed'
              ? 'PACKED'
              : 'UNFULFILLED'
        const reservationStatus =
          sample.stage === 'awaiting'
            ? 'HELD'
            : sample.stage === 'shipped'
              ? 'CONSUMED'
              : sample.stage === 'cancelled'
                ? 'RELEASED'
                : 'ALLOCATED'
        const items = sample.items.map((item) => {
          const product = products.find((product) => product.sku === item.sku)!
          return {
            sku: item.sku,
            name: product.name,
            image: product.image,
            quantity: item.quantity,
            unitPricePaise: product.price,
            totalPaise: product.price * item.quantity,
          }
        })
        const total = items.reduce((sum, item) => sum + item.totalPaise, 0)
        await tx.order.create({
          data: {
            id,
            number: sample.id,
            businessId,
            customerId: profiles.get(sample.customer)!,
            customerName: sample.customer,
            warehouseId: sample.warehouse,
            orderStatus,
            paymentStatus,
            fulfillmentStatus,
            confirmedAt: captured ? new Date(createdAt.getTime() + 60_000) : null,
            packedAt: ['packed', 'shipped'].includes(sample.stage)
              ? new Date(createdAt.getTime() + 2 * 60_000)
              : null,
            subtotalPaise: total,
            totalPaise: total,
            createdAt,
            deliveryAddress: {
              line: sample.address,
              city: warehouses.find((warehouse) => warehouse.id === sample.warehouse)!.city,
              postalCode: sample.address.match(/\d{6}$/)?.[0] ?? '',
              country: 'India',
            },
            expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
            items: { create: items },
            payment: {
              create: {
                provider: 'demo',
                providerReference: captured ? `DEMO-${sample.id}` : null,
                providerIdempotencyKey: `seed-payment:${sample.id}`,
                status: paymentStatus,
                amountPaise: total,
                createdAt,
              },
            },
            reservations: {
              create: items.map((item) => ({
                balanceId: `${item.sku}@${sample.warehouse}`,
                quantity: item.quantity,
                status: reservationStatus,
                expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
                createdAt,
              })),
            },
            ...(sample.stage === 'shipped'
              ? {
                  shipment: {
                    create: {
                      trackingReference: `DEMO-SHIP-${sample.id}`,
                      carrier: 'Sample carrier',
                      shippedBy: adminId,
                      shippedAt: new Date(createdAt.getTime() + 3 * 60_000),
                    },
                  },
                }
              : {}),
          },
        })
        if (sample.stage === 'cancelled') {
          const payment = await tx.payment.findUniqueOrThrow({ where: { orderId: id } })
          await tx.refundAttempt.create({
            data: {
              paymentId: payment.id,
              amountPaise: total,
              reason: 'Completed sample cancellation refund',
              status: 'SUCCEEDED',
              providerIdempotencyKey: `seed-refund:${sample.id}`,
              requestedBy: adminId,
              createdAt,
            },
          })
        }
        for (const item of items) {
          const balanceId = `${item.sku}@${sample.warehouse}`
          if (!newBalances.has(balanceId)) continue
          const balance = ledger.get(balanceId)!
          balance.reserved += item.quantity
          const movement = (
            type: 'RESERVE' | 'SHIP' | 'RELEASE',
            deltaOnHand: number,
            deltaReserved: number,
            minute: number,
          ): Prisma.InventoryMovementCreateInput => ({
            id: `seed-${type}:${sample.id}:${item.sku}`,
            balance: { connect: { id: balanceId } },
            type,
            deltaOnHand,
            deltaReserved,
            onHandAfter: balance.onHand,
            reservedAfter: balance.reserved,
            reason: `${type === 'RESERVE' ? 'Reserved' : type === 'SHIP' ? 'Shipped' : 'Released'} development order ${sample.id}`,
            actor: { connect: { id: adminId } },
            order: { connect: { id } },
            createdAt: new Date(createdAt.getTime() + minute * 60_000),
          })
          await tx.inventoryMovement.create({ data: movement('RESERVE', 0, item.quantity, 0) })
          if (sample.stage === 'shipped') {
            balance.onHand -= item.quantity
            balance.reserved -= item.quantity
            await tx.inventoryMovement.create({
              data: movement('SHIP', -item.quantity, -item.quantity, 3),
            })
          } else if (sample.stage === 'cancelled') {
            balance.reserved -= item.quantity
            await tx.inventoryMovement.create({ data: movement('RELEASE', 0, -item.quantity, 3) })
          }
        }
      }
      for (const stock of initialStock)
        if (newBalances.has(stock.id)) {
          const state = ledger.get(stock.id)!
          if (state.onHand !== stock.onHand || state.reserved !== stock.reserved)
            throw new Error('Seed ledger does not reconcile with the stock balances.')
        }
      return {
        businessId,
        createdBalances: newBalances.size,
        createdOrders,
        seededProfiles: profiles.size,
      }
    },
    { timeout: 120_000, maxWait: 20_000 },
  )
}
