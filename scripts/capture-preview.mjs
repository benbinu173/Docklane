import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const destination = resolve('docs/previews')
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173'
await mkdir(destination, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1366, height: 768 },
  reducedMotion: 'reduce',
})
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
for (const shot of [
  { name: 'overview-desktop', path: '/', width: 1366, height: 768, fullPage: true },
  { name: 'inventory-desktop', path: '/inventory', width: 1440, height: 900, fullPage: true },
  {
    name: 'order-details-desktop',
    path: '/orders?order=DL-2048',
    width: 1440,
    height: 900,
    fullPage: false,
  },
  { name: 'overview-mobile', path: '/', width: 390, height: 844, fullPage: true },
  {
    name: 'order-details-mobile',
    path: '/orders?order=DL-2048',
    width: 390,
    height: 844,
    fullPage: false,
  },
]) {
  await page.setViewportSize({ width: shot.width, height: shot.height })
  await page.goto(`${baseUrl}${shot.path}`)
  await page.locator('h1').waitFor()
  if (shot.path.includes('order=')) await page.getByRole('dialog').waitFor()
  await page.evaluate(async () => {
    await document.fonts.ready
    document.querySelectorAll('img').forEach((image) => {
      image.loading = 'eager'
    })
  })
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete))
  await page.screenshot({
    path: resolve(destination, `${shot.name}.png`),
    fullPage: shot.fullPage,
    animations: 'disabled',
  })
  console.log(`${shot.name}: ${shot.width}px`)
}
await browser.close()
if (errors.length) throw new Error(errors.join('\n'))
