import { config } from 'dotenv'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createDatabase } from '@docklane/database'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
let source, restored
let step = 'target validation'
function docker(args, input) {
  const result = spawnSync('docker', args, {
    input,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.status !== 0 || result.error)
    throw new Error('A local backup/restore command failed; raw diagnostics were not printed.')
  return result.stdout
}
async function fingerprint(db) {
  const tables = await db.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  const result = {}
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected public table name.')
    const [row] = await db.$queryRawUnsafe(`SELECT count(*)::text AS rows,
      md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS hash
      FROM public."${tablename}" t`)
    result[tablename] = row
  }
  const sequences = await db.$queryRaw`
    SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`
  for (const { sequencename } of sequences) {
    if (!/^[a-z_]+$/.test(sequencename)) throw new Error('Unexpected public sequence name.')
    result[`sequence:${sequencename}`] = await db.$queryRawUnsafe(
      `SELECT last_value::text, is_called FROM public."${sequencename}"`,
    )
  }
  return result
}
try {
  if (
    !url ||
    new URL(url).pathname !== '/docklane_test' ||
    !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    new URL(url).port !== '55432'
  )
    throw new Error('Rehearsal requires the Compose loopback docklane_test database on port 55432.')
  step = 'local PostgreSQL discovery'
  const container = docker(['compose', '--env-file', '.env.local', 'ps', '-q', 'postgres'])
    .toString()
    .trim()
  if (!/^[a-f0-9]{12,64}$/.test(container))
    throw new Error('Start the local Compose PostgreSQL first.')
  source = createDatabase(url)
  step = 'source fingerprint'
  const before = await fingerprint(source)
  if (
    !before.inventory_balances ||
    Number(before.inventory_balances.rows) === 0 ||
    !before.orders ||
    Number(before.orders.rows) === 0
  )
    throw new Error('Run integration fixtures first; rehearsal needs stock and orders.')
  step = 'source dump'
  const archive = docker([
    'exec',
    container,
    'pg_dump',
    '--username',
    'docklane',
    '--dbname',
    'docklane_test',
    '--format=custom',
    '--schema=public',
    '--no-owner',
    '--no-acl',
  ])
  const name = `docklane_restore_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  if (!/^docklane_restore_[a-f0-9]{12}$/.test(name))
    throw new Error('Invalid isolated restore target.')
  // createdb refuses existing names. --clean below only touches this newly created database.
  step = 'fresh restore database creation'
  docker(['exec', container, 'createdb', '--username', 'docklane', name])
  step = 'archive restore'
  docker(
    [
      'exec',
      '-i',
      container,
      'pg_restore',
      '--username',
      'docklane',
      '--dbname',
      name,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
    ],
    archive,
  )
  const restoreUrl = new URL(url)
  restoreUrl.pathname = `/${name}`
  restored = createDatabase(restoreUrl.toString())
  step = 'restored content verification'
  const after = await fingerprint(restored)
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Restore fingerprints differ.')
  step = 'source preservation verification'
  const unchanged = await fingerprint(source)
  if (JSON.stringify(before) !== JSON.stringify(unchanged))
    throw new Error('Source changed during rehearsal.')
  step = 'stock invariant verification'
  const [{ invalid }] = await restored.$queryRaw`
    SELECT count(*)::int AS invalid FROM inventory_balances
    WHERE "onHand" < 0 OR reserved < 0 OR reserved > "onHand"`
  if (invalid !== 0) throw new Error('Restored stock constraints are inconsistent.')
  const report = {
    checkedAt: new Date().toISOString(),
    source: 'isolated local docklane_test',
    restoredDatabase: name,
    publicTables: Object.keys(before).filter((key) => !key.startsWith('sequence:')).length,
    stockRows: Number(before.inventory_balances.rows),
    orders: Number(before.orders.rows),
    contentsAndSequencesMatch: true,
    sourceUnchanged: true,
    invalidBalances: invalid,
    archiveBytes: archive.length,
    authSchemaIncluded: false,
  }
  step = 'artifact creation'
  await mkdir('.local/release', { recursive: true })
  await writeFile('.local/release/backup-rehearsal.dump', archive, { mode: 0o600 })
  await writeFile('.local/release/backup-rehearsal.json', JSON.stringify(report, null, 2), {
    mode: 0o600,
  })
  console.log(JSON.stringify(report, null, 2))
} catch {
  console.error(
    `Local backup rehearsal failed at ${step}; raw diagnostics and credentials were not printed.`,
  )
  process.exitCode = 1
} finally {
  await Promise.all([source?.$disconnect(), restored?.$disconnect()])
}
