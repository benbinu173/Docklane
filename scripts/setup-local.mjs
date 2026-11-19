import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { parse } from 'dotenv'

const path = '.env.local'
const current = (await readFile(path, 'utf8').catch(() => ''))
  .split(/\r?\n/)
  .filter((line) => !/^(NEON_AI_GATEWAY_|NEON_FUNCTION_HOST_SUFFIX=)/.test(line))
  .join('\n')
const values = parse(current)
const password = values.POSTGRES_PASSWORD || randomBytes(24).toString('hex')
const localUrl = `postgresql://docklane:${password}@127.0.0.1:55432/docklane`
const defaults = {
  NODE_ENV: 'development',
  PORT: '4000',
  API_HOST: '127.0.0.1',
  WEB_ORIGINS:
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173',
  POSTGRES_PASSWORD: password,
  TEST_DATABASE_URL: `${localUrl}_test`,
  REDIS_URL: 'redis://127.0.0.1:56379',
  VITE_API_URL: 'http://localhost:4000',
  BUSINESS_ID: 'northstar-supply',
  ALLOW_DEVELOPMENT_SEED: 'true',
  ...(values.NEON_AUTH_BASE_URL ? { VITE_NEON_AUTH_URL: values.NEON_AUTH_BASE_URL } : {}),
}
const additions = Object.entries(defaults)
  .filter(([key]) => !values[key])
  .map(([key, value]) => `${key}=${value}`)
await writeFile(path, `${current.trimEnd()}\n${additions.join('\n')}\n`, { mode: 0o600 })
console.log(
  'Local PostgreSQL/test database and application defaults configured in .env.local. Existing values were preserved.',
)
