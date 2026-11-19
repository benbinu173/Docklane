import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createDatabase } from '@docklane/database'

// Cloud credentials and reset tokens never enter a trace or failure screenshot.
test.use({ trace: 'off', screenshot: 'off', reducedMotion: 'reduce' })
test.describe.configure({ timeout: 120_000 })
type Account = { name: string; email: string; password: string; role: string }
let accounts: Account[]
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:4000'
test.beforeAll(async () => {
  const saved = JSON.parse(await readFile('.local/demo-accounts.json', 'utf8'))
  if (
    process.env.DOCKLANE_AUTH_E2E !== '1' ||
    process.env.ALLOW_DEVELOPMENT_SEED !== 'true' ||
    saved.authUrl !== process.env.NEON_AUTH_BASE_URL
  )
    throw new Error('Run npm run test:auth against the configured development branch.')
  accounts = saved.accounts
})
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
})
async function login(page: Page, role: string) {
  const account = accounts.find((candidate) => candidate.role === role)!
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  const request = page.waitForRequest((request) => request.url().endsWith('/api/v1/me'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const headers = (await request).headers()
  await expect(page).toHaveURL(role === 'CUSTOMER' ? /\/account\/orders$/ : /\/workspace$/)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  return {
    Authorization: headers.authorization,
    'X-Docklane-Session': headers['x-docklane-session'],
  }
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/auth\/sign-in/)
}
async function scan(page: Page, dialog = false) {
  await expect(page.locator('.auth-layout, .connected-layout')).toBeVisible()
  await expect(page.locator('.connected-spinner')).toHaveCount(0)
  if (!dialog) await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze()
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
}
test('Admin session restores, reads persisted data, and is revoked on logout', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'ADMIN')
  await expect(page.getByRole('heading', { name: 'Your day, moving forward.' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your day, moving forward.' })).toBeVisible()
  expect((await request.get(`${apiUrl}/api/v1/orders`, { headers })).status()).toBe(200)
  await logout(page)
  await expect(page).toHaveURL(/\/auth\/sign-in/)
  expect((await request.get(`${apiUrl}/api/v1/me`, { headers })).status()).toBe(401)
  await page.goto('/workspace/team')
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=/)
})
test('Admin confirms a saved role change and connected order filters survive reload', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'ADMIN')
  const memberEmail = accounts.find((account) => account.role === 'CUSTOMER')!.email
  const team = await request.get(`${apiUrl}/api/v1/team?pageSize=100`, { headers })
  const member = (await team.json()).data.find(
    (member: { email: string }) => member.email === memberEmail,
  )
  const allOrders = await request.get(`${apiUrl}/api/v1/orders`, { headers })
  const initialPage = (await allOrders.json()).data
  const aditiOrders = await request.get(`${apiUrl}/api/v1/orders?q=Aditi`, { headers })
  const filteredPage = (await aditiOrders.json()).data
  expect(filteredPage.length).toBeGreaterThan(0)
  expect(
    filteredPage.every((order: { customerName: string }) => order.customerName.includes('Aditi')),
  ).toBe(true)
  try {
    await page.getByRole('link', { name: 'People & access', exact: true }).click()
    const row = page.locator('tbody tr').filter({ hasText: memberEmail })
    await row.getByRole('combobox').selectOption('OPERATOR')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm role change' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(row.getByRole('combobox')).toHaveValue('OPERATOR')
    await row.getByRole('combobox').selectOption(member.role)
    await page.getByRole('button', { name: 'Confirm role change' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(row.getByRole('combobox')).toHaveValue(member.role)
    await page.getByRole('link', { name: 'Orders', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search saved orders' }).fill('Aditi')
    await expect(page.locator('tbody tr')).toHaveCount(filteredPage.length)
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Search saved orders' })).toHaveValue('Aditi')
    await expect(page.locator('tbody tr')).toHaveCount(filteredPage.length)
    await page
      .getByRole('combobox', { name: 'Filter saved order status' })
      .selectOption('COMPLETED')
    const completedOrders = await request.get(`${apiUrl}/api/v1/orders?q=Aditi&status=COMPLETED`, {
      headers,
    })
    const completedPage = (await completedOrders.json()).data
    if (completedPage.length) {
      await expect(page.locator('tbody tr')).toHaveCount(completedPage.length)
      await page
        .getByRole('textbox', { name: 'Search saved orders' })
        .fill('docklane-does-not-exist-fixture')
    }
    await expect(page.getByRole('heading', { name: 'No orders match this view.' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(initialPage.length)
  } finally {
    const restored = await request.patch(`${apiUrl}/api/v1/team/${member.id}`, {
      headers,
      data: { role: member.role },
    })
    expect(restored.status()).toBe(200)
    await logout(page)
  }
})
test('Operator cannot grant roles or issue refunds', async ({ page, request }) => {
  const headers = await login(page, 'OPERATOR')
  await expect(page.getByRole('link', { name: 'People & access', exact: true })).toHaveCount(0)
  expect((await request.get(`${apiUrl}/api/v1/team`, { headers })).status()).toBe(403)
  expect(
    (
      await request.post(`${apiUrl}/api/v1/orders/DL-2048/refunds`, {
        headers,
        data: { amountPaise: 100, reason: 'Development verification' },
      })
    ).status(),
  ).toBe(403)
  await page.goto('/workspace/team')
  await expect(page.getByRole('alert')).toContainText('managed by a workspace admin')
  await logout(page)
})
test('Customer sees their own order and cannot open another customer’s address', async ({
  page,
  request,
}) => {
  const headers = await login(page, 'CUSTOMER')
  const response = await request.get(`${apiUrl}/api/v1/orders`, { headers })
  const orders = (await response.json()).data
  expect(orders.length).toBeGreaterThan(0)
  await expect(page.locator('tbody tr')).toHaveCount(orders.length)
  await page.getByRole('link', { name: `Open order ${orders[0].number}` }).click()
  await expect(page.getByRole('heading', { name: orders[0].number, exact: true })).toBeVisible()
  const seed = await request.get(`${apiUrl}/api/v1/orders/DL-2048`, { headers })
  const other = seed.status() === 200 ? 'DL-2038' : 'DL-2048'
  if (seed.status() !== 200)
    expect((await request.get(`${apiUrl}/api/v1/orders/DL-2038`, { headers })).status()).toBe(200)
  await page.goto(`/account/orders/${seed.status() === 200 ? 'DL-2048' : 'DL-2038'}`)
  await expect(page.getByText('DEVELOPMENT PAYMENT EXAMPLE', { exact: true })).toBeVisible()
  expect((await request.get(`${apiUrl}/api/v1/orders/${other}`, { headers })).status()).toBe(404)
  await page.goto(`/account/orders/${other}`)
  await expect(page.getByRole('alert')).toContainText('could not be found')
  await page.goto('/workspace')
  await expect(page).toHaveURL(/\/account\/orders$/)
  await logout(page)
})
test('Bad credentials, recovery navigation, and missing reset link show useful states', async ({
  page,
}) => {
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill(accounts[0].email)
  await page.getByLabel('Password', { exact: true }).fill('incorrect-development-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(accounts[0].email)
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Let’s get you back in.' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.goto('/auth/reset-password')
  await expect(page.getByRole('link', { name: 'Request a reset link' })).toBeVisible()
  await page.goto('/auth/reset-password?token=invalid-development-token')
  await page.getByLabel('New password', { exact: true }).fill('Invalid-token-test-password-123')
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('Invalid-token-test-password-123')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
})
test('New signup grants Customer and password reset changes the actual credential', async ({
  page,
}) => {
  const password = randomBytes(24).toString('base64url')
  const account = {
    name: 'Docklane Browser Check',
    email: `browser.${Date.now()}@docklane.example.test`,
    password,
    role: 'CUSTOMER',
  }
  await page.goto('/auth/sign-up')
  await page.getByLabel('Full name', { exact: true }).fill(account.name)
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Create customer account', exact: true }).click()
  await expect(page).toHaveURL(/\/account\/orders$/)
  await expect(page.getByRole('heading', { name: 'Your next order starts here.' })).toBeVisible()
  await mkdir('.local', { recursive: true })
  await writeFile('.local/auth-test-account.json', JSON.stringify(account, null, 2), {
    mode: 0o600,
  })
  await logout(page)
  await page.goto('/auth/forgot-password')
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
  // Exercise the provider-generated reset token without relying on email delivery
  // to a synthetic development address. This is a read on the development DB.
  const db = createDatabase(process.env.DATABASE_URL!)
  let resetToken: string
  try {
    const records = await db.$queryRaw<{ identifier: string }[]>`
      SELECT v.identifier FROM neon_auth.verification v
      JOIN neon_auth."user" u ON u.id::text = v.value
      WHERE u.email = ${account.email} AND v.identifier LIKE 'reset-password:%'
      ORDER BY v."createdAt" DESC LIMIT 1`
    expect(records).toHaveLength(1)
    resetToken = records[0].identifier.slice('reset-password:'.length)
  } finally {
    await db.$disconnect()
  }
  const nextPassword = randomBytes(24).toString('base64url')
  await page.goto(`/auth/reset-password?token=${encodeURIComponent(resetToken)}`)
  await page.getByLabel('New password', { exact: true }).fill(nextPassword)
  await page.getByLabel('Confirm new password', { exact: true }).fill(nextPassword)
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('heading', { name: 'Your password is updated.' })).toBeVisible()
  await writeFile(
    '.local/auth-test-account.json',
    JSON.stringify({ ...account, password: nextPassword }, null, 2),
    { mode: 0o600 },
  )
  const oldCredential = await fetch(`${process.env.NEON_AUTH_BASE_URL}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(page.url()).origin },
    body: JSON.stringify({ email: account.email, password }),
  })
  await oldCredential.arrayBuffer()
  expect(oldCredential.status).toBe(401)
  await page.getByRole('button', { name: 'Return to sign in' }).click()
  await expect(page).toHaveURL(/\/auth\/sign-in$/)
  await expect(page.getByRole('heading', { name: 'Good to have you back.' })).toBeVisible()
  await page.getByLabel('Email address', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  const oldSignIn = page.waitForResponse((response) => response.url().endsWith('/sign-in/email'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await oldSignIn).status()).toBe(401)
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill(nextPassword)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/account\/orders$/)
  await logout(page)
})
test('Identity screens pass accessibility and responsive checks with saved previews', async ({
  page,
}) => {
  await mkdir('docs/previews', { recursive: true })
  for (const path of [
    '/auth/sign-in',
    '/auth/sign-up',
    '/auth/forgot-password',
    '/auth/reset-password',
  ]) {
    await page.goto(path)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await scan(page)
  }
  for (const width of [390, 768, 1366, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
    await page.goto('/auth/sign-in')
    await scan(page)
    if ([390, 1366].includes(width))
      await page.screenshot({ path: `docs/previews/sign-in-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await login(page, 'ADMIN')
  for (const path of [
    '/workspace',
    '/workspace/orders',
    '/workspace/orders/DL-2048',
    '/workspace/team',
    '/account',
  ]) {
    await page.goto(path)
    await expect(page.locator('.connected-spinner')).toHaveCount(0)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await scan(page)
    if (['/workspace', '/workspace/team'].includes(path))
      await page.screenshot({
        path: `docs/previews/${path === '/workspace' ? 'connected-overview' : 'people-access'}-desktop.png`,
        fullPage: true,
      })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workspace')
  await expect(page.getByRole('heading', { name: 'Your day, moving forward.' })).toBeVisible()
  await scan(page)
  await page.screenshot({ path: 'docs/previews/connected-overview-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Open workspace navigation' }).click()
  await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toBeVisible()
  await scan(page, true)
  await page.keyboard.press('Escape')
  await logout(page)
  await login(page, 'CUSTOMER')
  await scan(page)
  await page.screenshot({ path: 'docs/previews/customer-orders-mobile.png', fullPage: true })
  await logout(page)
})
