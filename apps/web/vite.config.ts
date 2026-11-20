import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Shared tab primitives load on the public page without pulling in workspace menus.
const tabPrimitives = new Set([
  'primitive',
  'react-collection',
  'react-compose-refs',
  'react-context',
  'react-direction',
  'react-id',
  'react-presence',
  'react-primitive',
  'react-roving-focus',
  'react-slot',
  'react-use-callback-ref',
  'react-use-controllable-state',
  'react-use-effect-event',
  'react-use-is-hydrated',
  'react-use-layout-effect',
])

export default defineConfig({
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes('commonjsHelpers')) return 'vendor-runtime'
          if (!id.includes('/node_modules/')) return
          if (
            /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)
          )
            return 'react-vendor'
          const radixPackage = id.match(/\/node_modules\/@radix-ui\/([^/]+)\//)?.[1]
          if (radixPackage === 'react-tabs') return 'tabs-vendor'
          if (radixPackage && tabPrimitives.has(radixPackage)) return 'radix-primitives'
          if (/\/node_modules\/(radix-ui|@radix-ui|@floating-ui|cmdk|sonner)\//.test(id))
            return 'ui-vendor'
          if (/\/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id))
            return 'motion-vendor'
        },
      },
    },
  },
})
