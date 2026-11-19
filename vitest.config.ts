import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'domain', include: ['tests/domain/**/*.test.ts'], environment: 'node' } },
      {
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
