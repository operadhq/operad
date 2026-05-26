import { describe, it, expect, vi } from 'vitest'
import { createEffectRegistry } from '../src/effects.js'
import { createRuntime } from '../src/runtime.js'
import { MemoryAdapter } from '@operad/adapter-memory'
import type { GraphEvent } from '../src/types.js'

describe('EffectRegistry', () => {
  describe('categorize', () => {
    it('classifies pure tools correctly', () => {
      const registry = createEffectRegistry()
      expect(registry.categorize('Read')).toBe('pure')
      expect(registry.categorize('Grep')).toBe('pure')
      expect(registry.categorize('Glob')).toBe('pure')
      expect(registry.categorize('WebFetch')).toBe('pure')
      expect(registry.categorize('WebSearch')).toBe('pure')
    })

    it('classifies bufferable tools correctly', () => {
      const registry = createEffectRegistry()
      expect(registry.categorize('Edit')).toBe('bufferable')
      expect(registry.categorize('Write')).toBe('bufferable')
      expect(registry.categorize('NotebookEdit')).toBe('bufferable')
    })

    it('classifies externalized tools correctly', () => {
      const registry = createEffectRegistry()
      expect(registry.categorize('Bash')).toBe('externalized')
    })

    it('classifies MCP tools as externalized via prefix match', () => {
      const registry = createEffectRegistry()
      expect(registry.categorize('mcp__gmail__send')).toBe('externalized')
      expect(registry.categorize('mcp__ide__getDiagnostics')).toBe('externalized')
    })

    it('defaults unknown tools to externalized', () => {
      const registry = createEffectRegistry()
      expect(registry.categorize('SomeUnknownTool')).toBe('externalized')
    })

    it('allows registering custom tools', () => {
      const registry = createEffectRegistry()
      registry.registerEffect('MyReadOnly', 'pure')
      registry.registerEffect('MyDbWrite', 'externalized')
      expect(registry.categorize('MyReadOnly')).toBe('pure')
      expect(registry.categorize('MyDbWrite')).toBe('externalized')
    })
  })

  describe('getBufferedEffects', () => {
    it('filters events to only bufferable tool calls', () => {
      const registry = createEffectRegistry()
      const events = [
        { id: '1', payload: { tool: 'Read', file: '/a.ts' } },
        { id: '2', payload: { tool: 'Edit', file: '/a.ts' } },
        { id: '3', payload: { tool: 'Write', file: '/b.ts' } },
        { id: '4', payload: { tool: 'Bash', command: 'echo hi' } },
      ] as unknown as GraphEvent[]

      const buffered = registry.getBufferedEffects(events)
      expect(buffered).toHaveLength(2)
      expect(buffered[0].payload.tool).toBe('Edit')
      expect(buffered[1].payload.tool).toBe('Write')
    })
  })

  describe('getExternalizedEffects', () => {
    it('filters events to only externalized tool calls', () => {
      const registry = createEffectRegistry()
      const events = [
        { id: '1', payload: { tool: 'Read', file: '/a.ts' } },
        { id: '2', payload: { tool: 'Edit', file: '/a.ts' } },
        { id: '3', payload: { tool: 'Bash', command: 'rm -rf /' } },
        { id: '4', payload: { tool: 'mcp__gmail__send', to: 'x@y.com' } },
      ] as unknown as GraphEvent[]

      const externalized = registry.getExternalizedEffects(events)
      expect(externalized).toHaveLength(2)
      expect(externalized[0].payload.tool).toBe('Bash')
      expect(externalized[1].payload.tool).toBe('mcp__gmail__send')
    })
  })

  describe('reverser registration', () => {
    it('stores and retrieves reversal handlers', () => {
      const registry = createEffectRegistry()
      const handler = vi.fn()
      registry.registerEffect('Edit', 'bufferable', handler)
      expect(registry.getReverser('Edit')).toBe(handler)
    })

    it('returns undefined for tools without reversers', () => {
      const registry = createEffectRegistry()
      expect(registry.getReverser('Bash')).toBeUndefined()
    })
  })
})

describe('revert with effect categories', () => {
  it('skips pure events during reversal (nothing to undo)', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const reverseHandler = vi.fn()
    runtime.registerReversal('custom.tool_called', reverseHandler)

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'start' } })
    // Pure tool call — should NOT trigger reversal handler
    await runtime.emit('g1', {
      type: 'custom.tool_called',
      payload: { tool: 'Read', file: '/a.ts' },
    })

    const result = await runtime.revert('g1', { toEvent: e1.id, reverseEffects: true })

    // Event is reverted (compensating event emitted) but handler is NOT called for pure tools
    expect(result.eventsReverted).toBe(1)
    expect(reverseHandler).not.toHaveBeenCalled()
    expect(result.unreversible).toHaveLength(0)
  })

  it('calls handler for bufferable events during reversal', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const reverseEdit = vi.fn()
    runtime.registerReversal('custom.tool_called', reverseEdit)

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'start' } })
    await runtime.emit('g1', {
      type: 'custom.tool_called',
      payload: { tool: 'Edit', file: '/x.ts', old_string: 'a', new_string: 'b' },
    })

    await runtime.revert('g1', { toEvent: e1.id, reverseEffects: true })

    expect(reverseEdit).toHaveBeenCalledOnce()
  })

  it('flags externalized events as unreversible when no handler exists', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'start' } })
    await runtime.emit('g1', {
      type: 'custom.tool_called',
      payload: { tool: 'Bash', command: 'curl https://api.example.com/delete' },
    })

    const result = await runtime.revert('g1', { toEvent: e1.id, reverseEffects: true })

    expect(result.unreversible).toHaveLength(1)
    expect(result.unreversible[0].payload.tool).toBe('Bash')
  })
})
