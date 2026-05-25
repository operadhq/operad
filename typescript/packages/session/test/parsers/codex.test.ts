import { describe, it, expect } from 'vitest'
import { createRuntime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { codexParser } from '../../src/parsers/codex.js'

function makeRuntime() {
  const storage = new MemoryAdapter()
  const runtime = createRuntime({ storage })
  return { storage, runtime }
}

// Synthetic Codex session fixture
const CODEX_SESSION = [
  JSON.stringify({ type: 'thread.started', thread_id: 'thread_001' }),
  JSON.stringify({ type: 'turn_context', turn_context: { model: 'o4-mini' } }),
  JSON.stringify({
    type: 'event_msg',
    event_msg: { type: 'user_message', message: 'Add a login page' },
  }),
  JSON.stringify({
    type: 'item.started',
    item: { id: 'item_001', type: 'exec', command: 'ls src/' },
  }),
  JSON.stringify({
    type: 'item.completed',
    item: { id: 'item_001', type: 'exec', status: 'completed', output: 'app.ts\nlogin.ts' },
  }),
  JSON.stringify({
    type: 'item.started',
    item: { id: 'item_002', filename: 'src/login.ts', content: 'export function login() {}' },
  }),
  JSON.stringify({
    type: 'item.completed',
    item: { id: 'item_002', status: 'completed' },
  }),
  JSON.stringify({
    type: 'response_item',
    response_item: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'I created the login page at src/login.ts' }],
    },
  }),
  JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 5000, cached_input_tokens: 2000, output_tokens: 1500, reasoning_output_tokens: 300 },
  }),
].join('\n')

describe('codexParser', () => {
  it('parses goals from user messages', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-codex'
    await runtime.createGraph(graphId)

    const stats = await codexParser.parseAndEmit(CODEX_SESSION, graphId, runtime)
    expect(stats.goalsFound).toBe(1)

    const events = await storage.queryEvents(graphId, {})
    const goals = events.filter((e) => e.type === 'goal.set')
    expect(goals).toHaveLength(1)
    expect(goals[0].payload.text).toBe('Add a login page')
  })

  it('parses tool calls from items', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-codex'
    await runtime.createGraph(graphId)

    const stats = await codexParser.parseAndEmit(CODEX_SESSION, graphId, runtime)
    expect(stats.toolCalls).toBe(2) // exec + file write

    const events = await storage.queryEvents(graphId, {})
    const tools = events.filter((e) => e.type === 'custom.tool_called')
    expect(tools).toHaveLength(2)
    expect(tools[0].payload.tool).toBe('Bash')
    expect(tools[0].payload.input).toEqual({ command: 'ls src/' })
    expect(tools[1].payload.tool).toBe('Write')
  })

  it('parses tool completions', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-codex'
    await runtime.createGraph(graphId)

    await codexParser.parseAndEmit(CODEX_SESSION, graphId, runtime)

    const events = await storage.queryEvents(graphId, {})
    const completions = events.filter((e) => e.type === 'custom.tool_completed')
    expect(completions).toHaveLength(2)
    expect(completions[0].payload.output).toContain('app.ts')
  })

  it('parses assistant responses', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-codex'
    await runtime.createGraph(graphId)

    await codexParser.parseAndEmit(CODEX_SESSION, graphId, runtime)

    const events = await storage.queryEvents(graphId, {})
    const responses = events.filter((e) => e.type === 'custom.assistant_responded')
    expect(responses).toHaveLength(1)
    expect(responses[0].payload.preview).toContain('login page')
  })

  it('parses blame with cost calculation', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-codex'
    await runtime.createGraph(graphId)

    await codexParser.parseAndEmit(CODEX_SESSION, graphId, runtime)

    const events = await storage.queryEvents(graphId, {})
    const blame = events.filter((e) => e.type === 'custom.blame_recorded')
    expect(blame).toHaveLength(1)
    expect(blame[0].payload.model).toBe('o4-mini')
    expect(blame[0].payload.input_tokens).toBe(5000)
    expect(blame[0].payload.cost).toBeGreaterThan(0)
  })

  it('tracks reasoning tokens', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-codex'
    await runtime.createGraph(graphId)

    await codexParser.parseAndEmit(CODEX_SESSION, graphId, runtime)

    const events = await storage.queryEvents(graphId, {})
    const reasoning = events.filter((e) => e.type === 'custom.reasoning_trace')
    expect(reasoning).toHaveLength(1)
    expect(reasoning[0].payload.preview).toContain('300 reasoning tokens')
  })

  it('returns correct overall stats', async () => {
    const { runtime } = makeRuntime()
    const graphId = 'test-codex'
    await runtime.createGraph(graphId)

    const stats = await codexParser.parseAndEmit(CODEX_SESSION, graphId, runtime)
    expect(stats.linesRead).toBe(9)
    expect(stats.goalsFound).toBe(1)
    expect(stats.toolCalls).toBe(2)
    expect(stats.eventsEmitted).toBeGreaterThan(5)
  })
})
