import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { config } from 'dotenv'
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK, errors } from 'jose'
import { createDatabase } from '@docklane/database'
import { DomainError } from '@docklane/domain'
import { createApp, type AppDependencies } from '../../apps/api/src/app.js'
import { loadConfig } from '../../apps/api/src/config.js'
import { createIdentityVerifier } from '../../apps/api/src/identity.js'
import { TestPaymentProvider } from './payment-provider.fixture.js'

config({ path: ['.env.local', '.env'], quiet: true })
const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  new URL(url).pathname !== '/docklane_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('Security checks require the isolated loopback docklane_test database.')
const db = createDatabase(url)
const businessId = `security-${randomUUID()}`
const headers = (subject = 'security-customer') => ({
  Authorization: `Bearer ${subject}`,
  'X-Docklane-Session': 'synthetic-session',
})
function app(options: Partial<AppDependencies> = {}) {
  return createApp({
    db,
    businessId,
    origins: ['https://docklane.example.test'],
    logLevel: 'silent',
    verifyIdentity: async (subject) => {
      if (subject === 'invalid') throw new DomainError('UNAUTHORIZED', 'Sign in again.', 401)
      if (subject === 'outage')
        throw new DomainError('IDENTITY_UNAVAILABLE', 'Try again shortly.', 503)
      return {
        subject: `${businessId}:${subject}`,
        name: 'Security fixture',
        email: `${subject}@example.test`,
      }
    },
    ...options,
  })
}
beforeAll(async () => {
  await db.business.create({ data: { id: businessId, name: 'Isolated security fixture' } })
})
afterAll(async () => {
  await db.$disconnect()
})

