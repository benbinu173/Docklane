import { createDatabase, createAuthSessionStore } from '@docklane/database'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { remoteIdentityVerifier } from './identity.js'
import { createStripeProvider } from '@docklane/domain'

const config = loadConfig()
const db = createDatabase(config.DATABASE_URL)
const authStore = createAuthSessionStore(config.NEON_AUTH_DATABASE_URL || config.DATABASE_URL, {
  onIdleError: () =>
    console.warn(
      'Docklane: an idle authentication database connection closed. The pool will reconnect on the next request.',
    ),
})
const app = createApp({
  db,
  verifyIdentity: remoteIdentityVerifier(
    authStore,
    config.NEON_AUTH_BASE_URL,
    config.NEON_AUTH_JWKS_URL,
  ),
  businessId: config.BUSINESS_ID,
  origins: config.WEB_ORIGINS.split(',').map((origin) => origin.trim()),
  logLevel: config.LOG_LEVEL,
  payments:
    config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET && config.CHECKOUT_RETURN_ORIGIN
      ? {
          ...createStripeProvider(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET),
          returnOrigin: config.CHECKOUT_RETURN_ORIGIN,
        }
      : undefined,
})
const server = app.listen(config.PORT, config.API_HOST, () =>
  console.log(`Docklane API listening at http://${config.API_HOST}:${config.PORT}`),
)
let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  const deadline = setTimeout(() => process.exit(1), 10_000).unref()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await Promise.all([db.$disconnect(), authStore.close()])
  clearTimeout(deadline)
}
process.once('SIGINT', () => {
  void shutdown()
})
process.once('SIGTERM', () => {
  void shutdown()
})
