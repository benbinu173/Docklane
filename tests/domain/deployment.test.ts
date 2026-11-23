import { describe, it, expect } from 'vitest'
import { validateDeployment } from '../../scripts/deployment-config.mjs'

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ALLOW_DEVELOPMENT_SEED: 'false',
    BUSINESS_ID: 'northstar-supply',
    DEMO_DATABASE_HOST: 'ep-release.ap-southeast-1.aws.neon.tech',
    DATABASE_URL:
      'postgresql://demo:private@ep-release-pooler.ap-southeast-1.aws.neon.tech/docklane?sslmode=require',
    DATABASE_URL_UNPOOLED:
      'postgresql://demo:private@ep-release.ap-southeast-1.aws.neon.tech/docklane?sslmode=require',
    NEON_AUTH_BASE_URL: 'https://ep-release.neonauth.ap-southeast-1.aws.neon.tech/docklane/auth',
    NEON_AUTH_JWKS_URL:
      'https://ep-release.neonauth.ap-southeast-1.aws.neon.tech/docklane/auth/.well-known/jwks.json',
    WEB_ORIGINS: 'https://docklane.example.test',
    CHECKOUT_RETURN_ORIGIN: 'https://docklane.example.test',
    STRIPE_SECRET_KEY: 'sk_test_private',
    STRIPE_WEBHOOK_SECRET: 'whsec_private',
    API_HOST: '0.0.0.0',
    TRUST_PROXY_HOPS: '1',
    REDIS_URL: 'redis://internal-queue:6379',
    ALLOW_DEMO_BOOTSTRAP: 'true',
  }
}
describe('release environment boundaries', () => {
  it('accepts coherent demo API/worker/bootstrap environments', () => {
    for (const target of ['api', 'worker', 'bootstrap'])
      expect(() => validateDeployment(environment(), target)).not.toThrow()
  })
  it('refuses the original development branch even when marked as a demo', () => {
    for (const hostname of [
      'ep-cool-waterfall-aolznx0k.ap-southeast-1.aws.neon.tech',
      'ep-cool-waterfall-aolznx0k.c-2.ap-southeast-1.aws.neon.tech',
    ]) {
      const env = environment()
      env.DEMO_DATABASE_HOST = hostname
      env.DATABASE_URL = `postgresql://demo:private@${hostname}/docklane?sslmode=require`
      env.DATABASE_URL_UNPOOLED = env.DATABASE_URL
      expect(() => validateDeployment(env, 'bootstrap')).toThrow(/isolated demo/)
    }
  })
  it('prepares demo data before hosting origins and payment keys exist', () => {
    const env = environment()
    for (const key of [
      'WEB_ORIGINS',
      'CHECKOUT_RETURN_ORIGIN',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ])
      delete env[key]
    expect(() => validateDeployment(env, 'bootstrap')).not.toThrow()
    expect(() => validateDeployment(env, 'api')).toThrow()
  })
  it('refuses pooled migration connections and mixed branch credentials', () => {
    const env = environment()
    env.DATABASE_URL_UNPOOLED = env.DATABASE_URL
    expect(() => validateDeployment(env, 'api')).toThrow(/Pooled\/direct/)
    env.DATABASE_URL_UNPOOLED = environment().DATABASE_URL_UNPOOLED!.replace(
      'ep-release.',
      'ep-other.',
    )
    expect(() => validateDeployment(env, 'api')).toThrow(/isolated demo/)
  })
  it('rejects Auth from another branch and development origins', () => {
    const env = environment()
    env.NEON_AUTH_BASE_URL = env.NEON_AUTH_BASE_URL!.replace('ep-release.', 'ep-other.')
    expect(() => validateDeployment(env, 'api')).toThrow(/same isolated/)
    env.NEON_AUTH_BASE_URL = environment().NEON_AUTH_BASE_URL
    env.WEB_ORIGINS = 'http://127.0.0.1:5173'
    expect(() => validateDeployment(env, 'api')).toThrow(/HTTPS/)
  })
  it('refuses live Stripe keys, disabled bootstrap and implicit development mode', () => {
    const env = environment()
    env.STRIPE_SECRET_KEY = 'sk_live_private'
    expect(() => validateDeployment(env, 'api')).toThrow(/Stripe test/)
    env.ALLOW_DEMO_BOOTSTRAP = 'false'
    expect(() => validateDeployment(env, 'bootstrap')).toThrow(/ALLOW_DEMO_BOOTSTRAP/)
    delete env.NODE_ENV
    expect(() => validateDeployment(env, 'worker')).toThrow(/production mode/)
  })
  it('rejects misdirected checkout and keeps credential values out of errors', () => {
    const env = environment()
    env.CHECKOUT_RETURN_ORIGIN = 'https://wrong.example.test'
    expect(() => validateDeployment(env, 'api')).toThrow(/allowed by CORS/)
    env.DATABASE_URL = 'postgresql://demo:private@unknown.example/docklane'
    try {
      validateDeployment(env, 'api')
    } catch (error) {
      expect(String(error)).not.toContain('private')
      expect(String(error)).not.toContain('unknown.example')
    }
  })
})
