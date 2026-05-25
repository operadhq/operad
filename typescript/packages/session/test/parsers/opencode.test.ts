import { describe, it, expect } from 'vitest'
import { createRuntime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { opencodeParser } from '../../src/parsers/opencode.js'

function makeRuntime() {
  const storage = new MemoryAdapter()
  const runtime = createRuntime({ storage })
  return { storage, runtime }
}

// Synthetic OpenCode session fixture (newline-delimited JSON)
const OPENCODE_SESSION = [
  JSON.stringify({
    id: '01HYX001',
    type: 'user',
    created_at: '2025-05-01T10:00:00Z',
    parts: [{ type: 'text', content: 'Refactor the auth module' }],
  }),
  JSON.stringify({
    id: '01HYX002',
    type: 'assistant',
    created_at: '2025-05-01T10:00:05Z',
    model_id: 'claude-sonnet-4-20250514',
    provider_id: 'anthropic',
    cost: 0.045,
    tokens: { input: 8000, output: 2000, reasoning: 500, cache_read: 3000 },
    parts: [
      { type: 'reasoning', content: 'I need to understand the current auth structure first.' },
      { type: 'file', path: 'src/auth/index.ts', source: 'export function authenticate() {}' },
      { type: 'text', content: 'Let me refactor the auth module. I will split it into separate files.' },
      { type: 'tool', name: 'bash', input: { command: 'ls src/auth/' }, result: 'index.ts\nmiddleware.ts' },
      { type: 'patch', path: 'src/auth/index.ts', diff: '- export function authenticate() {}\n+ export { authenticate } from "./handler.js"' },
    ],
  }),
  JSON.stringify({
    id: '01HYX003',
    type: 'assistant',
    created_at: '2025-05-01T10:00:15Z',
    model_id: 'claude-sonnet-4-20250514',
    provider_id: 'anthropic',
    cost: 0.032,
    tokens: { input: 6000, output: 1500 },
    parts: [
      { type: 'text', content: 'Done! The auth module is now split into handler.ts and middleware.ts.' },
    ],
  }),
].join('\n')

describe('opencodeParser', () => {
  it('parses goals from user messages', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-opencode'
    await runtime.createGraph(graphId)

    const stats = await opencodeParser.parseAndEmit(OPENCODE_SESSION, graphId, runtime)
    expect(stats.goalsFound).toBe(1)

    const events = await storage.queryEvents(graphId, {})
    const goals = events.filter((e) => e.type === 'goal.set')
    expect(goals).toHaveLength(1)
    expect(goals[0].payload.text).toBe('Refactor the auth module')
  })

  it('parses tool calls from parts', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-opencode'
    await runtime.createGraph(graphId)

    const stats = await opencodeParser.parseAndEmit(OPENCODE_SESSION, graphId, runtime)
    // tool (bash) + file (Read) + patch (Edit) = 3
    expect(stats.toolCalls).toBe(3)

    const events = await storage.queryEvents(graphId, {})
    const tools = events.filter((e) => e.type === 'custom.tool_called')
    expect(tools).toHaveLength(3)

    const toolNames = tools.map((t) => t.payload.tool)
    expect(toolNames).toContain('bash')
    expect(toolNames).toContain('Read')
    expect(toolNames).toContain('Edit')
  })

  it('parses tool results when present', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-opencode'
    await runtime.createGraph(graphId)

    await opencodeParser.parseAndEmit(OPENCODE_SESSION, graphId, runtime)

    const events = await storage.queryEvents(graphId, {})
    const completions = events.filter((e) => e.type === 'custom.tool_completed')
    expect(completions).toHaveLength(1) // only the bash tool has a result
    expect(completions[0].payload.output).toContain('index.ts')
  })

  it('parses reasoning traces', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-opencode'
    await runtime.createGraph(graphId)

    await opencodeParser.parseAndEmit(OPENCODE_SESSION, graphId, runtime)

    const events = await storage.queryEvents(graphId, {})
    const reasoning = events.filter((e) => e.type === 'custom.reasoning_trace')
    expect(reasoning).toHaveLength(1)
    expect(reasoning[0].payload.preview).toContain('auth structure')
  })

  it('parses assistant text responses', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-opencode'
    await runtime.createGraph(graphId)

    await opencodeParser.parseAndEmit(OPENCODE_SESSION, graphId, runtime)

    const events = await storage.queryEvents(graphId, {})
    const responses = events.filter((e) => e.type === 'custom.assistant_responded')
    expect(responses).toHaveLength(2) // one per assistant message with text
  })

  it('parses blame with cost from message', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-opencode'
    await runtime.createGraph(graphId)

    await opencodeParser.parseAndEmit(OPENCODE_SESSION, graphId, runtime)

    const events = await storage.queryEvents(graphId, {})
    const blame = events.filter((e) => e.type === 'custom.blame_recorded')
    expect(blame).toHaveLength(2) // one per assistant message
    expect(blame[0].payload.cost).toBe(0.045)
    expect(blame[0].payload.model).toBe('claude-sonnet-4-20250514')
    expect(blame[0].payload.input_tokens).toBe(8000)
  })

  it('handles JSON array input format', async () => {
    const { storage, runtime } = makeRuntime()
    const graphId = 'test-opencode-array'
    await runtime.createGraph(graphId)

    const arrayInput = JSON.stringify([
      { id: '01A', type: 'user', parts: [{ type: 'text', content: 'hello' }] },
      { id: '01B', type: 'assistant', parts: [{ type: 'text', content: 'hi there' }] },
    ])

    const stats = await opencodeParser.parseAndEmit(arrayInput, graphId, runtime)
    expect(stats.goalsFound).toBe(1)
    expect(stats.eventsEmitted).toBe(2)
  })

  it('returns correct overall stats', async () => {
    const { runtime } = makeRuntime()
    const graphId = 'test-opencode'
    await runtime.createGraph(graphId)

    const stats = await opencodeParser.parseAndEmit(OPENCODE_SESSION, graphId, runtime)
    expect(stats.linesRead).toBe(3)
    expect(stats.goalsFound).toBe(1)
    expect(stats.toolCalls).toBe(3)
    expect(stats.eventsEmitted).toBeGreaterThan(5)
  })
})
