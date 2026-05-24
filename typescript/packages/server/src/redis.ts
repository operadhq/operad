/**
 * Redis event bus for Operad.
 *
 * The API server publishes events to Redis after persisting them.
 * The worker subscribes and executes matching behaviors asynchronously.
 *
 * Channel: operad:events:{graphId}
 * Payload: serialized GraphEvent
 */

import Redis from 'ioredis'
import type { GraphEvent } from '@operad/core'

const CHANNEL_PREFIX = 'operad:events'

export function createRedisPublisher(redisUrl: string) {
  const redis = new Redis(redisUrl)

  return {
    async publish(graphId: string, event: GraphEvent): Promise<void> {
      await redis.publish(
        `${CHANNEL_PREFIX}:${graphId}`,
        JSON.stringify(event)
      )
    },

    async publishToAll(event: GraphEvent & { graphId: string }): Promise<void> {
      await redis.publish(
        `${CHANNEL_PREFIX}:${event.graphId}`,
        JSON.stringify(event)
      )
    },

    async close(): Promise<void> {
      await redis.quit()
    },
  }
}

export function createRedisSubscriber(redisUrl: string) {
  const redis = new Redis(redisUrl)

  return {
    async subscribe(
      onEvent: (graphId: string, event: GraphEvent) => Promise<void>
    ): Promise<void> {
      // Subscribe to all graph event channels
      await redis.psubscribe(`${CHANNEL_PREFIX}:*`)

      redis.on('pmessage', async (_pattern, channel, message) => {
        const graphId = channel.replace(`${CHANNEL_PREFIX}:`, '')
        try {
          const event = JSON.parse(message) as GraphEvent
          await onEvent(graphId, event)
        } catch (err) {
          console.error(`  ✗ Failed to process event from ${channel}:`, err)
        }
      })
    },

    async close(): Promise<void> {
      await redis.quit()
    },
  }
}
