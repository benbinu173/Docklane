import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const prerender = fileURLToPath(new URL('./prerender-web.mjs', import.meta.url))
const env = { ...process.env, NODE_ENV: 'production' }
async function run(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: web,
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (code) process.exit(code)
}
// CI's test environment and local dotenv must not select React's development runtime.
await run(vite, ['build'])
await run(prerender)
