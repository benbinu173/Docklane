import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir } from 'node:fs/promises'

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat|Minified React error/i.test(message.text()))
      throw new Error(message.text())
  })
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`landing page is accessible and responsive in ${colorScheme} mode`, async ({ page }) => {
    await mkdir('docs/previews', { recursive: true })
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    for (const width of [390, 768, 1366, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
      await page.goto('/welcome')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Every order.Moving forward.',
      )
      await page.evaluate(() => document.fonts.ready)
      // Exercise lazy images in their real viewport before checking the whole page.
      for (const image of await page.locator('img').all()) {
        await image.scrollIntoViewIfNeeded()
        await image.evaluate((element) => (element as HTMLImageElement).decode().catch(() => null))
      }
      await page.evaluate(() => scrollTo(0, 0))
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        .analyze()
      expect(
        result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(
        await page
          .locator('img')
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
          ),
      ).toBe(true)
      if ([390, 1366].includes(width))
        await page.screenshot({
          path: `docs/previews/phase7-landing-${colorScheme}-${width}.png`,
          fullPage: true,
        })
    }
  })
}
test('landing demonstration, anchor navigation and demo entry work with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/welcome')
  await page.getByRole('link', { name: 'Follow an order' }).click()
  await expect(page).toHaveURL(/#journey$/)
  await page.getByRole('button', { name: 'Illustrate 50 requests' }).click()
  await expect(page.locator('.landing-proof-results')).toContainText('40Insufficient stock')
  await page.getByRole('button', { name: 'Reset illustration' }).click()
  await expect(page.locator('.landing-proof-results')).toContainText(
    'What happens when 50 customers',
  )
  await page.getByRole('button', { name: /Change color theme/ }).click()
  await expect(page.locator('.landing')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('link', { name: 'Explore the demo', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Your day, in motion.' })).toBeVisible()
})
