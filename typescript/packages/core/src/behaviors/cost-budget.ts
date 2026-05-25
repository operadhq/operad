import { behavior } from '../behavior.js'
import type { BehaviorDef } from '../types.js'

/**
 * Tracks cumulative cost from `custom.blame_recorded` events.
 * Emits `custom.budget_exceeded` when total surpasses maxCost.
 */
export function costBudget(opts: { maxCost: number }): BehaviorDef {
  let totalCost = 0

  return behavior({
    name: 'costBudget',
    on: ['custom.blame_recorded'],
    handler: async (event, _graph, ctx) => {
      const cost = (event.payload.cost as number) ?? 0
      totalCost += cost

      if (totalCost > opts.maxCost) {
        await ctx.emit({
          type: 'custom.budget_exceeded',
          payload: {
            totalCost,
            maxCost: opts.maxCost,
            overage: totalCost - opts.maxCost,
          },
          causedBy: event.id,
        })
      }
    },
  })
}
