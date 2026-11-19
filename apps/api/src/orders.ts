import type { Prisma } from '@docklane/database'
import { orderRecordInclude, refundCapacity } from '@docklane/domain'
import type { OrderSummary, OrderDetail } from '@docklane/contracts'
import { z } from 'zod'

export const orderInclude = orderRecordInclude
type StoredOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>
export function orderSummary(order: StoredOrder): OrderSummary {
  return {
    id: order.id,
    number: order.number,
    customerName: order.customerName,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    totalPaise: order.totalPaise,
    currency: 'INR',
    createdAt: order.createdAt.toISOString(),
    warehouse: order.warehouse,
    items: order.items.map(({ sku, name, image, quantity, unitPricePaise, totalPaise }) => ({
      sku,
      name,
      image,
      quantity,
      unitPricePaise,
      totalPaise,
    })),
  }
}
export function orderDetail(order: StoredOrder): OrderDetail {
  const deliveryAddress = z
    .object({ line: z.string(), city: z.string(), postalCode: z.string(), country: z.string() })
    .parse(order.deliveryAddress)
  return {
    ...orderSummary(order),
    deliveryAddress,
    subtotalPaise: order.subtotalPaise,
    shippingPaise: order.shippingPaise,
    expiresAt: order.expiresAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    expiredAt: order.expiredAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    packedAt: order.packedAt?.toISOString() ?? null,
    shipment: order.shipment
      ? {
          id: order.shipment.id,
          carrier: order.shipment.carrier,
          trackingReference: order.shipment.trackingReference,
          trackingUrl: order.shipment.trackingUrl,
          shippedAt: order.shipment.shippedAt.toISOString(),
          actor: order.shipment.shipper.name,
          reason: order.shipment.reason,
        }
      : null,
    returns: order.returns.map((receipt) => ({
      id: receipt.id,
      reason: receipt.reason,
      actor: receipt.receiver.name,
      receivedAt: receipt.receivedAt.toISOString(),
      items: receipt.items.map((item) => ({
        id: item.id,
        sku: item.orderItem.sku,
        quantity: item.quantity,
        restockedQuantity: item.restockedQuantity,
      })),
    })),
    refunds:
      order.payment?.refunds.map((refund) => ({
        id: refund.id,
        amountPaise: refund.amountPaise,
        reason: refund.reason,
        status: refund.status,
        purpose: refund.purpose,
        actor: refund.requester.name,
        createdAt: refund.createdAt.toISOString(),
        resolvedAt: refund.resolvedAt?.toISOString() ?? null,
      })) ?? [],
    refundTotals: refundCapacity(order.payment),
    payment: order.payment
      ? {
          provider: order.payment.provider,
          sessionStarted: !!order.payment.sessionId,
          refundStatus: order.payment.refunds[0]?.status ?? null,
        }
      : null,
    reservations: order.reservations.map((reservation) => ({
      sku: reservation.balance.sku,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt.toISOString(),
    })),
  }
}
