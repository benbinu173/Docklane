import type { PrismaClient } from '@docklane/database'
import type { PaymentProvider } from './payment-provider.js'
import { dueOutboxEvents, processOutboxEvent, sweepExpiredOrders } from './payments.js'

// PostgreSQL retains the work and leases. Suitable for a sleeping portfolio API
// or a bounded scheduled run; the dedicated BullMQ worker remains available locally.
export function createDatabaseRecoveryRuntime(
  db: PrismaClient,
  options: {
    businessId: string
    provider?: PaymentProvider
    intervalMs?: number
    autoStart?: boolean
    onError?: (code: string) => void
  },
) {
  const interval = options.intervalMs ?? 60_000
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 300_000)
    throw new Error('Recovery interval must be between one second and five minutes.')
  let closed = false
  let active: Promise<void> | null = null
  function tick(): Promise<void> {
    if (closed) return Promise.resolve()
    if (active) return active
    active = (async () => {
      try {
        await sweepExpiredOrders(db, options.businessId, 50)
        const due = await dueOutboxEvents(db, options.businessId, 10)
        for (const event of due) {
          if (closed) break
          if (!options.provider) {
            const stored = await db.outboxEvent.findUnique({
              where: { id: event.id },
              select: { type: true },
            })
            if (stored?.type.startsWith('STRIPE_')) continue
          }
          try {
            await processOutboxEvent(db, options.businessId, event.id, options.provider)
          } catch {
            options.onError?.('JOB_RETRY_SCHEDULED')
          }
        }
      } catch {
        options.onError?.('RECOVERY_UNAVAILABLE')
      }
    })().finally(() => {
      active = null
    })
    return active
  }
  const timer =
    options.autoStart === false
      ? undefined
      : setInterval(() => {
          void tick()
        }, interval)
  timer?.unref()
  if (options.autoStart !== false) void tick()
  return {
    tick,
    async close() {
      closed = true
      clearInterval(timer)
      await active
    },
  }
}
