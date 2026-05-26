/**
 * Full pipeline integration test:
 * Real JSONL → commit → explore branches → revert → diff
 *
 * Demonstrates the complete "git for agent cognition" flow:
 * 1. Import a session (commit)
 * 2. Branch from a decision point (explore alternatives)
 * 3. Revert a bad path
 * 4. Diff two approaches
 */
import { describe, it, expect } from 'vitest'
import { createRuntime, type GraphAPI } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { commit } from '../src/session.js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Real JSONL session path (Claude Code session from this project)
const REAL_SESSION = resolve(
  process.env.HOME ?? '~',
  '.claude/projects/-Users-charlesjavelona-projects-sozo/0052122c-3387-4da5-a523-d336dc802bbf.jsonl'
)

// Synthetic session for CI (doesn't depend on local files)
function makeSyntheticSession(): string {
  const lines = [
    { uuid: 'u1', timestamp: '2025-01-01T00:00:00Z', type: 'user', sessionId: 'pipeline-test', message: { role: 'user', content: 'Implement authentication' } },
    { uuid: 'a1', parentUuid: 'u1', timestamp: '2025-01-01T00:00:01Z', type: 'assistant', sessionId: 'pipeline-test', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
      { type: 'thinking', thinking: 'I should look at the existing auth setup...' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/auth.ts' } },
    ], usage: { input_tokens: 5000, output_tokens: 200, cache_read_input_tokens: 2000 } } },
    { uuid: 'a2', parentUuid: 'a1', timestamp: '2025-01-01T00:00:02Z', type: 'assistant', sessionId: 'pipeline-test', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
      { type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: '/src/middleware.ts' } },
    ], usage: { input_tokens: 6000, output_tokens: 100 } } },
    { uuid: 'a3', parentUuid: 'a2', timestamp: '2025-01-01T00:00:03Z', type: 'assistant', sessionId: 'pipeline-test', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
      { type: 'tool_use', id: 'tu3', name: 'Edit', input: { file_path: '/src/auth.ts', old_string: 'const auth = {}', new_string: 'const auth = { jwt: true }' } },
    ], usage: { input_tokens: 7000, output_tokens: 300 } } },
    { uuid: 'u2', timestamp: '2025-01-01T00:00:04Z', type: 'user', sessionId: 'pipeline-test', message: { role: 'user', content: 'Actually use OAuth instead of JWT' } },
    { uuid: 'a4', parentUuid: 'u2', timestamp: '2025-01-01T00:00:05Z', type: 'assistant', sessionId: 'pipeline-test', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
      { type: 'tool_use', id: 'tu4', name: 'Edit', input: { file_path: '/src/auth.ts', old_string: 'const auth = { jwt: true }', new_string: 'const auth = { oauth: true, provider: "google" }' } },
    ], usage: { input_tokens: 8000, output_tokens: 400 } } },
    { uuid: 'a5', parentUuid: 'a4', timestamp: '2025-01-01T00:00:06Z', type: 'assistant', sessionId: 'pipeline-test', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
      { type: 'tool_use', id: 'tu5', name: 'Bash', input: { command: 'vitest run src/auth.test.ts' } },
    ], usage: { input_tokens: 4000, output_tokens: 50 } } },
  ]
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

