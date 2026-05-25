#!/usr/bin/env node

/**
 * Operad Scheduler — Durable job processor (Oban-equivalent).
 *
 * Polls Postgres for scheduled jobs and executes them reliably.
 * Unlike the Worker (Redis pub/sub, at-most-once), the Scheduler
 * guarantees at-least-once execution with retries, backoff, and
 * dead-letter handling.
 *
 * Architecture:
 *   API/Worker → inserts job row into `operad_jobs` table
 *   Scheduler  → polls table → claims job (SELECT FOR UPDATE SKIP LOCKED)
 *               → executes → marks complete or retries
 *
 * Job types:
 *   - behavior.deferred    — Behaviors with delay/schedule
 *   - projection.rebuild   — Rebuild read models from event log
 *   - snapshot.create      — Periodic graph state snapshots
 *   - cleanup.expired      — TTL-based graph/event cleanup
 *
 * Usage:
 *   DATABASE_URL=postgres://... REDIS_URL=redis://... operad-scheduler
 *
 * Environment variables:
 *   DATABASE_URL     — Postgres connection string (required)
 *   REDIS_URL        — Redis connection string (required, for coordination)
 *   POLL_INTERVAL_MS — How often to poll for jobs (default: 1000)
 *   MAX_CONCURRENCY  — Max concurrent job execution (default: 10)
 *   SCHEDULER_ID     — Unique ID for this scheduler instance (default: random)
 */

import { createRuntime, type StorageAdapter } from '@operad/core'

interface Job {
  id: string
  queue: string
  type: string
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
  scheduledAt: Date
  lockedAt: Date | null
  lockedBy: string | null
  completedAt: Date | null
  failedAt: Date | null
  lastError: string | null
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required for the scheduler')
    process.exit(1)
  }

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('ERROR: REDIS_URL is required for the scheduler')
    process.exit(1)
  }

  const pollInterval = parseInt(process.env.POLL_INTERVAL_MS ?? '1000', 10)
  const maxConcurrency = parseInt(process.env.MAX_CONCURRENCY ?? '10', 10)
  const schedulerId = process.env.SCHEDULER_ID ?? `scheduler-${Math.random().toString(36).slice(2, 8)}`

  const adapterName = process.env.ADAPTER ?? 'postgres'

  let storage: StorageAdapter

  if (adapterName === 'postgres') {
    const { PostgresAdapter } = await import('@operad/adapter-postgres')
    storage = new PostgresAdapter({ connectionString: databaseUrl })
  } else {
    const { MemoryAdapter } = await import('@operad/adapter-memory')
    storage = new MemoryAdapter()
  }

  const runtime = createRuntime({ storage })

  let running = true
  let activeJobs = 0
  let totalProcessed = 0

  console.log()
  console.log('  ◆ Operad Scheduler')
  console.log(`  ├─ id: ${schedulerId}`)
  console.log(`  ├─ database: ${databaseUrl.replace(/\/\/.*@/, '//***@')}`)
  console.log(`  ├─ poll interval: ${pollInterval}ms`)
  console.log(`  ├─ max concurrency: ${maxConcurrency}`)
  console.log('  └─ polling for jobs...')
  console.log()

  // Main poll loop
  async function poll() {
    while (running) {
      try {
        if (activeJobs < maxConcurrency) {
          // TODO: Claim jobs from operad_jobs table
          // SELECT * FROM operad_jobs
          // WHERE scheduled_at <= NOW()
          //   AND locked_at IS NULL
          //   AND completed_at IS NULL
          //   AND (failed_at IS NULL OR attempts < max_attempts)
          // ORDER BY scheduled_at ASC
          // LIMIT $1
          // FOR UPDATE SKIP LOCKED

          // Placeholder: no jobs table yet
          // Jobs will be claimed and executed here
        }
      } catch (err) {
        console.error(`  ✗ Scheduler poll error:`, err)
      }

      await sleep(pollInterval)
    }
  }

  poll()

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n  · Shutting down scheduler...')
    running = false
    // Wait for active jobs to complete
    while (activeJobs > 0) {
      console.log(`  · Waiting for ${activeJobs} active jobs...`)
      await sleep(1000)
    }
    console.log(`  · Processed ${totalProcessed} jobs total`)
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    running = false
    while (activeJobs > 0) {
      await sleep(1000)
    }
    process.exit(0)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('Failed to start Operad scheduler:', err)
  process.exit(1)
})
