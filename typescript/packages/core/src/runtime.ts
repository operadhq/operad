import type {
  StorageAdapter,
  Runtime,
  RuntimeOptions,
  GraphAPI,
  EventInput,
  GraphEvent,
  GraphDiff,
  BehaviorDef,
  BehaviorContext,
  BranchOptions,
  ForkOptions,
  PatchProposal,
  ProposeInput,
  RevertOptions,
  RevertResult,
  ExploreOptions,
  ExploreResult,
  ReversalHandler,
} from './types.js'
import { Graph } from './graph.js'
import { BehaviorRegistry } from './behavior.js'
import { resolveView } from './view.js'
import { parsePattern, matchPattern } from './pattern.js'
import { PatchRegistry } from './patch.js'
import { computeDiff } from './diff.js'
import { checkout as checkoutImpl } from './replay.js'
import { createEffectRegistry } from './effects.js'

/**
 * The Runtime is the event loop of Operad:
 *   emit event → match behaviors → execute handlers → emit new events → repeat
 *
 * Like a neural network: events fire, triggering downstream behaviors
 * that may fire more events, creating causal chains.
 */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { storage } = options
  const registry = new BehaviorRegistry()
  const graphs = new Map<string, Graph>()
  const patches = new PatchRegistry()
  const reversals = new Map<string, ReversalHandler>() // event type → reversal handler
  const effects = createEffectRegistry()

  // Register initial behaviors
  for (const def of options.behaviors ?? []) {
    registry.register(def)
  }

  // Core emit function — this is the event loop
  async function emit(graphId: string, input: EventInput): Promise<GraphEvent> {
    // Auto-set actor if not explicitly provided
    const enrichedInput = input.actor ? input : { ...input, actor: input.actor ?? 'user' }
    const event = await storage.appendEvent(graphId, enrichedInput)

    // Find matching behaviors
    const matched = registry.match(event)

    // Execute each matching behavior
    for (const def of matched) {
      const graph = getGraph(graphId)
      const ctx: BehaviorContext = {
        graphId,
        emit: (behaviorInput) =>
          emit(graphId, {
            ...behaviorInput,
            causedBy: event.id,
            actor: behaviorInput.actor ?? def.name,
          }),
        propose: async (input: ProposeInput) => {
          const proposal = patches.add({
            graphId,
            objectType: input.type,
            data: input.data,
            reason: input.reason ?? '',
            proposedBy: def.name,
          })
          await emit(graphId, {
            type: 'patch.proposed',
            payload: { patchId: proposal.id, objectType: input.type, proposedBy: def.name },
            causedBy: event.id,
            actor: def.name,
          })
          return proposal
        },
      }

      // Resolve view if specified
      if (def.view) {
        ctx.view = await resolveView(def.view, event, graph)
      }

      // Resolve pattern matches if specified
      if (def.pattern) {
        const parsed = parsePattern(def.pattern)
        ctx.matches = await matchPattern(parsed, graph)
      }

      // Emit behavior.triggered (goes through emit so other behaviors can react)
      await emit(graphId, {
        type: 'behavior.triggered',
        payload: { behaviorName: def.name, triggerEventId: event.id },
        causedBy: event.id,
        actor: 'runtime',
      })

      try {
        await def.handler(event, graph, ctx)

        // Emit behavior.completed
        await emit(graphId, {
          type: 'behavior.completed',
          payload: { behaviorName: def.name, triggerEventId: event.id },
          causedBy: event.id,
          actor: 'runtime',
        })
      } catch (error) {
        // Emit behavior.failed (other behaviors can react to failures)
        await emit(graphId, {
          type: 'behavior.failed',
          payload: {
            behaviorName: def.name,
            triggerEventId: event.id,
            reason: error instanceof Error ? error.message : String(error),
          },
          causedBy: event.id,
          actor: 'runtime',
        })
      }
    }

    return event
  }

  function getGraph(id: string): Graph {
    let graph = graphs.get(id)
    if (!graph) {
      graph = new Graph(id, storage, emit)
      graphs.set(id, graph)
    }
    return graph
  }

  return {
    async createGraph(id: string): Promise<GraphAPI> {
      const graph = new Graph(id, storage, emit)
      graphs.set(id, graph)

      await emit(id, {
        type: 'graph.created',
        payload: { graphId: id },
      })

      return graph
    },

    getGraph(id: string): GraphAPI {
      return getGraph(id)
    },

    registerBehavior(def: BehaviorDef): void {
      registry.register(def)
    },

    emit,

    async branch(graphId: string, opts: BranchOptions): Promise<GraphAPI> {
      if (!storage.copyEventsUpTo) {
        throw new Error('Storage adapter does not support branching (missing copyEventsUpTo)')
      }

      const branchId = opts.branchId ?? `${graphId}_branch_${Date.now()}`
      const count = await storage.copyEventsUpTo(graphId, branchId, opts.atEvent)

      const branchedGraph = new Graph(branchId, storage, emit)
      graphs.set(branchId, branchedGraph)

      await emit(branchId, {
        type: 'custom.graph_forked' as EventInput['type'],
        payload: {
          sourceGraphId: graphId,
          atEvent: opts.atEvent,
          label: opts.label ?? '',
          eventsCopied: count,
        },
        actor: 'runtime',
      })

      return branchedGraph
    },

    /** @deprecated Use branch() */
    async fork(graphId: string, opts: ForkOptions): Promise<GraphAPI> {
      return this.branch(graphId, {
        atEvent: opts.atEvent,
        label: opts.label,
        branchId: opts.branchId ?? opts.forkId,
      })
    },

    async diff(sourceGraphId: string, targetGraphId: string): Promise<GraphDiff> {
      return computeDiff(sourceGraphId, targetGraphId, storage)
    },

    async checkout(graphId: string, eventId: string): Promise<GraphAPI> {
      return checkoutImpl(graphId, eventId, storage)
    },

    async approve(patchId: string, decidedBy: string): Promise<void> {
      const proposal = patches.resolve(patchId, 'applied', decidedBy)
      const graph = getGraph(proposal.graphId)
      await graph.addObject({ type: proposal.objectType, data: proposal.data })
      await emit(proposal.graphId, {
        type: 'patch.applied',
        payload: { patchId, objectType: proposal.objectType, decidedBy },
        actor: decidedBy,
      })
    },

    async deny(patchId: string, decidedBy: string): Promise<void> {
      const proposal = patches.resolve(patchId, 'rejected', decidedBy)
      await emit(proposal.graphId, {
        type: 'patch.rejected',
        payload: { patchId, objectType: proposal.objectType, decidedBy },
        actor: decidedBy,
      })
    },

    pendingPatches(graphId: string): PatchProposal[] {
      return patches.pending(graphId)
    },

    async revert(graphId: string, opts: RevertOptions): Promise<RevertResult> {
      const actor = opts.actor ?? 'runtime'
      const allEvents = await storage.queryEvents(graphId, {})

      // Find the cutpoint
      const cutIndex = allEvents.findIndex((e) => e.id === opts.toEvent)
      if (cutIndex === -1) throw new Error(`Event not found: ${opts.toEvent}`)

      // Events to revert (everything AFTER the cutpoint, in reverse order)
      const toRevert = allEvents.slice(cutIndex + 1).reverse()

      const compensatingEvents: GraphEvent[] = []
      const unreversible: GraphEvent[] = []

      for (const event of toRevert) {
        // Emit a compensating event
        const compensating = await emit(graphId, {
          type: `custom.reverted.${event.type}` as EventInput['type'],
          payload: {
            originalEventId: event.id,
            originalType: event.type,
            originalPayload: event.payload,
          },
          causedBy: event.id,
          actor,
        })
        compensatingEvents.push(compensating)

        // If reverseEffects is true, use effect categories to decide reversal strategy
        if (opts.reverseEffects) {
          const toolName = typeof event.payload.tool === 'string' ? event.payload.tool : null
          const category = toolName ? effects.categorize(toolName) : null

          if (category === 'pure') {
            // Pure effects: nothing to reverse, skip
          } else if (category === 'bufferable') {
            // Bufferable effects: check for tool-specific reverser first, then event-type handler
            const toolReverser = toolName ? effects.getReverser(toolName) : undefined
            const handler = toolReverser ?? reversals.get(event.type)
            if (handler) {
              await handler(event)
            }
            // Bufferable events are always considered reversible (even without handler,
            // they are structurally invertible e.g. Edit old↔new swap)
          } else {
            // Externalized or unknown: check for registered handler, flag as unreversible if none
            const toolReverser = toolName ? effects.getReverser(toolName) : undefined
            const handler = toolReverser ?? reversals.get(event.type)
            if (handler) {
              await handler(event)
            } else if (event.type.startsWith('custom.tool_called')) {
              unreversible.push(event)
            }
          }
        }

        // Undo graph mutations (object/relation changes)
        if (event.type === 'object.created') {
          const objId = event.payload.objectId as string | undefined
          if (objId) await storage.removeObject(objId)
        } else if (event.type === 'relation.created') {
          const relId = event.payload.relationId as string | undefined
          if (relId) await storage.removeRelation(relId)
        }
      }

      // Emit a summary event
      await emit(graphId, {
        type: 'custom.reverted' as EventInput['type'],
        payload: {
          toEvent: opts.toEvent,
          eventsReverted: toRevert.length,
          unreversibleCount: unreversible.length,
        },
        actor,
      })

      return {
        eventsReverted: toRevert.length,
        compensatingEvents,
        unreversible,
      }
    },

    async explore(graphId: string, opts: ExploreOptions): Promise<ExploreResult> {
      if (!storage.copyEventsUpTo) {
        throw new Error('Storage adapter does not support branching (missing copyEventsUpTo)')
      }

      const label = opts.label ?? 'explore'
      const branches: Array<{ branchId: string; score: number; result: unknown }> = []

      // Fork N branches from the same point
      const branchGraphs: Array<{ id: string; graph: GraphAPI }> = []
      for (let i = 0; i < opts.branches; i++) {
        const branchId = `${graphId}_${label}_${i}_${Date.now()}`
        const branchGraph = await this.branch(graphId, {
          atEvent: opts.atEvent,
          branchId,
          label: `${label}-${i}`,
        })
        branchGraphs.push({ id: branchId, graph: branchGraph })
      }

      // Run worker on each branch (parallel)
      const results = await Promise.all(
        branchGraphs.map(async ({ id, graph }) => {
          const result = await opts.worker(graph, id)
          const score = opts.scorer(result, id)
          return { branchId: id, score, result }
        })
      )

      // Sort by score, pick winner
      results.sort((a, b) => b.score - a.score)
      const winner = results[0]

      // Emit explore summary on the original graph
      await emit(graphId, {
        type: 'custom.explored' as EventInput['type'],
        payload: {
          winnerId: winner.branchId,
          winnerScore: winner.score,
          branchCount: opts.branches,
          scores: results.map((r) => ({ branchId: r.branchId, score: r.score })),
        },
        actor: 'runtime',
      })

      return {
        winnerId: winner.branchId,
        winnerScore: winner.score,
        branches: results,
        winnerGraph: graphs.get(winner.branchId)!,
      }
    },

    /** Register a reversal handler for a specific event type */
    registerReversal(eventType: string, handler: ReversalHandler): void {
      reversals.set(eventType, handler)
    },
  }
}
