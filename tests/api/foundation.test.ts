import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { randomUUID, randomBytes } from 'node:crypto'
import { config } from 'dotenv'
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose'
import { createDatabase, createAuthSessionStore } from '@docklane/database'
import { seedDevelopment, type SeedIdentity } from '../../scripts/seed-lib.js'
import { createApp } from '../../apps/api/src/app.js'
import { createIdentityVerifier } from '../../apps/api/src/identity.js'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  !new URL(url).pathname.endsWith('/docklane_test') ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Integration tests require the isolated local docklane_test database.')
const db = createDatabase(url)
const store = createAuthSessionStore(url)
const issuer = 'https://identity.docklane.test'
const identities: SeedIdentity[] = [
  {
    authSubject: 'test-admin',
    name: 'Ben Thomas',
    email: 'admin@docklane.example.test',
    role: 'ADMIN',
  },
  {
    authSubject: 'test-operator',
    name: 'Priya Rao',
    email: 'operator@docklane.example.test',
    role: 'OPERATOR',
  },
  {
    authSubject: 'test-aditi',
    name: 'Aditi Menon',
    email: 'aditi.menon@docklane.example.test',
    role: 'CUSTOMER',
  },
  {
    authSubject: 'test-riya',
    name: 'Riya Nair',
    email: 'riya.nair@docklane.example.test',
    role: 'CUSTOMER',
  },
]
const keys = await generateKeyPair('EdDSA')
const publicJwk = {
  ...(await exportJWK(keys.publicKey)),
  kid: 'foundation-test',
  alg: 'EdDSA',
  use: 'sig',
}
const verifyIdentity = createIdentityVerifier(
  store,
  issuer,
  createLocalJWKSet({ keys: [publicJwk] }),
)
const app = createApp({
  db,
  verifyIdentity,
  businessId: 'northstar-supply',
  origins: ['http://localhost:5173'],
  logLevel: 'silent',
})
type Headers = { Authorization: string; 'X-Docklane-Session': string }
let admin: Headers, operator: Headers, aditi: Headers, riya: Headers
async function session(subject: string, tokenIssuer = issuer, expires = '15m'): Promise<Headers> {
  const token = randomBytes(24).toString('hex')
  await db.$executeRaw`INSERT INTO neon_auth.session (id, token, "userId", "expiresAt") VALUES (${randomUUID()}, ${token}, ${subject}, CURRENT_TIMESTAMP + INTERVAL '1 hour')`
  const jwt = await new SignJWT({ role: 'ADMIN' })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'foundation-test' })
    .setSubject(subject)
    .setIssuer(tokenIssuer)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(keys.privateKey)
  return { Authorization: `Bearer ${jwt}`, 'X-Docklane-Session': token }
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE public.businesses CASCADE')
  await db.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS neon_auth')
  await db.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL)',
  )
  await db.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS neon_auth.session (id text PRIMARY KEY, token text UNIQUE NOT NULL, "userId" text REFERENCES neon_auth."user"(id), "expiresAt" timestamptz NOT NULL)',
  )
  await db.$executeRawUnsafe('TRUNCATE TABLE neon_auth.session, neon_auth."user" CASCADE')
  for (const identity of identities)
    await db.$executeRaw`INSERT INTO neon_auth."user" (id, name, email) VALUES (${identity.authSubject}, ${identity.name}, ${identity.email})`
  await seedDevelopment(db, identities)
})
beforeEach(async () => {
  ;[admin, operator, aditi, riya] = await Promise.all(
    identities.map((identity) => session(identity.authSubject)),
  )
})
afterEach(async () => {
  for (const identity of identities)
    await db.userProfile.update({
      where: { authSubject: identity.authSubject },
      data: { role: identity.role, active: true },
    })
})
afterAll(async () => {
  await Promise.all([db.$disconnect(), store.close()])
})

