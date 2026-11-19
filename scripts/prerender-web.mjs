import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { IconContext } from '@phosphor-icons/react/dist/lib/context'
import { PassThrough } from 'node:stream'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const server = await createServer({
  root: web,
  configFile: `${web}/vite.config.ts`,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-prerender/', import.meta.url)),
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
})
try {
  const { default: App } = await server.ssrLoadModule('/src/App.tsx')
  const tree = createElement(
    StaticRouter,
    { location: '/welcome' },
    createElement(
      MotionConfig,
      { reducedMotion: 'user' },
      createElement(
        IconContext.Provider,
        { value: { size: 20, weight: 'regular' } },
        createElement(App),
      ),
    ),
  )
  const markup = await new Promise((resolve, reject) => {
    const stream = new PassThrough(),
      chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => {
      clearTimeout(timer)
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    stream.on('error', reject)
    const { pipe, abort } = renderToPipeableStream(tree, {
      onAllReady() {
        pipe(stream)
      },
      onError(error) {
        reject(error)
      },
    })
    const timer = setTimeout(() => {
      abort()
      reject(new Error('The Docklane product page did not finish static rendering.'))
    }, 15_000)
  })
  const html = await readFile(`${web}/dist/index.html`, 'utf8')
  const manifest = JSON.parse(await readFile(`${web}/dist/.vite/manifest.json`, 'utf8'))
  const landing = manifest['src/pages/landing.tsx']
  if (!landing?.css?.length) throw new Error('The product page stylesheet could not be located.')
  const styles = landing.css
    .map((file) => `<link rel="stylesheet" crossorigin href="/${file}">`)
    .join('\n    ')
  const fonts = (manifest['index.html']?.assets ?? [])
    .filter((file) => /geist-latin-(400|500)-normal-.*\.woff2$/.test(file))
    .map((file) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="/${file}">`)
    .join('\n    ')
  if (!fonts) throw new Error('The above-fold product page fonts could not be located.')
  if (!html.includes('<div id="root"></div>'))
    throw new Error('The empty application root could not be located.')
  await writeFile(
    `${web}/dist/welcome.html`,
    html
      .replace('<div id="root"></div>', `<div id="root">${markup}</div>`)
      .replace('</head>', `    ${styles}\n    ${fonts}\n  </head>`)
      .replace(/<title>[^<]*<\/title>/, '<title>Docklane | Every order, moving forward</title>'),
  )
  console.log(
    'Static Docklane product page created at /welcome; workspace routes retain client rendering.',
  )
} finally {
  await server.close()
}
