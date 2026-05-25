/**
 * @operad/session subagent — Auto-inherit parent graph state when a subagent starts.
 *
 * When Claude Code spawns a subagent, the child session can fork the parent's
 * entire event log so it starts with full context (file reads, goals, tool calls).
 */

import type { Runtime, GraphAPI, StorageAdapter } from '@operad/core'

export interface ForkResult {
  childGraph: GraphAPI
  childGraphId: string
}

/**
 * Fork a parent graph into a child graph, copying all events up to the latest.
 * Uses runtime.branch() which copies events and emits custom.graph_forked,
 * then emits an additional custom.subagent_forked event for traceability.
 */
export async function forkForSubagent(
  parentGraphId: string,
  childGraphId: string,
  runtime: Runtime,
  storage: StorageAdapter,
): Promise<ForkResult> {
  // Find the latest event in the parent graph
  const parentEvents = await storage.queryEvents(parentGraphId, {})
  if (parentEvents.length === 0) {
    throw new Error(`Parent graph "${parentGraphId}" has no events to fork`)
  }

  const lastEvent = parentEvents[parentEvents.length - 1]

  const childGraph = await runtime.branch(parentGraphId, {
    atEvent: lastEvent.id,
    branchId: childGraphId,
    label: `subagent-fork-from-${parentGraphId}`,
  })

  // Emit subagent-specific event for traceability
  await runtime.emit(childGraphId, {
    type: 'custom.subagent_forked' as any,
    payload: {
      parentGraphId,
      childGraphId,
      forkedAt: new Date().toISOString(),
    },
    actor: 'runtime',
  })

  return { childGraph, childGraphId }
}

/**
 * Detect if the current process is a subagent by checking env vars.
 * Returns the parent graph ID if detected, null otherwise.
 */
export function detectParentGraph(): string | null {
  return process.env['CLAUDE_PARENT_SESSION_ID'] ?? null
}
