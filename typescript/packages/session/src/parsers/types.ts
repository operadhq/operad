/**
 * Shared interface for all harness parsers.
 *
 * Each parser maps a specific agent's session format into
 * canonical Operad events — same graph shape regardless of source.
 */
import type { Runtime } from '@operad/core'
import type { ParseStats } from '../parser.js'

export type HarnessName = 'claude' | 'codex' | 'opencode'

export interface HarnessParser {
  name: HarnessName
  /** Parse raw text/data and emit events into the graph */
  parseAndEmit(input: string, graphId: string, runtime: Runtime): Promise<ParseStats>
}
