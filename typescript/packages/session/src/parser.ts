/**
 * Parser — reads session logs and emits Operad events.
 *
 * This is a backward-compatible wrapper that delegates to the
 * multi-harness parser system in ./parsers/.
 *
 * For direct harness-specific access, import from './parsers/index.js'.
 */
import type { Runtime } from '@operad/core'
import { claudeParser } from './parsers/claude.js'

export interface ParseStats {
  linesRead: number
  eventsEmitted: number
  goalsFound: number
  toolCalls: number
}

/**
 * Parse raw JSONL text and emit events into an Operad graph.
 * Backward-compatible: always uses Claude parser.
 *
 * For multi-harness support, use `parseWithHarness()` from './parsers/index.js'.
 */
export async function parseAndEmit(
  jsonlText: string,
  graphId: string,
  runtime: Runtime
): Promise<ParseStats> {
  return claudeParser.parseAndEmit(jsonlText, graphId, runtime)
}
