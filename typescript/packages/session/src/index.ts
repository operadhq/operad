/**
 * @operad/session — Commit agent sessions into Operad's event graph.
 *
 * Git vocabulary:
 * - commit()     — parse JSONL → emit events → project graph
 * - blame        — cost attribution per goal/message
 * - stash        — wasted work (redundant reads, re-spent tokens)
 * - log          — the SessionLog summary
 *
 * The graph inherits core's git-like primitives:
 * - branch()     — fork a session graph at any point
 * - checkout()   — time-travel to a specific event
 * - diff()       — compare two session graphs
 */

// Main API
export { commit, type CommitOptions } from './session.js'

// Re-export for append mode (so users don't need extra imports)
export { createRuntime } from '@operad/core'
export { MemoryAdapter } from '@operad/adapter-memory'

// Visualization
export { renderHtmlGraph, type RenderHtmlOptions } from './render-html.js'

// Subsystems (for advanced usage)
export { parseAndEmit, type ParseStats } from './parser.js'
export { computeMessageCost, aggregateBlame } from './cost.js'
export { detectStash } from './waste.js'
export { projectGraph, type ProjectionStats } from './projector.js'

// Multi-harness parsers
export { parseWithHarness, detectHarness } from './parsers/index.js'
export type { HarnessName, HarnessParser } from './parsers/index.js'
export { claudeParser } from './parsers/index.js'
export { codexParser } from './parsers/index.js'
export { opencodeParser } from './parsers/index.js'

// Query API (for checking file state from the graph)
export { queryFileState, queryToolHistory, queryGoals } from './query.js'
export type { FileState, ToolHistoryEntry } from './query.js'

// Subagent graph sharing
export { forkForSubagent, detectParentGraph } from './subagent.js'
export type { ForkResult } from './subagent.js'

// Types
export type {
  JSONLLine,
  JSONLMessage,
  ContentBlock,
  TokenUsage,
  LineType,
  BlockType,
  Blame,
  Stash,
  SessionLog,
} from './types.js'
