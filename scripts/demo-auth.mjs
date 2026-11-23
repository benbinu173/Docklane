import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { validateDeployment } from './deployment-config.mjs'

async function seed() {
  validateDeployment(process.env, 'bootstrap')
  const file = process.env.DEMO_ACCOUNTS_FILE
  const boundary = resolve('.local/release')
  if (!file) throw new Error('Configure the private demo account file.')
  const path = resolve(file),
    within = relative(boundary, path)
  if (!within || within.startsWith('..') || isAbsolute(within))
    throw new Error('Demo accounts must stay inside .local/release/.')
  const authUrl = process.env.NEON_AUTH_BASE_URL
  const origin = process.env.DEMO_AUTH_SEED_ORIGIN || 'http://127.0.0.1:4173'
  const originUrl = new URL(origin)
  if (
    originUrl.origin !== origin ||
    (originUrl.protocol !== 'https:' &&
      !(originUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(originUrl.hostname)))
  )
    throw new Error('Use a registered HTTPS or loopback origin for demo identity preparation.')
  const saved = JSON.parse(
    await readFile(path, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return 'null'
      throw error
    }),
  )
  if (saved && saved.authUrl !== authUrl)
    throw new Error('The private account file belongs to a different demo branch.')
  const accounts = saved?.accounts || []
  const candidates = [
    { name: 'Docklane Demo Admin', email: 'demo.admin@docklane.example.test', role: 'ADMIN' },
    {
      name: 'Docklane Demo Operator',
      email: 'demo.operator@docklane.example.test',
      role: 'OPERATOR',
    },
    {
      name: 'Docklane Demo Customer',
      email: 'demo.customer@docklane.example.test',
      role: 'CUSTOMER',
    },
  ]
  await mkdir(resolve(path, '..'), { recursive: true })
  async function checkpoint() {
    await writeFile(
      path,
      JSON.stringify(
        {
          authUrl,
          accounts,
          complete: candidates.every((candidate) =>
            accounts.some((account) => account.email === candidate.email && account.authSubject),
          ),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    )
  }
  async function request(endpoint, body, cookie) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${authUrl}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
      if (response.status !== 429 || attempt === 3) return response
      await response.arrayBuffer()
      const delay = Math.min(60, Math.max(10, Number(response.headers.get('retry-after')) || 30))
      console.log('Waiting for the demo Auth rate limit; the private checkpoint is preserved.')
      await new Promise((resolve) => setTimeout(resolve, delay * 1000))
    }
  }
  async function closeSession(response) {
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    if (cookie) {
      const closed = await request('sign-out', {}, cookie)
      if (!closed.ok) throw new Error('Demo Auth session closure failed.')
      await closed.arrayBuffer()
    }
  }
  for (const candidate of candidates) {
    let account = accounts.find((entry) => entry.email === candidate.email)
    if (account?.authSubject) continue
    if (!account) {
      account = { ...candidate, password: randomBytes(24).toString('base64url'), authSubject: null }
      accounts.push(account)
      await checkpoint()
    }
    // Persist the password before the request, so a lost signup response can be recovered.
    let response = await request('sign-up/email', {
      name: account.name,
      email: account.email,
      password: account.password,
    }).catch(() => null)
    let data = response
      ? await response
          .clone()
          .json()
          .catch(() => null)
      : null
    if (!response?.ok || !data?.user?.id) {
      response = await request('sign-in/email', {
        email: account.email,
        password: account.password,
      })
      data = await response
        .clone()
        .json()
        .catch(() => null)
    }
    if (!response?.ok || !data?.user?.id) throw new Error('Demo identity creation/recovery failed.')
    account.authSubject = data.user.id
    await checkpoint()
    await closeSession(response)
  }
  for (const account of accounts) {
    const response = await request('sign-in/email', {
      email: account.email,
      password: account.password,
    })
    const data = await response
      .clone()
      .json()
      .catch(() => null)
    if (!response.ok || data?.user?.id !== account.authSubject)
      throw new Error('Demo identity sign-in verification failed.')
    await closeSession(response)
  }
  await checkpoint()
  console.log(
    `${accounts.length} fresh demo identities verified. Passwords remain only in the private account file.`,
  )
}
seed().catch(() => {
  console.error(
    'Demo Auth preparation failed safely. Check demo target, registered origin and private checkpoint; provider responses and credentials were not printed.',
  )
  process.exitCode = 1
})