describe('request boundaries on the real API', () => {
  it('counts rejected authentication only, preserves concurrent valid requests, and recovers after Retry-After', async () => {
    const client = supertest(app({ limits: { authenticationFailures: 2, windowMs: 1500 } }))
    const valid = await Promise.all(
      Array.from({ length: 50 }, () => client.get('/api/v1/me').set(headers())),
    )
    expect([...new Set(valid.map((response) => response.status))]).toEqual([200])
    expect(
      await db.userProfile.count({ where: { authSubject: `${businessId}:security-customer` } }),
    ).toBe(1)
    for (let i = 0; i < 2; i++)
      expect((await client.get('/api/v1/me').set(headers('invalid'))).status).toBe(401)
    const blocked = await client.get('/api/v1/me').set(headers())
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    expect(blocked.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      requestId: blocked.headers['x-request-id'],
    })
    await new Promise((resolve) =>
      setTimeout(resolve, Number(blocked.headers['retry-after']) * 1000 + 50),
    )
    expect((await client.get('/api/v1/me').set(headers())).status).toBe(200)
  })
  it('does not spend the invalid-credential budget during identity outages', async () => {
    const client = supertest(app({ limits: { authenticationFailures: 1 } }))
    for (let i = 0; i < 3; i++)
      expect((await client.get('/api/v1/me').set(headers('outage'))).status).toBe(503)
    expect((await client.get('/api/v1/me').set(headers())).status).toBe(200)
  })
  it('ignores spoofed forwarded addresses unless proxy trust is explicitly configured', async () => {
    const client = supertest(app({ limits: { requests: 1 } }))
    expect(
      (await client.get('/api/v1/me').set(headers()).set('X-Forwarded-For', '198.51.100.1')).status,
    ).toBe(200)
    expect(
      (await client.get('/api/v1/me').set(headers()).set('X-Forwarded-For', '198.51.100.2')).status,
    ).toBe(429)
    expect((await client.get('/health/live')).status).toBe(200)
  })
  it('keeps mutation limits per account while reads and another account remain available', async () => {
    const client = supertest(app({ limits: { mutations: 1 } }))
    expect((await client.post('/api/v1/checkout/quote').set(headers()).send({})).status).toBe(400)
    expect((await client.post('/api/v1/checkout/quote').set(headers()).send({})).status).toBe(429)
    expect((await client.get('/api/v1/me').set(headers())).status).toBe(200)
    expect(
      (await client.post('/api/v1/checkout/quote').set(headers('another')).send({})).status,
    ).toBe(400)
  })
  it('applies a separate payment-session budget without blocking other mutations or customers', async () => {
    const client = supertest(app({ limits: { payments: 1 } }))
    const route = `/api/v1/orders/${randomUUID()}/payment-sessions`
    expect((await client.post(route).set(headers()).send({})).status).not.toBe(429)
    expect((await client.post(route).set(headers()).send({})).status).toBe(429)
    expect((await client.post(route).set(headers('another')).send({})).status).not.toBe(429)
    expect((await client.post('/api/v1/checkout/quote').set(headers()).send({})).status).toBe(400)
  })
  it('limits webhook ingress before verification and independently of ordinary API access', async () => {
    const verifyWebhook = vi.fn(() => {
      throw new DomainError('INVALID_SIGNATURE', 'Invalid signature.', 400)
    })
    const client = supertest(
      app({
        limits: { webhooks: 1 },
        payments: {
          provider: new TestPaymentProvider(),
          verifyWebhook,
          returnOrigin: 'https://docklane.example.test',
        },
      }),
    )
    expect(
      (await client.post('/api/v1/webhooks/stripe').set('Stripe-Signature', 'synthetic').send({}))
        .status,
    ).toBe(400)
    expect(
      (await client.post('/api/v1/webhooks/stripe').set('Stripe-Signature', 'synthetic').send({}))
        .status,
    ).toBe(429)
    expect(verifyWebhook).toHaveBeenCalledTimes(1)
    expect((await client.get('/api/v1/me').set(headers())).status).toBe(200)
  })
  it('rejects non-JSON, malformed, and oversized mutations with safe headers and error bodies', async () => {
    const client = supertest(app())
    const responses = [
      await client.post('/api/v1/orders').set(headers()).type('form').send({ quantity: 1 }),
      await client.post('/api/v1/orders').set(headers()).type('json').send('{"privateMarker":'),
      await client
        .post('/api/v1/orders')
        .set(headers())
        .send({ privateMarker: 'a'.repeat(40_000) }),
    ]
    expect(responses.map((response) => response.status)).toEqual([415, 400, 413])
    expect(responses.map((response) => response.body.error.code)).toEqual([
      'UNSUPPORTED_MEDIA_TYPE',
      'INVALID_JSON',
      'REQUEST_TOO_LARGE',
    ])
    for (const response of responses) {
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['x-powered-by']).toBeUndefined()
      expect(response.body.error.requestId).toBe(response.headers['x-request-id'])
      expect(JSON.stringify(response.body)).not.toMatch(/privateMarker|stack|Prisma/)
    }
  })
  it('enforces exact CORS origins, rejects null/lookalike origins, and allows preflight without a session', async () => {
    const client = supertest(app())
    const allowed = await client
      .options('/api/v1/orders')
      .set('Origin', 'https://docklane.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization,x-docklane-session')
    expect(allowed.status).toBe(204)
    expect(allowed.headers['access-control-allow-origin']).toBe('https://docklane.example.test')
    expect(allowed.headers['access-control-allow-headers']).toContain('X-Docklane-Session')
    for (const origin of [
      'null',
      'https://docklane.example.test.attacker.test',
      'http://docklane.example.test',
    ]) {
      const rejected = await client.get('/api/v1/me').set(headers()).set('Origin', origin)
      expect(rejected.status).toBe(403)
      expect(rejected.headers['access-control-allow-origin']).toBeUndefined()
    }
  })
})

