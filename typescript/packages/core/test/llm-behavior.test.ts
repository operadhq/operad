import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRuntime } from '../src/index.js'
import { llmBehavior } from '../src/llm-behavior.js'
import type { Runtime, GraphAPI, LLMProvider } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

function mockProvider(response = 'Mock LLM response'): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  return {
    complete: vi.fn().mockResolvedValue({
      text: response,
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  }
}

describe('LLM Behaviors', () => {
  let storage: MemoryAdapter
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('test')
  })

  it('should call the LLM provider with correct args', async () => {
    const provider = mockProvider()

    runtime.registerBehavior(
      llmBehavior(
        {
          name: 'summarizer',
          on: ['custom.summarize'],
          model: 'claude-sonnet-4-20250514',
          prompt: 'Summarize the claim',
        },
        provider
      )
    )

    await runtime.emit('test', {
      type: 'custom.summarize',
      payload: {},
    })

    expect(provider.complete).toHaveBeenCalledOnce()
    expect(provider.complete).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Summarize the claim',
      tools: undefined,
    })
  })

  it('should emit llm.requested and llm.responded events', async () => {
    const provider = mockProvider('Analysis complete')

    runtime.registerBehavior(
      llmBehavior(
        {
          name: 'analyzer',
          on: ['custom.analyze'],
          model: 'gpt-4',
          prompt: 'Analyze this',
        },
        provider
      )
    )

    await runtime.emit('test', {
      type: 'custom.analyze',
      payload: {},
    })

    const requested = await storage.queryEvents('test', { type: 'llm.requested' })
    expect(requested).toHaveLength(1)
    expect(requested[0].payload.model).toBe('gpt-4')
    expect(requested[0].payload.behaviorName).toBe('analyzer')

    const responded = await storage.queryEvents('test', { type: 'llm.responded' })
    expect(responded).toHaveLength(1)
    expect(responded[0].payload.text).toBe('Analysis complete')
    expect(responded[0].payload.cached).toBe(false)
    expect(responded[0].payload.inputTokens).toBe(100)
  })

  it('should cache responses by prompt hash', async () => {
    const provider = mockProvider('Cached result')

    runtime.registerBehavior(
      llmBehavior(
        {
          name: 'cached-behavior',
          on: ['custom.trigger'],
          model: 'gpt-4',
          prompt: 'Same prompt every time',
        },
        provider
      )
    )

    // First call
    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    // Second call — should use cache
    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    // Provider should only be called once
    expect(provider.complete).toHaveBeenCalledOnce()

    // But llm.responded should be emitted twice (once cached)
    const responded = await storage.queryEvents('test', { type: 'llm.responded' })
    expect(responded).toHaveLength(2)

    // Second response should be marked as cached
    expect(responded[1].payload.cached).toBe(true)
  })

  it('should support dynamic prompt function', async () => {
    const provider = mockProvider()

    runtime.registerBehavior(
      llmBehavior(
        {
          name: 'dynamic-prompt',
          on: ['custom.process'],
          model: 'gpt-4',
          prompt: (event) => `Process: ${event.payload.task}`,
        },
        provider
      )
    )

    await runtime.emit('test', {
      type: 'custom.process',
      payload: { task: 'review_claim' },
    })

    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Process: review_claim',
      })
    )
  })

  it('should call onResponse callback with the LLM text', async () => {
    const provider = mockProvider('Important finding')
    const onResponse = vi.fn()

    runtime.registerBehavior(
      llmBehavior(
        {
          name: 'with-callback',
          on: ['custom.trigger'],
          model: 'gpt-4',
          prompt: 'Analyze',
          onResponse,
        },
        provider
      )
    )

    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    expect(onResponse).toHaveBeenCalledOnce()
    expect(onResponse).toHaveBeenCalledWith(
      'Important finding',
      expect.objectContaining({ type: 'custom.trigger' }),
      expect.anything(), // graph
      expect.objectContaining({ graphId: 'test' }) // ctx
    )
  })

  it('should pass tools to provider when specified', async () => {
    const provider = mockProvider()
    const tools = [{ name: 'search', description: 'Search the web' }]

    runtime.registerBehavior(
      llmBehavior(
        {
          name: 'with-tools',
          on: ['custom.trigger'],
          model: 'gpt-4',
          prompt: 'Use tools',
          tools,
        },
        provider
      )
    )

    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({ tools })
    )
  })
})
