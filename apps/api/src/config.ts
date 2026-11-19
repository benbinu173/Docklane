import { config as dotenv } from 'dotenv'
import { z } from 'zod'
import { fileURLToPath } from 'node:url'

dotenv({
  path: ['../../../.env.local', '../../../.env'].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  ),
  quiet: true,
})
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.url(),
  NEON_AUTH_DATABASE_URL: z.url().optional().or(z.literal('')),
  NEON_AUTH_BASE_URL: z.url(),
  NEON_AUTH_JWKS_URL: z.url(),
  WEB_ORIGINS: z.string().min(1),
  BUSINESS_ID: z.string().min(1).default('northstar-supply'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_test_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  CHECKOUT_RETURN_ORIGIN: z.url().optional(),
})
export type AppConfig = z.infer<typeof schema>
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(env)
  if (!result.success)
    throw new Error(
      `Invalid API configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}. Configure .env.local; secret values are not logged.`,
    )
  const origins = result.data.WEB_ORIGINS.split(',').map((origin) => origin.trim())
  if (origins.some((origin) => new URL(origin).origin !== origin))
    throw new Error('WEB_ORIGINS must contain exact origins without paths or trailing slashes.')
  const paymentFields = [
    result.data.STRIPE_SECRET_KEY,
    result.data.STRIPE_WEBHOOK_SECRET,
    result.data.CHECKOUT_RETURN_ORIGIN,
  ]
  if (paymentFields.some(Boolean) && !paymentFields.every(Boolean))
    throw new Error('Configure all three Stripe test checkout variables, or leave them unset.')
  if (result.data.CHECKOUT_RETURN_ORIGIN && !origins.includes(result.data.CHECKOUT_RETURN_ORIGIN))
    throw new Error('CHECKOUT_RETURN_ORIGIN must be an exact allowed WEB_ORIGINS origin.')
  return result.data
}
