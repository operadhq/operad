import { behavior } from '../behavior.js'
import type { BehaviorDef } from '../types.js'

/**
 * Signals intent to branch the graph at the event that caused a failure.
 * Emits `custom.branch_requested` — actual branching is user-land.
 */
export function branchOnFailure(): BehaviorDef {
  return behavior({
    name: 'branchOnFailure',
    on: ['behavior.failed'],
    handler: async (event, _graph, ctx) => {
      const atEvent = (event.payload.triggerEventId as string) ?? event.causedBy ?? event.id
      const reason = (event.payload.error as string) ?? 'behavior failed'

      await ctx.emit({
        type: 'custom.branch_requested',
        payload: { atEvent, reason },
        causedBy: event.id,
      })
    },
  })
}