describe('identity and authorization on real PostgreSQL', () => {
  it('recovers after an idle authentication connection is terminated without losing API access', async () => {
    const applicationName = `docklane-recovery-${randomUUID()}`
    const idleErrors: Error[] = []
    const recovering = createAuthSessionStore(url, {
      applicationName,
      onIdleError: (error) => idleErrors.push(error),
    })
    try {
      expect(await recovering.verify(admin['X-Docklane-Session'], 'test-admin')).toMatchObject({
        name: 'Ben Thomas',
      })
      const clients = await db.$queryRaw<
        { pid: number }[]
      >`SELECT pid FROM pg_stat_activity WHERE datname = 'docklane_test' AND application_name = ${applicationName} AND state = 'idle'`
      expect(clients).toHaveLength(1)
      // This test file rejects every non-loopback/non-test database above.
      const result = await db.$queryRaw<
        { terminated: boolean }[]
      >`SELECT pg_terminate_backend(${clients[0].pid}) AS terminated`
      expect(result[0].terminated).toBe(true)
      await expect.poll(() => idleErrors.length, { timeout: 5_000 }).toBe(1)
      const recoveredApi = createApp({
        db,
        verifyIdentity: createIdentityVerifier(
          recovering,
          issuer,
          createLocalJWKSet({ keys: [publicJwk] }),
        ),
        businessId: 'northstar-supply',
        origins: ['http://localhost:5173'],
        logLevel: 'silent',
      })
      const response = await supertest(recoveredApi).get('/api/v1/me').set(admin)
      expect(response.status).toBe(200)
      expect(response.body.data.role).toBe('ADMIN')
      const replacement = await db.$queryRaw<
        { pid: number }[]
      >`SELECT pid FROM pg_stat_activity WHERE datname = 'docklane_test' AND application_name = ${applicationName} AND state = 'idle'`
      expect(replacement).toHaveLength(1)
      expect(replacement[0].pid).not.toBe(clients[0].pid)
    } finally {
      await recovering.close()
    }
  })
  it('offers health checks but rejects missing and malformed credentials on protected routes', async () => {
    expect((await supertest(app).get('/health/ready')).status).toBe(200)
    for (const headers of [
      {},
      { Authorization: 'Bearer malformed', 'X-Docklane-Session': 'unknown' },
    ]) {
      const response = await supertest(app).get('/api/v1/me').set(headers)
      expect(response.status).toBe(401)
      expect(response.body.error).toMatchObject({
        code: 'UNAUTHORIZED',
        requestId: expect.any(String),
      })
      expect(response.headers['x-request-id']).toBe(response.body.error.requestId)
    }
  })
  it('rejects expired tokens and tokens issued for a different identity service', async () => {
    for (const headers of [
      await session('test-aditi', issuer, '-1m'),
      await session('test-aditi', 'https://other-identity.test'),
    ])
      expect((await supertest(app).get('/api/v1/me').set(headers)).status).toBe(401)
  })
  it('requires the session token to belong to the signed JWT subject', async () => {
    expect(
      (
        await supertest(app)
          .get('/api/v1/me')
          .set({ ...aditi, 'X-Docklane-Session': riya['X-Docklane-Session'] })
      ).status,
    ).toBe(401)
  })
  it('rejects revoked and expired provider sessions even while the JWT is valid', async () => {
    await db.$executeRaw`DELETE FROM neon_auth.session WHERE token = ${aditi['X-Docklane-Session']}`
    expect((await supertest(app).get('/api/v1/me').set(aditi)).status).toBe(401)
    await db.$executeRaw`UPDATE neon_auth.session SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE token = ${riya['X-Docklane-Session']}`
    expect((await supertest(app).get('/api/v1/me').set(riya)).status).toBe(401)
  })
  it('loads application roles from the database and ignores the JWT role claim', async () => {
    const response = await supertest(app).get('/api/v1/me').set(aditi)
    expect(response.body.data.role).toBe('CUSTOMER')
    expect((await supertest(app).get('/api/v1/workspace').set(aditi)).status).toBe(403)
    expect((await supertest(app).get('/api/v1/workspace').set(operator)).status).toBe(200)
  })
  it('grants newly registered identities Customer only', async () => {
    const subject = `new-customer-${randomUUID()}`
    await db.$executeRaw`INSERT INTO neon_auth."user" (id, name, email) VALUES (${subject}, 'New Customer', 'new@docklane.example.test')`
    const headers = await session(subject)
    const response = await supertest(app).get('/api/v1/me').set(headers)
    expect(response.status).toBe(200)
    expect(response.body.data.role).toBe('CUSTOMER')
    expect((await supertest(app).get('/api/v1/orders').set(headers)).body.data).toEqual([])
  })
  it('rejects disabled accounts despite a valid identity and session', async () => {
    await db.userProfile.update({ where: { authSubject: 'test-aditi' }, data: { active: false } })
    const response = await supertest(app).get('/api/v1/me').set(aditi)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('ACCOUNT_DISABLED')
  })
  it('scopes customer list and detail access and hides another customer’s address', async () => {
    const own = await supertest(app).get('/api/v1/orders').set(aditi)
    expect(own.body.pagination.total).toBe(1)
    expect(own.body.data[0].number).toBe('DL-2048')
    expect((await supertest(app).get('/api/v1/orders/DL-2048').set(aditi)).status).toBe(200)
    const other = await supertest(app).get('/api/v1/orders/DL-2038').set(aditi)
    expect(other.status).toBe(404)
    expect(other.body).not.toHaveProperty('data')
    expect((await supertest(app).get('/api/v1/orders/DL-2038').set(riya)).status).toBe(200)
    expect((await supertest(app).get('/api/v1/orders').set(operator)).body.pagination.total).toBe(
      16,
    )
  })
  it('denies Operators team changes and refunds and reports unavailable payment configuration', async () => {
    const target = await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'test-aditi' } })
    expect((await supertest(app).get('/api/v1/team').set(operator)).status).toBe(403)
    expect(
      (
        await supertest(app)
          .patch(`/api/v1/team/${target.id}`)
          .set(operator)
          .send({ role: 'ADMIN' })
      ).status,
    ).toBe(403)
    expect(
      (
        await supertest(app)
          .post('/api/v1/orders/DL-2048/refunds')
          .set(operator)
          .send({ amountPaise: 100, reason: 'Test refund', idempotencyKey: randomUUID() })
      ).status,
    ).toBe(403)
    expect(
      (
        await supertest(app)
          .post('/api/v1/orders/DL-2048/refunds')
          .set(admin)
          .send({ amountPaise: 100, reason: 'Test refund', idempotencyKey: randomUUID() })
      ).body.error.code,
    ).toBe('PAYMENTS_NOT_CONFIGURED')
  })
  it('commits Admin role changes with their audit event and immediately enforces the new role', async () => {
    const target = await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'test-aditi' } })
    const response = await supertest(app)
      .patch(`/api/v1/team/${target.id}`)
      .set(admin)
      .send({ role: 'OPERATOR' })
    expect(response.status).toBe(200)
    expect((await supertest(app).get('/api/v1/workspace').set(aditi)).status).toBe(200)
    const audit = await db.auditEvent.findFirst({
      where: { entityId: target.id, requestId: response.headers['x-request-id'] },
    })
    expect(audit?.metadata).toEqual({ from: 'CUSTOMER', to: 'OPERATOR' })
    await supertest(app).patch(`/api/v1/team/${target.id}`).set(admin).send({ role: 'CUSTOMER' })
    expect((await supertest(app).get('/api/v1/workspace').set(aditi)).status).toBe(403)
  })
  it('rejects self-demotion, unknown mutation fields, and oversized pagination', async () => {
    const actor = await db.userProfile.findUniqueOrThrow({ where: { authSubject: 'test-admin' } })
    expect(
      (await supertest(app).patch(`/api/v1/team/${actor.id}`).set(admin).send({ role: 'CUSTOMER' }))
        .body.error.code,
    ).toBe('SELF_ROLE_CHANGE')
    const bad = await supertest(app)
      .patch(`/api/v1/team/${actor.id}`)
      .set(admin)
      .send({ role: 'ADMIN', active: true })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('VALIDATION_ERROR')
    expect((await supertest(app).get('/api/v1/orders?pageSize=1000').set(admin)).status).toBe(400)
  })
  it('rejects untrusted origins and returns safe malformed-JSON errors', async () => {
    expect(
      (await supertest(app).get('/api/v1/me').set(admin).set('Origin', 'https://untrusted.test'))
        .status,
    ).toBe(403)
    const response = await supertest(app)
      .patch('/api/v1/team/invalid')
      .set(admin)
      .set('Content-Type', 'application/json')
      .send('{invalid')
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_JSON')
    expect(JSON.stringify(response.body)).not.toContain('SyntaxError')
  })
})

