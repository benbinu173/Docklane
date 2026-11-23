import { createDatabase } from '@docklane/database'
import { createDatabaseRecoveryRuntime, createStripeProvider } from '@docklane/domain'
import { validateDeployment } from './deployment-config.mjs'

let db, runtime
try {
  validateDeployment(process.env, 'maintenance')
  db = createDatabase(process.env.DATABASE_URL_UNPOOLED)
  const errors = []
  runtime = createDatabaseRecoveryRuntime(db, {
    businessId: process.env.BUSINESS_ID,
    provider: createStripeProvider(process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET)
      .provider,
    autoStart: false,
    onError: (code) => errors.push(code),
  })
  // Bounded work, with retries/leases persisted for the next API wake or scheduled run.
  for (let batch = 0; batch < 3; batch++) await runtime.tick()
  if (errors.length) {
    console.error(`Demo maintenance needs review: ${[...new Set(errors)].join(', ')}.`)
    process.exitCode = 1
  } else console.log('Demo expiry/recovery maintenance completed; no credentials printed.')
} catch {
  console.error('Demo maintenance failed safely; check its demo target and test credentials.')
  process.exitCode = 1
} finally {
  await runtime?.close()
  await db?.$disconnect()
}
