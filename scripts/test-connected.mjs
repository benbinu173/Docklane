import { spawn } from 'node:child_process'
const child = spawn(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    'tests/connected.spec.ts',
    '--workers=1',
    '--reporter=list',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', windowsHide: true, env: { ...process.env, DOCKLANE_LOCAL_E2E: '1' } },
)
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
