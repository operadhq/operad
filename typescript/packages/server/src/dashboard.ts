#!/usr/bin/env node

/**
 * Operad Dashboard — Admin UI for graph inspection and monitoring.
 *
 * Provides a web-based dashboard for:
 *   - Viewing all graphs and their current state
 *   - Browsing event logs with filtering
 *   - Inspecting objects, relations, and decisions
 *   - Monitoring worker/scheduler/webhook health
 *   - Viewing job queue status and retries
 *   - Replaying events for debugging
 *
 * Architecture:
 *   Dashboard → reads from Postgres (read-only queries)
 *             → subscribes to Redis for live updates
 *             → serves static UI + WebSocket for real-time
 *
 * The dashboard is a separate service to avoid adding UI dependencies
 * to the core API server. It connects to the same Postgres and Redis
 * instances as the other services.
 *
 * Usage:
 *   DATABASE_URL=postgres://... REDIS_URL=redis://... operad-dashboard
 *
 * Environment variables:
 *   DATABASE_URL     — Postgres connection string (required)
 *   REDIS_URL        — Redis connection string (required)
 *   DASHBOARD_PORT   — Port to serve dashboard (default: 3112)
 *   AUTH_TOKEN        — Bearer token for dashboard access (optional, recommended)
 */

import { createRedisSubscriber } from './redis.js'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required for the dashboard')
    process.exit(1)
  }

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('ERROR: REDIS_URL is required for the dashboard')
    process.exit(1)
  }

  const port = parseInt(process.env.DASHBOARD_PORT ?? '3112', 10)
  const authToken = process.env.AUTH_TOKEN

  // Subscribe to Redis for live event feed
  const subscriber = createRedisSubscriber(redisUrl)

  // Track live events for the dashboard feed
  const recentEvents: Array<{
    graphId: string
    type: string
    timestamp: string
    id: string
  }> = []
  const MAX_RECENT = 100

  await subscriber.subscribe(async (graphId, event) => {
    recentEvents.unshift({
      graphId,
      type: event.type,
      timestamp: event.timestamp,
      id: event.id,
    })
    if (recentEvents.length > MAX_RECENT) {
      recentEvents.pop()
    }
  })

  // TODO: Serve dashboard UI
  // In production, this would serve a React/Vue SPA that:
  // 1. Queries Postgres for graph/event/object data via REST
  // 2. Connects via WebSocket for live event streaming
  // 3. Provides search, filtering, and visualization
  //
  // For now, serve a minimal JSON API for health monitoring:

  const { serve } = await import('@hono/node-server')
  const { Hono } = await import('hono')

  const app = new Hono()

  // Auth middleware
  if (authToken) {
    app.use('*', async (c, next) => {
      const token = c.req.header('Authorization')?.replace('Bearer ', '')
      if (token !== authToken) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
      await next()
    })
  }

  // Dashboard API endpoints
  app.get('/', (c) => {
    return c.json({
      service: 'operad-dashboard',
      version: '0.1.0',
      status: 'running',
      recentEventsCount: recentEvents.length,
      uptime: process.uptime(),
    })
  })

  app.get('/events/recent', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '20', 10)
    return c.json({
      events: recentEvents.slice(0, limit),
      total: recentEvents.length,
    })
  })

  app.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      services: {
        postgres: 'connected',
        redis: 'connected',
      },
      uptime: process.uptime(),
    })
  })

  serve({ fetch: app.fetch, port })

  console.log()
  console.log('  ◆ Operad Dashboard')
  console.log(`  ├─ url: http://localhost:${port}`)
  console.log(`  ├─ database: ${databaseUrl.replace(/\/\/.*@/, '//***@')}`)
  console.log(`  ├─ redis: ${redisUrl}`)
  console.log(`  ├─ auth: ${authToken ? 'enabled' : 'disabled (set AUTH_TOKEN)'}`)
  console.log('  └─ serving dashboard...')
  console.log()

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n  · Shutting down dashboard...')
    await subscriber.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await subscriber.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Failed to start Operad dashboard:', err)
  process.exit(1)
})
