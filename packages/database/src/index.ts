import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

export { Prisma, PrismaClient } from '@prisma/client'
function connectionUrl(url: string) {
  const parsed = new URL(url)
  if (parsed.hostname.endsWith('.neon.tech') && parsed.searchParams.get('sslmode') === 'require')
    parsed.searchParams.set('sslmode', 'verify-full')
  return parsed.toString()
}
export function createDatabase(url: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: connectionUrl(url),
      max: 10,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 10_000,
    }),
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  })
}
export function createAuthSessionStore(
  url: string,
  options: { applicationName?: string; onIdleError?: (error: Error) => void } = {},
) {
  const pool = new Pool({
    connectionString: connectionUrl(url),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 5_000,
    application_name: options.applicationName ?? 'docklane-auth-session',
  })
  // pg removes a failed idle client itself. Observe the error so EventEmitter
  // does not terminate the API; the next query obtains a fresh connection.
  pool.on('error', (error) => {
    options.onIdleError?.(error)
  })
  return {
    async verify(token: string, subject: string) {
      const result = await pool.query<{ id: string; name: string; email: string }>(
        'SELECT s.id, u.name, u.email FROM neon_auth.session s JOIN neon_auth."user" u ON u.id = s."userId" WHERE s.token = $1 AND s."userId" = $2 AND s."expiresAt" > CURRENT_TIMESTAMP LIMIT 1',
        [token, subject],
      )
      return result.rows[0] ?? null
    },
    close: () => pool.end(),
  }
}
