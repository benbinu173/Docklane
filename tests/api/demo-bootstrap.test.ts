import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest'
import { config } from 'dotenv'
import { createDatabase } from '@docklane/database'
import { bootstrapDemo } from '../../scripts/demo-bootstrap-lib.js'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Demo bootstrap tests require the isolated loopback docklane_test database.')
const db = createDatabase(url)
const identities = [
  { authSubject: 'bootstrap-admin', email: 'admin@demo.example.test', role: 'ADMIN' },
  { authSubject: 'bootstrap-operator', email: 'operator@demo.example.test', role: 'OPERATOR' },
  { authSubject: 'bootstrap-customer', email: 'customer@demo.example.test', role: 'CUSTOMER' },
]
beforeAll(async () => {
  await db.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS neon_auth')
  await db.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL)',
  )
  for (const identity of identities)
    await db.$executeRaw`INSERT INTO neon_auth."user" (id, name, email) VALUES (${identity.authSubject}, ${identity.role}, ${identity.email}) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`
})
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE public.businesses CASCADE')
  await db.outboxEvent.deleteMany()
  await db.webhookReceipt.deleteMany()
})
afterAll(() => db.$disconnect())
it('bootstraps reconciled stock and real identities without synthetic orders or payments', async () => {
  const result = await bootstrapDemo(db, identities, 'northstar-supply')
  expect(result.balances).toBe(24)
  expect(result.profiles).toBe(3)
  expect(await db.order.count()).toBe(0)
  expect(await db.payment.count()).toBe(0)
  const balances = await db.inventoryBalance.findMany({ include: { movements: true } })
  for (const balance of balances) {
    expect(balance.reserved).toBe(0)
    expect(balance.version).toBe(1)
    expect(balance.movements).toHaveLength(1)
    expect(balance.movements[0]).toMatchObject({
      type: 'OPENING',
      deltaOnHand: balance.onHand,
      onHandAfter: balance.onHand,
      deltaReserved: 0,
      reservedAfter: 0,
      balanceVersion: 1,
    })
  }
})
it('refuses repeated bootstrap and preserves an existing balance and its audit history', async () => {
  await bootstrapDemo(db, identities, 'northstar-supply')
  const before = await db.inventoryBalance.findMany({ orderBy: { id: 'asc' } })
  await expect(bootstrapDemo(db, identities, 'northstar-supply')).rejects.toThrow(
    /empty application/,
  )
  expect(await db.inventoryBalance.findMany({ orderBy: { id: 'asc' } })).toEqual(before)
  expect(await db.auditEvent.count()).toBe(1)
})
it('rolls back entirely for an unknown Auth subject', async () => {
  const changed = identities.map((identity) => ({ ...identity }))
  changed[2].authSubject = 'not-a-demo-user'
  await expect(bootstrapDemo(db, changed, 'northstar-supply')).rejects.toThrow(/does not match/)
  expect(await db.business.count()).toBe(0)
  expect(await db.inventoryBalance.count()).toBe(0)
})
it('refuses a privileged subject paired with another email', async () => {
  const changed = identities.map((identity) => ({ ...identity }))
  changed[0].email = 'someone.else@demo.example.test'
  await expect(bootstrapDemo(db, changed, 'northstar-supply')).rejects.toThrow(/does not match/)
  expect(await db.userProfile.count()).toBe(0)
})

it('serializes competing bootstraps so only one creates opening stock and roles', async () => {
  const outcomes = await Promise.allSettled([
    bootstrapDemo(db, identities, 'northstar-supply'),
    bootstrapDemo(db, identities, 'northstar-supply'),
  ])
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
  expect(await db.inventoryBalance.count()).toBe(24)
  expect(await db.inventoryMovement.count()).toBe(24)
  expect(await db.userProfile.count()).toBe(3)
  expect(await db.auditEvent.count()).toBe(1)
})
