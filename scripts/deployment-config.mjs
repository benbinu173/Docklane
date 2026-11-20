// Pure validation shared by deployment commands and safety tests. Values are never logged.
const developmentHost = 'ep-cool-waterfall-aolznx0k.ap-southeast-1.aws.neon.tech'
export function urlValue(env, key) {
  try {
    const value = env[key]
    if (!value || value.includes('REPLACE_WITH')) throw new Error()
    return new URL(value)
  } catch {
    throw new Error(`Configure ${key}; values are not logged.`)
  }
}
export function directHost(host) {
  return host.replace(/-pooler(?=\.)/, '')
}
export function httpsUrl(env, key, originOnly = false) {
  const url = urlValue(env, key)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (originOnly && url.origin !== env[key])
  )
    throw new Error(`${key} must be an exact HTTPS ${originOnly ? 'origin' : 'URL'}.`)
  return url
}
export function assertDemoTarget(env, requireDirect = false) {
  if (env.NODE_ENV !== 'production' || env.ALLOW_DEVELOPMENT_SEED !== 'false')
    throw new Error('Demo operations require production mode and ALLOW_DEVELOPMENT_SEED=false.')
  const target = env.DEMO_DATABASE_HOST
  if (!target || target.includes('REPLACE_WITH') || target !== directHost(target))
    throw new Error('Configure DEMO_DATABASE_HOST with the reviewed direct demo host.')
  const pooled = urlValue(env, 'DATABASE_URL')
  const direct = requireDirect ? urlValue(env, 'DATABASE_URL_UNPOOLED') : pooled
  for (const url of [pooled, direct]) {
    const host = directHost(url.hostname)
    const rehearsal =
      env.DEMO_LOCAL_REHEARSAL === 'true' &&
      url.hostname === '127.0.0.1' &&
      url.pathname === '/docklane_demo_rehearsal'
    if (
      host === developmentHost ||
      host !== target ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      (!rehearsal &&
        (!host.endsWith('.neon.tech') ||
          url.pathname !== '/docklane' ||
          !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))))
    )
      throw new Error('Database target is not the reviewed isolated demo environment.')
  }
  if (
    requireDirect &&
    (direct.hostname.includes('-pooler') ||
      direct.pathname !== pooled.pathname ||
      direct.username !== pooled.username ||
      direct.password !== pooled.password ||
      direct.port !== pooled.port)
  )
    throw new Error('Pooled/direct credentials must address the same demo database and role.')
  if (env.NEON_AUTH_DATABASE_URL)
    throw new Error('The release demo must use its own database for Auth sessions.')
  return { pooled, direct }
}
export function validateDeployment(env, target) {
  if (!['web', 'api', 'worker', 'bootstrap'].includes(target))
    throw new Error('Choose web, api, worker, or bootstrap.')
  if (target === 'web') {
    httpsUrl(env, 'VITE_API_URL', true)
    httpsUrl(env, 'VITE_NEON_AUTH_URL')
    return
  }
  const { pooled } = assertDemoTarget(env, target !== 'worker')
  if (!env.BUSINESS_ID) throw new Error('Configure BUSINESS_ID.')
  if (target === 'api' || target === 'bootstrap') {
    const auth = httpsUrl(env, 'NEON_AUTH_BASE_URL')
    const jwks = httpsUrl(env, 'NEON_AUTH_JWKS_URL')
    if (
      auth.origin !== jwks.origin ||
      directHost(auth.hostname.replace('.neonauth.', '.')) !== directHost(pooled.hostname)
    )
      throw new Error('Auth/JWKS must belong to the same isolated demo compute.')
    const origins = (env.WEB_ORIGINS ?? '').split(',').map((origin) => origin.trim())
    if (!origins.length || origins.length > 16) throw new Error('Configure WEB_ORIGINS.')
    for (const origin of origins) httpsUrl({ origin }, 'origin', true)
    const checkout = httpsUrl(env, 'CHECKOUT_RETURN_ORIGIN', true)
    if (!origins.includes(checkout.origin))
      throw new Error('Checkout origin must be allowed by CORS.')
    if (target === 'api' && (env.API_HOST !== '0.0.0.0' || env.TRUST_PROXY_HOPS !== '1'))
      throw new Error('Render requires API_HOST=0.0.0.0 and TRUST_PROXY_HOPS=1.')
  }
  if (target !== 'bootstrap') {
    if (
      !env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ||
      !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')
    )
      throw new Error('Configure complete Stripe test credentials.')
  } else if (env.ALLOW_DEMO_BOOTSTRAP !== 'true')
    throw new Error('Enable ALLOW_DEMO_BOOTSTRAP only for a reviewed empty demo database.')
  if (target === 'worker') {
    const redis = urlValue(env, 'REDIS_URL')
    if (!['redis:', 'rediss:'].includes(redis.protocol))
      throw new Error('Configure a Redis queue URL.')
  }
}
