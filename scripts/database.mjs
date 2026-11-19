import { config } from 'dotenv'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

config({ path: ['.env.local', '.env'], quiet: true })
const action = process.argv[2]
const prismaConfig = resolve('packages/database/prisma.config.ts')
const cli = resolve('node_modules/prisma/build/index.js')
const env = { ...process.env }
if (action === 'test-migrate') {
  if (!env.TEST_DATABASE_URL || !new URL(env.TEST_DATABASE_URL).pathname.endsWith('/docklane_test'))
    throw new Error('TEST_DATABASE_URL must point to the dedicated docklane_test database.')
  env.DATABASE_URL = env.TEST_DATABASE_URL
  env.DATABASE_URL_UNPOOLED = env.TEST_DATABASE_URL
} else if (action === 'generate') {
  env.DATABASE_URL ||= 'postgresql://unused@127.0.0.1:55432/docklane'
  env.DATABASE_URL_UNPOOLED ||= env.DATABASE_URL
} else if (action === 'migrate') {
  if (!env.DATABASE_URL || !env.DATABASE_URL_UNPOOLED)
    throw new Error('Configure pooled and direct database URLs in .env.local before migrating.')
  if (new URL(env.DATABASE_URL_UNPOOLED).hostname.includes('-pooler'))
    throw new Error('Migrations require the direct, non-pooled database URL.')
} else throw new Error('Use generate, migrate, or test-migrate.')
const args = action === 'generate' ? ['generate'] : ['migrate', 'deploy']
const result = spawnSync(process.execPath, [cli, ...args, '--config', prismaConfig], {
  env,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
