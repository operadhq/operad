import { describe, it, expect } from 'vitest'
import { createRuntime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { parseAndEmit } from '../src/parser.js'

function makeJSONL(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

describe('parser', () => {
  it('emits goal.set for user messages', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('test')

    const jsonl = makeJSONL([
      {
        uuid: 'u1',
        timestamp: '2025-01-01T00:00:00Z',
        type: 'user',
        sessionId: 'sess1',
        message: { role: 'user', content: 'Fix the login bug' },
      },
    ])

    const stats = await parseAndEmit(jsonl, 'test', runtime)

    expect(stats.goalsFound).toBe(1)
    expect(stats.eventsEmitted).toBe(1)

    const events = await storage.queryEvents('test', {})
    // graph.created + goal.set
    expect(events).toHaveLength(2)
    expect(events[1].type).toBe('goal.set')
    expect(events[1].payload.text).toBe('Fix the login bug')
  })

  it('emits custom.tool_called for tool_use blocks', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('test')

    const jsonl = makeJSONL([
      {
        uuid: 'a1',
        timestamp: '2025-01-01T00:00:01Z',
        type: 'assistant',
        sessionId: 'sess1',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/app.ts' } },
          ],
        },
      },
    ])

    const stats = await parseAndEmit(jsonl, 'test', runtime)

    expect(stats.toolCalls).toBe(1)
    const events = await storage.queryEvents('test', {})
    const toolEvent = events.find((e) => e.type === 'custom.tool_called')
    expect(toolEvent).toBeDefined()
    expect(toolEvent!.payload.tool).toBe('Read')
  })

  it('emits custom.reasoning_trace for thinking blocks', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('test')

    const jsonl = makeJSONL([
      {
        uuid: 'a2',
        timestamp: '2025-01-01T00:00:01Z',
        type: 'assistant',
        sessionId: 'sess1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I should check the auth module first...' },
          ],
        },
      },
    ])

    const stats = await parseAndEmit(jsonl, 'test', runtime)
    expect(stats.eventsEmitted).toBe(1)

    const events = await storage.queryEvents('test', {})
    const thinkEvent = events.find((e) => e.type === 'custom.reasoning_trace')
    expect(thinkEvent).toBeDefined()
    expect(thinkEvent!.payload.preview).toContain('auth module')
  })

  it('skips progress lines', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('test')

    const jsonl = makeJSONL([
      {
        uuid: 'p1',
        timestamp: '2025-01-01T00:00:00Z',
        type: 'progress',
        sessionId: 'sess1',
        message: { role: 'system', content: 'Running hook...' },
      },
    ])

    const stats = await parseAndEmit(jsonl, 'test', runtime)
    expect(stats.eventsEmitted).toBe(0)
  })

  it('emits blame_recorded for usage data', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('test')

    const jsonl = makeJSONL([
      {
        uuid: 'a3',
        timestamp: '2025-01-01T00:00:01Z',
        type: 'assistant',
        sessionId: 'sess1',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Done!' }],
          usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500 },
        },
      },
    ])

    const stats = await parseAndEmit(jsonl, 'test', runtime)

    const events = await storage.queryEvents('test', {})
    const blameEvent = events.find((e) => e.type === 'custom.blame_recorded')
    expect(blameEvent).toBeDefined()
    expect(blameEvent!.payload.model).toBe('claude-sonnet-4-20250514')
  })
})
