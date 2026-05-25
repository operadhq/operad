import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/worker.ts', 'src/scheduler.ts', 'src/webhooks.ts', 'src/dashboard.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
})
