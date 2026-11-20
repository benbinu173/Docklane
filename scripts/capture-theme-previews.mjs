import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:5173'
await mkdir('apps/web/public/previews', { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      reducedMotion: 'reduce',
      colorScheme: theme,
    })
    await context.addInitScript(
      (theme) => localStorage.setItem('docklane.color-theme', theme),
      theme,
    )
    const page = await context.newPage()
    for (const [name, route] of [
      ['overview', '/'],
      ['inventory', '/inventory'],
      ['order', '/orders?order=DL-2048'],
    ]) {
      await page.goto(`${base}${route}`)
      await page.locator('h1').first().waitFor()
      if (name === 'order') await page.getByRole('dialog').waitFor()
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all([...document.images].map((image) => image.decode().catch(() => null)))
      })
      const screenshot = await page.screenshot({ animations: 'disabled' })
      const webp = await page.evaluate(
        async (source) => {
          const image = new Image()
          image.src = source
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          canvas.getContext('2d').drawImage(image, 0, 0)
          return canvas.toDataURL('image/webp', 0.85).split(',')[1]
        },
        `data:image/png;base64,${screenshot.toString('base64')}`,
      )
      const suffix = theme === 'dark' ? '-dark' : ''
      await writeFile(`apps/web/public/previews/${name}${suffix}.webp`, Buffer.from(webp, 'base64'))
      console.log(`Captured ${name} in ${theme} mode.`)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