const validConfig: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://fixture:synthetic@database.example.test/docklane?sslmode=verify-full',
  NEON_AUTH_BASE_URL: 'https://identity.example.test/auth',
  NEON_AUTH_JWKS_URL: 'https://identity.example.test/auth/.well-known/jwks.json',
  WEB_ORIGINS: 'https://docklane.example.test',
}
describe('configuration and identity failure handling', () => {
  it('accepts explicit production transports and bounds proxy trust', () => {
    expect(loadConfig(validConfig).TRUST_PROXY_HOPS).toBe(0)
    expect(loadConfig({ ...validConfig, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1)
    for (const hops of ['2', '-1', 'all'])
      expect(() => loadConfig({ ...validConfig, TRUST_PROXY_HOPS: hops })).toThrow(
        /TRUST_PROXY_HOPS/,
      )
  })
  it('rejects unsafe origins, identity endpoints, database transports, and incomplete payment configuration without echoing values', () => {
    const cases = [
      { WEB_ORIGINS: 'https://docklane.example.test/path' },
      { WEB_ORIGINS: '*' },
      { WEB_ORIGINS: 'http://127.0.0.1:5173' },
      { NEON_AUTH_BASE_URL: 'http://identity.example.test/auth' },
      { NEON_AUTH_JWKS_URL: 'https://attacker.test/keys' },
      { NEON_AUTH_BASE_URL: 'https://fixture:private-marker@identity.example.test/auth' },
      { DATABASE_URL: 'https://private-marker@database.example.test/docklane' },
      {
        DATABASE_URL:
          'postgresql://fixture:private-marker@database.example.test/docklane?sslmode=disable',
      },
      { CHECKOUT_RETURN_ORIGIN: 'https://docklane.example.test' },
      { STRIPE_SECRET_KEY: 'sk_live_invalid' },
    ]
    for (const values of cases) {
      expect(() => loadConfig({ ...validConfig, ...values })).toThrow()
      try {
        loadConfig({ ...validConfig, ...values })
      } catch (error) {
        expect(String(error)).not.toMatch(/private-marker|sk_live_invalid/)
      }
    }
    expect(() =>
      loadConfig({
        ...validConfig,
        NODE_ENV: 'test',
        DATABASE_URL: url,
        WEB_ORIGINS: 'http://127.0.0.1:5173',
        NEON_AUTH_BASE_URL: 'http://localhost:8080/auth',
        NEON_AUTH_JWKS_URL: 'http://localhost:8080/keys',
      }),
    ).not.toThrow()
  })
  it('rejects remote and wrong-database test migrations before launching Prisma', () => {
    for (const testUrl of [
      'postgresql://fixture:private-marker@database.example.test/docklane_test',
      'postgresql://fixture:private-marker@127.0.0.1/docklane',
      'https://127.0.0.1/docklane_test',
      'invalid-private-marker',
    ]) {
      const result = spawnSync(process.execPath, ['scripts/database.mjs', 'test-migrate'], {
        env: { ...process.env, TEST_DATABASE_URL: testUrl },
        encoding: 'utf8',
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('dedicated loopback docklane_test')
      expect(result.stderr + result.stdout).not.toMatch(/private-marker|Prisma schema|Datasource/)
    }
  })
  it('distinguishes rejected JWTs from key-service and session-service outages', async () => {
    const keys = await generateKeyPair('EdDSA')
    const issuer = 'https://identity.example.test'
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA', kid: 'security-key' })
      .setSubject('security-subject')
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(keys.privateKey)
    const store = {
      verify: vi.fn(async () => ({
        id: 'synthetic',
        name: 'Fixture',
        email: 'fixture@example.test',
      })),
      close: async () => {},
    }
    const local = createLocalJWKSet({
      keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'security-key', alg: 'EdDSA' }],
    })
    expect(await createIdentityVerifier(store, issuer, local)(jwt, 'synthetic')).toMatchObject({
      subject: 'security-subject',
    })
    await expect(
      createIdentityVerifier(store, issuer, local)('malformed', 'synthetic'),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
    for (const error of [
      new Error('private-key-service-detail'),
      new errors.JWKSTimeout(),
      new errors.JWKSInvalid(),
    ]) {
      await expect(
        createIdentityVerifier(store, issuer, async () => {
          throw error
        })(jwt, 'synthetic'),
      ).rejects.toMatchObject({ status: 503, code: 'IDENTITY_UNAVAILABLE' })
    }
    store.verify.mockRejectedValueOnce(new Error('private-database-detail'))
    await expect(
      createIdentityVerifier(store, issuer, local)(jwt, 'synthetic'),
    ).rejects.toMatchObject({ status: 503, code: 'IDENTITY_UNAVAILABLE' })
  })
})
