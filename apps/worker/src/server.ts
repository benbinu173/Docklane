import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { config as dotenv } from 'dotenv'
import { z } from 'zod'
import { createDatabase } from '@docklane/database'
import { createStripeProvider } from '@docklane/domain'
import { createWorkerRuntime } from './runtime.js'

dotenv({
  path: ['../../../.env.local', '../../../.env'].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  ),
  quiet: true,
})
const parsed = z
  .object({
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    BUSINESS_ID: z.string().min(1),
    WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4010),
    WORKER_HOST: z.string().default('127.0.0.1'),
  })
  .safeParse(process.env)
if (!parsed.success)
  throw new Error(
    `Configure worker variables: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}.`,
  )
const config = parsed.data
const secretKey = process.env.STRIPE_SECRET_KEY,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
if (!!secretKey !== !!webhookSecret)
  throw new Error(
    'Configure both Stripe test credentials, or leave both unset for expiry-only operation.',
  )
const provider =
  secretKey && webhookSecret ? createStripeProvider(secretKey, webhookSecret).provider : undefined
const db = createDatabase(config.DATABASE_URL)
let lastWarning = 0
const runtime = createWorkerRuntime(db, {
  businessId: config.BUSINESS_ID,
  redisUrl: config.REDIS_URL,
  queueNamespace: new URL(config.DATABASE_URL).hostname + new URL(config.DATABASE_URL).pathname,
  provider,
  onError: (code) => {
    if (Date.now() - lastWarning > 30_000) {
      console.warn(`Docklane worker: ${code}. Database-backed recovery remains scheduled.`)
      lastWarning = Date.now()
    }
  },
})
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Cache-Control', 'no-store')
  if (request.url !== '/health/ready') {
    response.writeHead(404).end(JSON.stringify({ status: 'not_found' }))
    return
  }
  try {
    await db.$queryRaw`SELECT 1`
    response.end(
      JSON.stringify({ status: 'ready', paymentsConfigured: !!provider, expirySweep: true }),
    )
  } catch {
    response.writeHead(503).end(JSON.stringify({ status: 'unavailable' }))
  }
})
server.listen(config.WORKER_PORT, config.WORKER_HOST, () =>
  console.log(
    `Docklane worker listening at http://${config.WORKER_HOST}:${config.WORKER_PORT}${provider ? '' : ' (expiry only; Stripe keys are unset)'}`,
  ),
)
let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  const deadline = setTimeout(() => process.exit(1), 15_000).unref()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await runtime.close()
  await db.$disconnect()
  clearTimeout(deadline)
}
process.once('SIGINT', () => {
  void shutdown()
})
process.once('SIGTERM', () => {
  void shutdown()
})
