import { behavior } from '../behavior.js'
import type { BehaviorDef, EventInput, JsonValue } from '../types.js'

/**
 * Retries failed behaviors up to 3 times by re-emitting the original
 * trigger event. After 3 failures, emits `custom.retry_exhausted`.
 */
export function autoRetry(): BehaviorDef {
  const failureCounts = new Map<string, number>()

  return behavior({
    name: 'autoRetry',
    on: ['behavior.failed'],
    handler: async (event, _graph, ctx) => {
      const behaviorName = event.payload.behaviorName as string
      const count = (failureCounts.get(behaviorName) ?? 0) + 1
      failureCounts.set(behaviorName, count)

      if (count < 3) {
        const originalEvent = event.payload.triggerEvent as Record<string, unknown> | undefined
        if (originalEvent) {
          await ctx.emit({
            type: originalEvent.type as EventInput['type'],
            payload: (originalEvent.payload ?? {}) as Record<string, JsonValue>,
            causedBy: event.id,
          })
        }
      } else {
        await ctx.emit({
          type: 'custom.retry_exhausted',
          payload: {
            behaviorName,
            failureCount: count,
          },
          causedBy: event.id,
        })
      }
    },
  })
}
