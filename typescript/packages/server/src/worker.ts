#!/usr/bin/env node

/**
 * Operad Worker — Background behavior processor.
 *
 * Subscribes to events via Redis pub/sub and executes matching behaviors
 * asynchronously. This decouples the API server (fast HTTP responses)
 * from behavior execution (potentially slow, side-effect heavy).
 *
 * Architecture:
 *   API Server → persists event → publishes to Redis
 *   Worker     → subscribes to Redis → matches behaviors → executes handlers
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 DATABASE_URL=postgres://... operad-worker
 *
 * Environment variables:
 *   REDIS_URL     — Redis connection string (required)
 *   DATABASE_URL  — Postgres connection string (required for behavior handlers)
 *   ADAPTER       — "memory" | "postgres" (default: "postgres")
 */

import { createRuntime, type StorageAdapter, type BehaviorDef } from '@operad/core'
import { createRedisSubscriber } from './redis.js'

async function main() {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('ERROR: REDIS_URL is required for the worker')
    process.exit(1)
  }

  const adapterName = process.env.ADAPTER ?? 'postgres'

  let storage: StorageAdapter

  if (adapterName === 'postgres') {
    const url = process.env.DATABASE_URL
    if (!url) {
      console.error('ERROR: DATABASE_URL is required when ADAPTER=postgres')
      process.exit(1)
    }
    const { PostgresAdapter } = await import('@operad/adapter-postgres')
    storage = new PostgresAdapter({ connectionString: url })
  } else {
    const { MemoryAdapter } = await import('@operad/adapter-memory')
    storage = new MemoryAdapter()
  }

  // Create runtime with behaviors
  // In production, behaviors would be loaded from a registry or plugin system.
  // For now, the worker runs with the same behaviors as the API server.
  const behaviors: BehaviorDef[] = loadBehaviors()
  const runtime = createRuntime({ storage, behaviors })

  // Subscribe to Redis events
  const subscriber = createRedisSubscriber(redisUrl)

  let processed = 0

  await subscriber.subscribe(async (graphId, event) => {
    // Skip behavior lifecycle events to avoid infinite loops
    if (
      event.type === 'behavior.triggered' ||
      event.type === 'behavior.completed' ||
      event.type === 'behavior.failed'
    ) {
      return
    }

    const graph = runtime.getGraph(graphId)

    // Re-emit through runtime to trigger behavior matching
    // The runtime will match behaviors and execute handlers
    try {
      await runtime.emit(graphId, {
        type: event.type,
        payload: event.payload,
        causedBy: event.id,
      })
      processed++
      if (processed % 100 === 0) {
        console.log(`  · Processed ${processed} events`)
      }
    } catch (err) {
      console.error(`  ✗ Worker error on ${event.type} (${event.id}):`, err)
    }
  })

  console.log()
  console.log('  ◆ Operad Worker')
  console.log(`  ├─ redis: ${redisUrl}`)
  console.log(`  ├─ adapter: ${adapterName}`)
  console.log('  ├─ behaviors: ' + behaviors.length + ' registered')
  console.log('  └─ listening for events...')
  console.log()

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n  · Shutting down worker...')
    await subscriber.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await subscriber.close()
    process.exit(0)
  })
}

/**
 * Load behaviors for the worker.
 *
 * TODO(human): Define which behaviors the worker should run.
 *
 * In production, this would load from:
 * - A behaviors directory (file-based plugins)
 * - A behavior registry (database-stored)
 * - Environment configuration
 *
 * For now, returns an empty array — behaviors are registered
 * via the SDK when using @operad/core directly.
 */
function loadBehaviors(): BehaviorDef[] {
  return []
}

main().catch((err) => {
  console.error('Failed to start Operad worker:', err)
  process.exit(1)
})
