import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
let failed = false
const paths = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '/',
      '/inventory',
      '/orders',
      '/warehouses',
      '/payments',
      '/activity',
      '/settings',
      '/orders?order=DL-2048',
    ]
for (const path of paths) {
  await page.goto(`http://127.0.0.1:5173${path}`)
  await page.locator('h1').waitFor()
  if (path.includes('order=')) await page.getByRole('dialog').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze()
  console.log(
    JSON.stringify({
      path,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.slice(0, 3).map((node) => ({
          target: node.target,
          summary: node.failureSummary,
          data: node.any.map((check) => check.data),
        })),
      })),
    }),
  )
  failed ||= result.violations.length > 0
  if (result.violations.length && paths.length === 1) {
    console.log(
      JSON.stringify(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll('.global-search, .product-open'))
            .slice(0, 3)
            .map((element) => ({
              label: element.getAttribute('aria-label'),
              text: element.textContent,
              innerText: element.innerText,
            })),
        ),
      ),
    )
  }
}
await browser.close()
if (failed) process.exitCode = 1
