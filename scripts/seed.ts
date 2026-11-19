import { config } from 'dotenv'
import { readFile } from 'node:fs/promises'
import { createDatabase } from '@docklane/database'
import { seedDevelopment, type SeedIdentity } from './seed-lib.js'

config({ path: ['.env.local', '.env'], quiet: true })
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEVELOPMENT_SEED !== 'true')
  throw new Error('Database seeding requires an explicitly enabled development environment.')
if (!process.env.DATABASE_URL) throw new Error('Configure the development database first.')
const saved = JSON.parse(await readFile('.local/demo-accounts.json', 'utf8')) as {
  complete: boolean
  authUrl: string
  accounts: SeedIdentity[]
}
if (!saved.complete || saved.authUrl !== process.env.NEON_AUTH_BASE_URL)
  throw new Error('Complete identity seeding for this development branch first.')
const db = createDatabase(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)
try {
  console.log(
    await seedDevelopment(
      db,
      saved.accounts.map(({ name, email, role, authSubject }) => ({
        name,
        email,
        role,
        authSubject,
      })),
    ),
  )
} finally {
  await db.$disconnect()
}
