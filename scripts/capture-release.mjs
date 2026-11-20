import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173'
const target = new URL(origin)
if (!['localhost', '127.0.0.1'].includes(target.hostname))
  throw new Error('Release capture uses a local production preview with public/sample data.')
await mkdir('docs/previews', { recursive: true })
await mkdir('.local/release', { recursive: true })
const browser = await chromium.launch()
try {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ colorScheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    for (const width of [390, 1366]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
      for (const [route, name] of [
        ['/welcome', 'landing'],
        ['/', 'overview'],
      ]) {
        await page.goto(new URL(route, origin).toString())
        await page.evaluate(() => document.fonts.ready)
        for (const image of await page.locator('img').all()) {
          await image.scrollIntoViewIfNeeded()
          await image.evaluate((element) => element.decode().catch(() => null))
        }
        await page.evaluate(() => scrollTo(0, 0))
        if (route === '/') await page.locator('.fulfillment-board').waitFor()
        await page.screenshot({
          path: `docs/previews/release-${name}-${colorScheme}-${width}.png`,
          fullPage: true,
        })
      }
    }
    await context.close()
  }
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    colorScheme: 'light',
    recordVideo: { dir: '.local/release', size: { width: 1366, height: 768 } },
  })
  const page = await context.newPage()
  await page.goto(new URL('/welcome', origin).toString())
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: /Change color theme/ }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('link', { name: 'Explore the demo', exact: true }).click()
  await page.locator('.fulfillment-board').waitFor()
  await page.waitForTimeout(3000)
  await page.goto(new URL('/inventory', origin).toString())
  await page.waitForTimeout(3000)
  await page.goto(new URL('/orders?order=DL-2048', origin).toString())
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(3000)
  await page.keyboard.press('Escape')
  await page.goto(new URL('/settings', origin).toString())
  await page.getByRole('radio', { name: /Light/ }).check()
  await page.waitForTimeout(3000)
  const video = page.video()
  await context.close()
  await video.saveAs('.local/release/docklane-walkthrough.webm')
  console.log(
    'Eight current release screenshots captured. Public/sample walkthrough saved privately to .local/release/docklane-walkthrough.webm; it does not demonstrate a connected payment.',
  )
} finally {
  await browser.close()
}