describe('full pipeline: commit → explore → revert → diff', () => {
  it('commits a session then explores two alternative approaches', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })

    // ─── Step 1: Commit the session ────────────────────────────────
    const graphId = 'pipeline'
    await runtime.createGraph(graphId)
    const log = await commit(makeSyntheticSession(), { storage, runtime, graphId })

    expect(log.goals).toBe(2)
    expect(log.toolCalls).toBe(5)
    expect(log.blame.totalCost).toBeGreaterThan(0)

    // ─── Step 2: Find the decision point (second user message) ─────
    const events = await storage.queryEvents(graphId, {})
    const goalEvents = events.filter((e) => e.type === 'goal.set')
    expect(goalEvents).toHaveLength(2)

    // The first goal ("Implement authentication") is our branch point
    const branchPoint = goalEvents[0]

    // ─── Step 3: Explore two approaches from that point ────────────
    const result = await runtime.explore(graphId, {
      atEvent: branchPoint.id,
      branches: 2,
      label: 'auth-strategy',
      worker: async (graph: GraphAPI, branchId: string) => {
        // Branch 0: JWT approach (fast, simple)
        // Branch 1: OAuth approach (complex, more secure)
        const isOAuth = branchId.includes('_1_')
        const approach = isOAuth ? 'oauth' : 'jwt'
        const complexity = isOAuth ? 8 : 3
        const security = isOAuth ? 9 : 5

        await graph.addObject({
          type: 'approach',
          data: { strategy: approach, complexity, security },
        })

        return { approach, score: security - complexity * 0.5 }
      },
      scorer: (result) => (result as { score: number }).score,
    })

    expect(result.branches).toHaveLength(2)
    expect(result.winnerId).toBeDefined()
    expect(result.winnerGraph).toBeDefined()

    // The winner should be the one with higher score
    const scores = result.branches.map((b) => b.score)
    expect(result.winnerScore).toBe(Math.max(...scores))
  })

  it('reverts a bad decision and keeps the audit trail', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graphId = 'revert-test'
    await runtime.createGraph(graphId)

    // Commit the session
    await commit(makeSyntheticSession(), { storage, runtime, graphId })

    const events = await storage.queryEvents(graphId, {})
    const goalEvents = events.filter((e) => e.type === 'goal.set')

    // Revert back to first goal (undo everything the "OAuth" pivot caused)
    const revertResult = await runtime.revert(graphId, {
      toEvent: goalEvents[0].id,
      actor: 'developer',
    })

    expect(revertResult.eventsReverted).toBeGreaterThan(0)
    expect(revertResult.compensatingEvents.length).toBe(revertResult.eventsReverted)

    // The event log should STILL contain original events + compensating events
    const allEvents = await storage.queryEvents(graphId, {})
    expect(allEvents.length).toBeGreaterThan(events.length)

    // There should be a summary event
    const revertSummary = allEvents.find((e) => e.type === 'custom.reverted')
    expect(revertSummary).toBeDefined()
    expect(revertSummary!.payload.toEvent).toBe(goalEvents[0].id)
  })

  it('diffs two session imports to show what changed', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })

    // Import session 1
    const g1 = 'session-a'
    await runtime.createGraph(g1)
    await commit(makeSyntheticSession(), { storage, runtime, graphId: g1 })

    // Branch from the first event to create a divergent session
    const events = await storage.queryEvents(g1, {})
    const firstGoal = events.find((e) => e.type === 'goal.set')!

    const branchedGraph = await runtime.branch(g1, {
      atEvent: firstGoal.id,
      branchId: 'session-b',
    })

    // Add different work on the branch
    await branchedGraph.addObject({ type: 'goal', data: { text: 'Different approach' } })
    await branchedGraph.addObject({ type: 'file', data: { path: '/src/new-auth.ts' } })

    // Diff the two sessions
    const diff = await runtime.diff(g1, 'session-b')

    expect(diff.sourceGraphId).toBe(g1)
    expect(diff.targetGraphId).toBe('session-b')
    // The branch should have objects that the source doesn't
    expect(diff.objects.length).toBeGreaterThan(0)
  })
})

// Optional: test against real JSONL if available locally
describe.skipIf(!existsSync(REAL_SESSION))('real JSONL pipeline', () => {
  it('imports a real Claude Code session and runs full pipeline', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graphId = 'real-session'
    await runtime.createGraph(graphId)

    const jsonlText = readFileSync(REAL_SESSION, 'utf-8')
    const log = await commit(jsonlText, { storage, runtime, graphId })

    // Basic assertions on real data
    expect(log.goals).toBeGreaterThan(0)
    expect(log.toolCalls).toBeGreaterThan(0)
    expect(log.blame.totalCost).toBeGreaterThan(0)

    // Find a midpoint goal and explore from it
    const events = await storage.queryEvents(graphId, {})
    const goals = events.filter((e) => e.type === 'goal.set')

    if (goals.length >= 3) {
      const midpoint = goals[Math.floor(goals.length / 2)]

      // Revert from midpoint
      const revertResult = await runtime.revert(graphId, { toEvent: midpoint.id })
      expect(revertResult.eventsReverted).toBeGreaterThan(0)

      console.log(`
Real session pipeline:
  Session:  ${log.sessionId.slice(0, 8)}
  Goals:    ${log.goals}
  Tools:    ${log.toolCalls}
  Cost:     $${log.blame.totalCost.toFixed(2)}
  Saved:    $${log.blame.cacheSavings.toFixed(2)} (cache)
  Stash:    ${log.stash.redundantReads} redundant reads
  Reverted: ${revertResult.eventsReverted} events from midpoint
`)
    }
  })
})
