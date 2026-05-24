#!/usr/bin/env node

/**
 * CLI entry point for @operad/server.
 *
 * Usage:
 *   ADAPTER=memory  operad-server          # in-memory (default, for dev)
 *   ADAPTER=postgres DATABASE_URL=...  operad-server  # Postgres (production)
 *
 * Environment variables:
 *   PORT          — HTTP port (default: 3111)
 *   ADAPTER       — "memory" | "postgres" (default: "memory")
 *   DATABASE_URL  — Postgres connection string (required when ADAPTER=postgres)
 */

import { serve } from '@hono/node-server'
import { createApp } from './index.js'
import type { StorageAdapter } from '@operad/core'

async function main() {
  const port = parseInt(process.env.PORT ?? '3111', 10)
  const adapterName = process.env.ADAPTER ?? 'memory'

  let storage: StorageAdapter

  if (adapterName === 'postgres') {
    const url = process.env.DATABASE_URL
    if (!url) {
      console.error('ERROR: DATABASE_URL is required when ADAPTER=postgres')
      process.exit(1)
    }

    const { PostgresAdapter } = await import('@operad/adapter-postgres')
    storage = new PostgresAdapter({ connectionString: url })
    console.log('  Storage: Postgres (auto-migrating)')
  } else {
    const { MemoryAdapter } = await import('@operad/adapter-memory')
    storage = new MemoryAdapter()
    console.log('  Storage: In-memory (data lost on restart)')
  }

  const { app } = createApp(storage)

  console.log()
  console.log('  ◆ Operad Server')
  console.log(`  ├─ http://localhost:${port}`)
  console.log(`  ├─ adapter: ${adapterName}`)
  console.log('  └─ ready')
  console.log()

  serve({ fetch: app.fetch, port })
}

main().catch((err) => {
  console.error('Failed to start Operad server:', err)
  process.exit(1)
})
