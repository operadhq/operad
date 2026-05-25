#!/usr/bin/env node

/**
 * Operad Webhook Dispatcher — Reliable event delivery to external URLs.
 *
 * Subscribes to graph events and delivers them to registered webhook
 * endpoints with retry logic, signature verification, and delivery tracking.
 *
 * Architecture:
 *   API Server → persists event → publishes to Redis
 *   Webhook Dispatcher → subscribes to Redis → matches webhook registrations
 *                       → delivers HTTP POST with HMAC signature
 *                       → retries with exponential backoff on failure
 *                       → records delivery status in Postgres
 *
 * Webhook registration is stored in `operad_webhooks` table:
 *   - url: Target URL
 *   - secret: HMAC signing secret
 *   - events: Array of event types to subscribe to (or "*" for all)
 *   - graph_id: Optional — scope to specific graph
 *   - active: Boolean
 *
 * Delivery attempts are logged in `operad_webhook_deliveries`:
 *   - webhook_id, event_id, attempt, status_code, response_body, delivered_at
 *
 * Usage:
 *   DATABASE_URL=postgres://... REDIS_URL=redis://... operad-webhooks
 *
 * Environment variables:
 *   DATABASE_URL       — Postgres connection string (required)
 *   REDIS_URL          — Redis connection string (required)
 *   MAX_RETRIES        — Max delivery retries (default: 5)
 *   RETRY_BACKOFF_BASE — Base backoff in ms (default: 1000, exponential)
 *   DELIVERY_TIMEOUT   — HTTP request timeout in ms (default: 10000)
 *   DISPATCHER_ID      — Unique ID for this instance (default: random)
 */

import { createRedisSubscriber } from './redis.js'
import type { GraphEvent } from '@operad/core'

interface WebhookRegistration {
  id: string
  url: string
  secret: string
  events: string[]
  graphId: string | null
  active: boolean
}

interface DeliveryAttempt {
  webhookId: string
  eventId: string
  attempt: number
  statusCode: number | null
  responseBody: string | null
  error: string | null
  deliveredAt: Date
}

async function main() {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('ERROR: REDIS_URL is required for the webhook dispatcher')
    process.exit(1)
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required for the webhook dispatcher')
    process.exit(1)
  }

  const maxRetries = parseInt(process.env.MAX_RETRIES ?? '5', 10)
  const retryBackoffBase = parseInt(process.env.RETRY_BACKOFF_BASE ?? '1000', 10)
  const deliveryTimeout = parseInt(process.env.DELIVERY_TIMEOUT ?? '10000', 10)
  const dispatcherId = process.env.DISPATCHER_ID ?? `webhooks-${Math.random().toString(36).slice(2, 8)}`

  // Subscribe to Redis events
  const subscriber = createRedisSubscriber(redisUrl)

  let delivered = 0
  let failed = 0

  await subscriber.subscribe(async (graphId, event) => {
    // Skip internal lifecycle events
    if (
      event.type === 'behavior.triggered' ||
      event.type === 'behavior.completed' ||
      event.type === 'behavior.failed'
    ) {
      return
    }

    // TODO: Load matching webhook registrations from operad_webhooks table
    // SELECT * FROM operad_webhooks
    // WHERE active = true
    //   AND (graph_id IS NULL OR graph_id = $1)
    //   AND (events @> ARRAY[$2] OR events @> ARRAY['*'])
    const registrations: WebhookRegistration[] = []

    for (const webhook of registrations) {
      try {
        await deliverWebhook(webhook, graphId, event, {
          maxRetries,
          retryBackoffBase,
          deliveryTimeout,
        })
        delivered++
      } catch (err) {
        failed++
        console.error(`  ✗ Webhook delivery failed for ${webhook.url}:`, err)
      }
    }
  })

  console.log()
  console.log('  ◆ Operad Webhook Dispatcher')
  console.log(`  ├─ id: ${dispatcherId}`)
  console.log(`  ├─ redis: ${redisUrl}`)
  console.log(`  ├─ max retries: ${maxRetries}`)
  console.log(`  ├─ delivery timeout: ${deliveryTimeout}ms`)
  console.log('  └─ listening for events...')
  console.log()

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n  · Shutting down webhook dispatcher...')
    console.log(`  · Delivered: ${delivered}, Failed: ${failed}`)
    await subscriber.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await subscriber.close()
    process.exit(0)
  })
}

async function deliverWebhook(
  webhook: WebhookRegistration,
  graphId: string,
  event: GraphEvent,
  opts: { maxRetries: number; retryBackoffBase: number; deliveryTimeout: number }
): Promise<void> {
  const payload = JSON.stringify({
    id: event.id,
    type: event.type,
    graphId,
    payload: event.payload,
    timestamp: event.timestamp,
  })

  // TODO: Generate HMAC signature
  // const signature = crypto.createHmac('sha256', webhook.secret)
  //   .update(payload).digest('hex')

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), opts.deliveryTimeout)

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Operad-Event': event.type,
          'X-Operad-Graph': graphId,
          // 'X-Operad-Signature': `sha256=${signature}`,
          'X-Operad-Delivery': event.id,
          'X-Operad-Attempt': String(attempt + 1),
        },
        body: payload,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (response.ok) {
        // TODO: Record successful delivery in operad_webhook_deliveries
        return
      }

      // Non-retryable status codes
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error(`Webhook returned ${response.status}: not retryable`)
      }

      // Retryable — fall through to backoff
    } catch (err) {
      if (attempt === opts.maxRetries) {
        throw err
      }
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const backoff = opts.retryBackoffBase * Math.pow(2, attempt)
    await new Promise((resolve) => setTimeout(resolve, backoff))
  }
}

main().catch((err) => {
  console.error('Failed to start Operad webhook dispatcher:', err)
  process.exit(1)
})
