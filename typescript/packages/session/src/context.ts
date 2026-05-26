/**
 * Context extraction for fork --run.
 *
 * Scans the parent graph's events up to the fork point and builds a
 * compact system prompt that gives Claude the context it needs to
 * continue work on the forked branch with a new instruction.
 */
import type { GraphEvent } from '@operad/core'

export interface ForkContext {
  /** System prompt summarizing the session state at the fork point */
  systemPrompt: string
  /** Working directory inferred from file paths, or null */
  workingDir: string | null
}

/**
 * Extract context from a graph's events up to (and including) a fork point.
 *
 * Builds a ~500-token system prompt capturing:
 * - Goals set during the session
 * - Files read/written
 * - Decisions made (and their alternatives)
 *
 * TODO(human): Implement the context extraction logic
 */
export function extractForkContext(
  events: GraphEvent[],
  forkEventId: string,
): ForkContext {
  // Slice events up to the fork point
  const forkIdx = events.findIndex((e) => e.id === forkEventId)
  const relevant = forkIdx >= 0 ? events.slice(0, forkIdx + 1) : events

  // Collect goals
  const goals: string[] = []
  // Collect files (read vs written)
  const filesRead = new Set<string>()
  const filesWritten = new Set<string>()
  // Collect decisions
  const decisions: Array<{ selected: string; alternatives: string[] }> = []
  // Track working directory candidates
  const dirCandidates: string[] = []

  for (const evt of relevant) {
    const payload = evt.payload as Record<string, unknown>

    if (evt.type === 'goal.set') {
      const goal = payload.goal as string
      if (goal) goals.push(goal)
    }

    if (evt.type === 'custom.tool_called') {
      const tool = payload.tool as string
      const input = payload.input as Record<string, unknown> | undefined
      const filePath = input?.file_path as string | undefined

      if (filePath) {
        dirCandidates.push(filePath)
        if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') {
          filesRead.add(filePath)
        }
        if (tool === 'Write' || tool === 'Edit') {
          filesWritten.add(filePath)
          // Written files were also read (implicitly)
          filesRead.delete(filePath)
        }
      }
    }

    if (evt.type === 'decision.recorded') {
      const selected = payload.action as string
      const alternatives = (payload.alternatives as Array<{ action: string }>) ?? []
      if (selected) {
        decisions.push({
          selected,
          alternatives: alternatives.map((a) => a.action),
        })
      }
    }
  }

  // Infer working directory from file paths (longest common prefix)
  const workingDir = inferWorkingDir(dirCandidates)

  // Build system prompt
  const lines: string[] = [
    'You are continuing a coding session forked at a decision point.',
    'The user wants you to try a DIFFERENT approach from what was originally chosen.',
    '',
  ]

  if (goals.length > 0) {
    lines.push('Previous goals:')
    for (const g of goals) {
      lines.push(`  - "${g}"`)
    }
    lines.push('')
  }

  if (filesRead.size > 0 || filesWritten.size > 0) {
    lines.push('Files already in context:')
    for (const f of filesRead) {
      lines.push(`  - ${f} (read)`)
    }
    for (const f of filesWritten) {
      lines.push(`  - ${f} (read, edited)`)
    }
    lines.push('')
  }

  if (decisions.length > 0) {
    lines.push('Decisions that were made (try a DIFFERENT approach):')
    for (const d of decisions) {
      lines.push(`  - Selected: "${d.selected}"`)
      if (d.alternatives.length > 0) {
        lines.push(`    Alternatives: ${d.alternatives.join(', ')}`)
      }
    }
    lines.push('')
  }

  return {
    systemPrompt: lines.join('\n'),
    workingDir,
  }
}

/**
 * Infer the working directory from file paths by finding the longest
 * common directory prefix.
 */
function inferWorkingDir(paths: string[]): string | null {
  const absPaths = paths.filter((p) => p.startsWith('/'))
  if (absPaths.length === 0) return null

  const dirs = absPaths.map((p) => {
    const parts = p.split('/')
    return parts.slice(0, -1).join('/')
  })

  let common = dirs[0]
  for (let i = 1; i < dirs.length; i++) {
    while (!dirs[i].startsWith(common)) {
      const lastSlash = common.lastIndexOf('/')
      if (lastSlash <= 0) return null
      common = common.slice(0, lastSlash)
    }
  }

  return common || null
}
