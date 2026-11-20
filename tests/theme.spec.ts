import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('a selected theme survives navigation and reload and applies to portaled controls', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.goto('/welcome')
  await page.getByRole('button', { name: 'Change color theme, currently system' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('link', { name: 'Explore the demo', exact: true }).click()
  await expect(page.locator('.fulfillment-board')).toHaveCSS('background-color', 'rgb(25, 37, 53)')
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Change color theme, currently dark' }),
  ).toBeVisible()
  await page.getByRole('combobox', { name: 'Filter by warehouse' }).click()
  await expect(page.locator('[data-slot="select-content"]')).toHaveCSS(
    'background-color',
    'rgb(25, 37, 53)',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Change color theme, currently dark' }).click()
  await expect(page.locator('.fulfillment-board')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
  await page.goto('/auth/sign-in')
  await expect(
    page.getByRole('button', { name: 'Change color theme, currently light' }),
  ).toBeVisible()
  await expect(page.locator('.auth-main')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})

test('System follows device changes while an explicit choice takes precedence', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.goto('/settings')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('radio', { name: /Light/ }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('radio', { name: /System/ }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('appearance remains usable when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', {
      value: () => {
        throw new Error('Storage unavailable')
      },
    })
    Object.defineProperty(Storage.prototype, 'setItem', {
      value: () => {
        throw new Error('Storage unavailable')
      },
    })
  })
  await page.goto('/welcome')
  await page.getByRole('button', { name: 'Change color theme, currently system' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Change color theme, currently dark' }),
  ).toBeVisible()
})

test('a saved preference synchronizes across open Docklane tabs', async ({ page, context }) => {
  await page.goto('/settings')
  const second = await context.newPage()
  await second.goto('/welcome')
  await page.getByRole('radio', { name: /Dark/ }).check()
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(
    second.getByRole('button', { name: 'Change color theme, currently dark' }),
  ).toBeVisible()
})

test('dark order details preserve readable content and keyboard dismissal', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.goto('/orders?order=DL-2048')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    result.violations.map((value) => ({
      id: value.id,
      targets: value.nodes.map((node) => node.target),
    })),
  ).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Every order, accounted for.' })).toBeVisible()
})
