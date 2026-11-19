import { createHash } from 'node:crypto'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import type { PrismaClient } from '@docklane/database'
import {
  dueOutboxEvents,
  processOutboxEvent,
  sweepExpiredOrders,
  type PaymentProvider,
} from '@docklane/domain'

export function createWorkerRuntime(
  db: PrismaClient,
  options: {
    businessId: string
    redisUrl: string
    queueNamespace: string
    provider?: PaymentProvider
    intervalMs?: number
    onError?: (code: string) => void
  },
) {
  const url = new URL(options.redisUrl)
  if (!['redis:', 'rediss:'].includes(url.protocol))
    throw new Error('REDIS_URL must use redis or rediss.')
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    connectTimeout: 2000,
  }
  const queueName =
    'docklane-' +
    createHash('sha256')
      .update(options.queueNamespace + ':' + options.businessId)
      .digest('hex')
      .slice(0, 20)
  const queueClient = new Redis({
    ...connection,
    commandTimeout: 3000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  })
  const workerClient = new Redis(connection)
  queueClient.on('error', () => options.onError?.('QUEUE_UNAVAILABLE'))
  workerClient.on('error', () => options.onError?.('QUEUE_UNAVAILABLE'))
  const queue = new Queue(queueName, {
    connection: queueClient,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  })
  let closed = false
  const activeJobs = new Set<Promise<boolean>>()
  const worker = new Worker(
    queueName,
    async (job) => {
      if (closed) return
      const work = processOutboxEvent(
        db,
        options.businessId,
        String(job.data.eventId),
        options.provider,
      )
      activeJobs.add(work)
      try {
        await work
      } finally {
        activeJobs.delete(work)
      }
    },
    { connection: workerClient, concurrency: 4 },
  )
  queue.on('error', () => options.onError?.('QUEUE_UNAVAILABLE'))
  worker.on('error', () => options.onError?.('QUEUE_UNAVAILABLE'))
  worker.on('failed', () => options.onError?.('JOB_RETRY_SCHEDULED'))
  let sweep: Promise<void> | null = null,
    dispatch: Promise<void> | null = null
  function sweepTick() {
    if (closed) return Promise.resolve()
    if (sweep) return sweep
    sweep = (async () => {
      try {
        await sweepExpiredOrders(db, options.businessId)
      } catch {
        options.onError?.('SWEEP_UNAVAILABLE')
      }
    })().finally(() => {
      sweep = null
    })
    return sweep
  }
  function dispatchTick() {
    if (closed) return Promise.resolve()
    if (dispatch) return dispatch
    dispatch = (async () => {
      try {
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
            let deadline: ReturnType<typeof setTimeout> | undefined
            try {
              await Promise.race([
                queue.add(
                  'outbox',
                  { eventId: event.id },
                  { jobId: event.id + '-' + event.attempts },
                ),
                new Promise<never>((_resolve, reject) => {
                  deadline = setTimeout(() => reject(new Error('Queue unavailable')), 2000)
                }),
              ])
            } finally {
              clearTimeout(deadline)
            }
          } catch {
            options.onError?.('QUEUE_UNAVAILABLE')
            if (!closed)
              try {
                await processOutboxEvent(db, options.businessId, event.id, options.provider)
              } catch {
                options.onError?.('JOB_RETRY_SCHEDULED')
              }
          }
        }
      } catch {
        options.onError?.('DISPATCH_UNAVAILABLE')
      }
    })().finally(() => {
      dispatch = null
    })
    return dispatch
  }
  async function tick() {
    await Promise.all([sweepTick(), dispatchTick()])
  }
  const timer = setInterval(() => {
    void tick()
  }, options.intervalMs ?? 5000)
  void tick()
  return {
    tick,
    async close() {
      closed = true
      clearInterval(timer)
      await Promise.all([sweep, dispatch])
      await worker.close(true)
      await Promise.allSettled([...activeJobs])
      await queue.close()
      queueClient.disconnect()
      workerClient.disconnect()
    },
  }
}
