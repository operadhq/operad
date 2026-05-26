/**
 * Session orchestrator — the `git commit` for agent work.
 *
 * Ties together: parse → emit → blame → stash → project.
 *
 * Supports "append mode": pass an existing runtime + storage + graphId
 * to accumulate multiple sessions into one graph —
 * like successive commits on the same branch.
 */
import { createRuntime, type Runtime, type StorageAdapter, type GraphEvent } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { parseWithHarness, type HarnessName } from './parsers/index.js'
import { computeMessageCost, aggregateBlame } from './cost.js'
import { detectStash } from './waste.js'
import { projectGraph } from './projector.js'
import type { SessionLog, Blame, JSONLLine } from './types.js'

export interface CommitOptions {
  /** Existing storage adapter (needed to query events back) */
  storage?: StorageAdapter
  /** Existing runtime to append to (enables multi-session graphs) */
  runtime?: Runtime
  /** Existing graph ID to append to */
  graphId?: string
  /** Force a specific harness parser (auto-detected if omitted) */
  harness?: HarnessName
}

/**
 * Commit a JSONL session into an Operad graph.
 *
 * @param jsonlText - Raw JSONL file contents
 * @param options - Optional runtime/storage/graphId for append mode
 * @returns SessionLog with blame, stash, and graph stats
 */
export async function commit(
  jsonlText: string,
  options?: CommitOptions
): Promise<SessionLog> {
  // 1. Set up storage + runtime (or reuse existing)
  const storage = options?.storage ?? new MemoryAdapter()
  const runtime = options?.runtime ?? createRuntime({ storage })
  const graphId = options?.graphId ?? `session_${Date.now()}`

  // Create graph if new
  if (!options?.graphId) {
    await runtime.createGraph(graphId)
  }

  // 2. Parse & emit events (auto-detects harness or uses specified one)
  const stats = await parseWithHarness(jsonlText, graphId, runtime, options?.harness)

  // 3. Compute blame (cost attribution)
  const blames: Blame[] = []
  const lines = jsonlText.split('\n').filter((l) => l.trim())
  let sessionId = ''

  for (const raw of lines) {
    try {
      const line: JSONLLine = JSON.parse(raw)
      if (!sessionId && line.sessionId) sessionId = line.sessionId
      if (line.type === 'assistant' && line.message?.usage && line.message?.model) {
        blames.push(computeMessageCost(line.message.usage, line.message.model))
      }
    } catch {
      continue
    }
  }

  const blame = aggregateBlame(blames)

  // 4. Query events for stash detection + projection
  const graph = runtime.getGraph(graphId)
  const events: GraphEvent[] = await storage.queryEvents(graphId, {})

  // 5. Detect stash (wasted work)
  const stash = detectStash(events)

  // 6. Project graph objects
  await projectGraph(graph, events)

  // 7. Count files read vs edited
  const filesRead = countToolCalls(events, 'Read')
  const filesEdited = countToolCalls(events, 'Edit') + countToolCalls(events, 'Write')

  return {
    sessionId,
    graphId,
    goals: stats.goalsFound,
    toolCalls: stats.toolCalls,
    filesRead,
    filesEdited,
    blame,
    stash,
  }
}


// ─── Helpers ─────────────────────────────────────────────────────────

function countToolCalls(events: GraphEvent[], tool: string): number {
  return events.filter(
    (e) => e.type === 'custom.tool_called' && e.payload.tool === tool
  ).length
}
