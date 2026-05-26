import { describe, it, expect } from 'vitest'
import { commit } from '../src/session.js'
import { MemoryAdapter } from '@operad/adapter-memory'
import { createRuntime } from '@operad/core'

function makeSession(): string {
  const lines = [
    {
      uuid: 'u1',
      timestamp: '2025-01-01T00:00:00Z',
      type: 'user',
      sessionId: 'test-session-abc',
      message: { role: 'user', content: 'Fix the login bug' },
    },
    {
      uuid: 'a1',
      parentUuid: 'u1',
      timestamp: '2025-01-01T00:00:01Z',
      type: 'assistant',
      sessionId: 'test-session-abc',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'thinking', thinking: 'I should look at the auth module...' },
          { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/auth.ts' } },
        ],
        usage: { input_tokens: 5000, output_tokens: 200, cache_read_input_tokens: 3000 },
      },
    },
    {
      uuid: 'a2',
      parentUuid: 'a1',
      timestamp: '2025-01-01T00:00:02Z',
      type: 'assistant',
      sessionId: 'test-session-abc',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: '/src/auth.ts' } },
        ],
        usage: { input_tokens: 6000, output_tokens: 100 },
      },
    },
    {
      uuid: 'a3',
      parentUuid: 'a2',
      timestamp: '2025-01-01T00:00:03Z',
      type: 'assistant',
      sessionId: 'test-session-abc',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          {
            type: 'tool_use',
            id: 'tu3',
            name: 'Edit',
            input: { file_path: '/src/auth.ts', old_string: 'bug', new_string: 'fix' },
          },
        ],
        usage: { input_tokens: 7000, output_tokens: 300 },
      },
    },
    {
      uuid: 'u2',
      timestamp: '2025-01-01T00:00:04Z',
      type: 'user',
      sessionId: 'test-session-abc',
      message: { role: 'user', content: 'Now run the tests' },
    },
    {
      uuid: 'a4',
      parentUuid: 'u2',
      timestamp: '2025-01-01T00:00:05Z',
      type: 'assistant',
      sessionId: 'test-session-abc',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'tool_use', id: 'tu4', name: 'Bash', input: { command: 'vitest run' } },
        ],
        usage: { input_tokens: 4000, output_tokens: 50 },
      },
    },
  ]
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

describe('session (end-to-end)', () => {
  it('commits a full session and returns a log', async () => {
    const log = await commit(makeSession())

    expect(log.sessionId).toBe('test-session-abc')
    expect(log.goals).toBe(2)
    expect(log.toolCalls).toBe(4) // 2 reads + 1 edit + 1 bash
    expect(log.filesRead).toBe(2)
    expect(log.filesEdited).toBe(1)
    expect(log.blame.totalCost).toBeGreaterThan(0)
    expect(log.blame.inputTokens).toBe(22000)
    expect(log.blame.cacheSavings).toBeGreaterThan(0)
  })

  it('detects redundant reads as stash', async () => {
    const log = await commit(makeSession())

    // /src/auth.ts was read twice with no edit in between the first and second
    expect(log.stash.redundantReads).toBe(1)
    expect(log.stash.tokensWasted).toBe(2000)
  })

  it('supports append mode (multi-session graphs)', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('shared')

    const log1 = await commit(makeSession(), { storage, runtime, graphId: 'shared' })
    expect(log1.graphId).toBe('shared')

    // Commit a second session into the same graph
    const session2 = JSON.stringify({
      uuid: 'u99',
      timestamp: '2025-01-02T00:00:00Z',
      type: 'user',
      sessionId: 'session-2',
      message: { role: 'user', content: 'Add dark mode' },
    })

    const log2 = await commit(session2, { storage, runtime, graphId: 'shared' })
    expect(log2.graphId).toBe('shared')
    expect(log2.goals).toBe(1)

    // The graph should have events from both sessions
    const allEvents = await storage.queryEvents('shared', {})
    expect(allEvents.length).toBeGreaterThan(5)
  })
})
