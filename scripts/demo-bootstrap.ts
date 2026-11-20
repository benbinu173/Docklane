import { readFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { createDatabase } from '@docklane/database'
import { validateDeployment } from './deployment-config.mjs'
import { bootstrapDemo } from './demo-bootstrap-lib.js'

try {
  validateDeployment(process.env, 'bootstrap')
  const file = process.env.DEMO_ACCOUNTS_FILE
  if (!file) throw new Error('Configure DEMO_ACCOUNTS_FILE inside .local/release/.')
  const boundary = resolve('.local/release')
  const target = resolve(file)
  const within = relative(boundary, target)
  if (!within || within.startsWith('..') || isAbsolute(within))
    throw new Error('Demo account files must stay inside .local/release/.')
  const saved = JSON.parse(await readFile(target, 'utf8')) as {
    authUrl?: string
    accounts?: unknown
  }
  if (saved.authUrl !== process.env.NEON_AUTH_BASE_URL || !saved.accounts)
    throw new Error('The private account file must belong to the isolated demo Auth provider.')
  if (process.argv[2] !== '--apply') {
    console.log(
      'Demo bootstrap plan: verify existing demo Auth identities; create catalog, warehouses, opening stock and roles in empty application tables. No orders or payments are fabricated. Run with --apply after reviewing the demo target.',
    )
  } else {
    const db = createDatabase(process.env.DATABASE_URL_UNPOOLED!)
    try {
      console.log(await bootstrapDemo(db, saved.accounts, process.env.BUSINESS_ID!))
    } finally {
      await db.$disconnect()
    }
  }
} catch {
  // Provider/SQL/file errors may contain identities or credentials. Keep diagnostics private.
  console.error(
    'Demo bootstrap failed safely. Check target guards, private identities, migrations, and empty application tables. No credentials were printed.',
  )
  process.exitCode = 1
}
