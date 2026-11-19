import { config } from 'dotenv'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'

config({ path: ['.env.local', '.env'], quiet: true })
const saved = JSON.parse(await readFile('.local/demo-accounts.json', 'utf8'))
if (
  process.env.ALLOW_DEVELOPMENT_SEED !== 'true' ||
  process.env.NODE_ENV === 'production' ||
  saved.authUrl !== process.env.NEON_AUTH_BASE_URL
)
  throw new Error(
    'Auth browser checks require matching, explicitly enabled development identities.',
  )
const args = process.argv.slice(2)
const child = spawn(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    args.includes('--all')
      ? 'tests'
      : args.includes('--phase3')
        ? 'tests/phase3.auth.spec.ts'
        : args.includes('--phase6')
          ? 'tests/phase6.auth.spec.ts'
          : args.includes('--phase5')
            ? 'tests/phase5.auth.spec.ts'
            : args.includes('--phase4')
              ? 'tests/phase4.auth.spec.ts'
              : 'tests/auth.spec.ts',
    '--workers=1',
    '--reporter=list',
    ...args.filter(
      (arg) => !['--all', '--phase3', '--phase4', '--phase5', '--phase6'].includes(arg),
    ),
  ],
  {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, DOCKLANE_AUTH_E2E: '1', PLAYWRIGHT_NO_COPY_PROMPT: '1' },
  },
)
function safeOutput(chunk) {
  let output = chunk.toString()
  for (const account of saved.accounts) output = output.replaceAll(account.password, '[redacted]')
  return output
    .replace(/fill\("[^"\r\n]*"\)/g, 'fill("[redacted]")')
    .replace(/token=[^&\s)"']+/g, 'token=[redacted]')
}
// Hold incomplete lines so credentials split across stream chunks are redacted.
function forward(stream, destination) {
  let pending = ''
  stream.on('data', (chunk) => {
    pending += chunk.toString()
    const end = pending.lastIndexOf('\n')
    if (end >= 0) {
      destination.write(safeOutput(pending.slice(0, end + 1)))
      pending = pending.slice(end + 1)
    }
  })
  stream.on('end', () => {
    if (pending) destination.write(safeOutput(pending))
  })
}
forward(child.stdout, process.stdout)
forward(child.stderr, process.stderr)
child.once('exit', async (code) => {
  const extra = await readFile('.local/auth-test-account.json', 'utf8').catch(() => null)
  if (extra) saved.accounts.push(JSON.parse(extra))
  const root = resolve('test-results')
  if (!root.startsWith(resolve('.') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')))
    throw new Error('Test diagnostic path guard failed.')
  async function scrub(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await scrub(path)
      else if (/\.(md|json|txt)$/.test(entry.name)) {
        const original = await readFile(path, 'utf8'),
          redacted = safeOutput(original)
        if (redacted !== original) await writeFile(path, redacted)
      }
    }
  }
  await scrub(root)
  process.exitCode = code ?? 1
})
child.once('error', () => {
  console.error('Could not start the browser checks.')
  process.exitCode = 1
})
