/**
 * Multi-harness parser registry.
 *
 * Auto-detects which coding agent produced a session file,
 * then dispatches to the correct parser.
 */
export type { HarnessName, HarnessParser } from './types.js'
export { detectHarness } from './detect.js'
export { claudeParser } from './claude.js'
export { codexParser } from './codex.js'
export { opencodeParser } from './opencode.js'

import type { Runtime } from '@operad/core'
import type { ParseStats } from '../parser.js'
import type { HarnessName } from './types.js'
import { detectHarness } from './detect.js'
import { claudeParser } from './claude.js'
import { codexParser } from './codex.js'
import { opencodeParser } from './opencode.js'

const parsers = {
  claude: claudeParser,
  codex: codexParser,
  opencode: opencodeParser,
} as const

/**
 * Parse session data using auto-detection or a specified harness.
 */
export async function parseWithHarness(
  input: string,
  graphId: string,
  runtime: Runtime,
  harness?: HarnessName
): Promise<ParseStats & { harness: HarnessName }> {
  const detected = harness ?? detectHarness(input)
  if (!detected) {
    throw new Error(
      'Could not detect session format. Use --harness to specify: claude, codex, or opencode'
    )
  }

  const parser = parsers[detected]
  const stats = await parser.parseAndEmit(input, graphId, runtime)
  return { ...stats, harness: detected }
}
