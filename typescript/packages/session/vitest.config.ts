import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@operad/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@operad/adapter-memory': path.resolve(__dirname, '../adapter-memory/src/index.ts'),
    },
  },
})
