import type {
  StorageAdapter,
  Runtime,
  RuntimeOptions,
  GraphAPI,
  EventInput,
  GraphEvent,
  BehaviorDef,
  BehaviorContext,
} from './types.js'
import { Graph } from './graph.js'
import { BehaviorRegistry } from './behavior.js'

/**
 * The Runtime is the event loop of Engram:
 *   emit event → match behaviors → execute handlers → emit new events → repeat
 *
 * Like a neural network: events fire, triggering downstream behaviors
 * that may fire more events, creating causal chains.
 */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { storage } = options
  const registry = new BehaviorRegistry()
  const graphs = new Map<string, Graph>()

  // Register initial behaviors
  for (const def of options.behaviors ?? []) {
    registry.register(def)
  }

  // Core emit function — this is the event loop
  async function emit(graphId: string, input: EventInput): Promise<GraphEvent> {
    const event = await storage.appendEvent(graphId, input)

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
          }),
      }

      // Emit behavior.triggered (goes through emit so other behaviors can react)
      await emit(graphId, {
        type: 'behavior.triggered',
        payload: { behaviorName: def.name, triggerEventId: event.id },
        causedBy: event.id,
      })

      try {
        await def.handler(event, graph, ctx)

        // Emit behavior.completed
        await emit(graphId, {
          type: 'behavior.completed',
          payload: { behaviorName: def.name, triggerEventId: event.id },
          causedBy: event.id,
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
  }
}