describe('schema and repeatable seed', () => {
  it('keeps reserved quantities within stock even when validation is bypassed', async () => {
    await expect(
      db.$executeRaw`UPDATE inventory_balances SET reserved = "onHand" + 1 WHERE id = 'AUD-001@kochi'`,
    ).rejects.toThrow()
    const balance = await db.inventoryBalance.findUniqueOrThrow({ where: { id: 'AUD-001@kochi' } })
    expect(balance.onHand).toBe(86)
    expect(balance.reserved).toBe(1)
  })
  it('seeds twice without duplicating orders, movements, or reservations and reconciles the ledger', async () => {
    const counts = await Promise.all([
      db.order.count(),
      db.inventoryMovement.count(),
      db.stockReservation.count(),
    ])
    const result = await seedDevelopment(db, identities)
    expect(result.createdOrders).toBe(0)
    expect(result.createdBalances).toBe(0)
    expect(
      await Promise.all([
        db.order.count(),
        db.inventoryMovement.count(),
        db.stockReservation.count(),
      ]),
    ).toEqual(counts)
    const mismatches = await db.$queryRaw<
      { id: string }[]
    >`SELECT b.id FROM inventory_balances b LEFT JOIN inventory_movements m ON m."balanceId" = b.id GROUP BY b.id HAVING b."onHand" <> COALESCE(SUM(m."deltaOnHand"), 0) OR b.reserved <> COALESCE(SUM(m."deltaReserved"), 0)`
    expect(mismatches).toEqual([])
  })
  it('enforces unique warehouse/SKU balances and provider webhook IDs', async () => {
    const balance = await db.inventoryBalance.findUniqueOrThrow({ where: { id: 'AUD-001@kochi' } })
    await expect(
      db.inventoryBalance.create({
        data: {
          id: randomUUID(),
          sku: balance.sku,
          warehouseId: balance.warehouseId,
          onHand: 1,
          reserved: 0,
        },
      }),
    ).rejects.toThrow()
    const eventId = randomUUID()
    await db.webhookReceipt.create({
      data: { provider: 'test', eventId, eventType: 'test.created', payload: {} },
    })
    await expect(
      db.webhookReceipt.create({
        data: { provider: 'test', eventId, eventType: 'test.created', payload: {} },
      }),
    ).rejects.toThrow()
  })
})
