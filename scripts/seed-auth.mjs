import { config } from 'dotenv'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

config({ path: ['.env.local', '.env'], quiet: true })
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEVELOPMENT_SEED !== 'true')
  throw new Error(
    'Auth seeding is available only in an explicitly enabled development environment.',
  )
const authUrl = process.env.NEON_AUTH_BASE_URL
if (!authUrl) throw new Error('Enable development Neon Auth and pull its environment first.')
const path = '.local/demo-accounts.json'
const saved = JSON.parse(await readFile(path, 'utf8').catch(() => 'null'))
if (saved?.authUrl === authUrl && saved.complete) {
  console.log('Existing development identities preserved in .local/demo-accounts.json.')
  process.exit(0)
}
const names = ['Aditi Menon', 'Riya Nair']
const candidates = [
  { name: 'Ben Thomas', email: 'admin@docklane.example.test', role: 'ADMIN' },
  { name: 'Priya Rao', email: 'operator@docklane.example.test', role: 'OPERATOR' },
  ...names.map((name) => ({
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}@docklane.example.test`,
    role: 'CUSTOMER',
  })),
]
await mkdir('.local', { recursive: true })
const accounts = saved?.authUrl === authUrl ? saved.accounts : []
for (const candidate of candidates) {
  if (accounts.some((account) => account.email === candidate.email)) continue
  const password = randomBytes(24).toString('base64url')
  let response
  for (let attempt = 0; attempt < 6; attempt++) {
    response = await fetch(`${authUrl}/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ name: candidate.name, email: candidate.email, password }),
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status !== 429) break
    await response.arrayBuffer()
    const seconds = Number(response.headers.get('retry-after')) || 60
    console.log(
      'Waiting for the development identity provider rate limit before continuing the saved checkpoint.',
    )
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(seconds, 10), 60) * 1000))
  }
  if (!response) throw new Error('No response from the identity provider.')
  const result = await response.json()
  if (!response.ok || !result.user?.id) {
    await writeFile(path, JSON.stringify({ authUrl, accounts, complete: false }, null, 2), {
      mode: 0o600,
    })
    throw new Error(
      `Development signup failed for ${candidate.role}: ${result.message ?? response.status}. Partial results are saved locally; no passwords were logged.`,
    )
  }
  accounts.push({ ...candidate, password, authSubject: result.user.id })
  await writeFile(
    path,
    JSON.stringify(
      {
        authUrl,
        accounts,
        complete: candidates.every((candidate) =>
          accounts.some((account) => account.email === candidate.email),
        ),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
}
await writeFile(path, JSON.stringify({ authUrl, accounts, complete: true }, null, 2), {
  mode: 0o600,
})
console.log(
  `${accounts.length} development identities created. Credentials are saved only in .local/demo-accounts.json.`,
)
