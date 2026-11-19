import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  build: {
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
          if (/\/node_modules\/(radix-ui|@radix-ui|@floating-ui|cmdk|sonner)\//.test(id))
            return 'ui-vendor'
          if (/\/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id))
            return 'motion-vendor'
        },
      },
    },
  },
})
