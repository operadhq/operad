import { describe, it, expect, vi } from 'vitest'
import { createRuntime } from '../src/runtime.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('revert (git revert for agents)', () => {
  it('reverts events after a given point', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graph = await runtime.createGraph('g1')

    // Build up some state
    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'step 1' } })
    const e2 = await runtime.emit('g1', { type: 'custom.tool_called', payload: { tool: 'Read', file: '/a.ts' } })
    const e3 = await runtime.emit('g1', { type: 'custom.tool_called', payload: { tool: 'Edit', file: '/a.ts' } })

    // Revert back to e1 (undo e2 and e3)
    const result = await runtime.revert('g1', { toEvent: e1.id })

    expect(result.eventsReverted).toBe(2)
    expect(result.compensatingEvents).toHaveLength(2)
    // Compensating events are in reverse order (e3 first, then e2)
    expect(result.compensatingEvents[0].payload.originalEventId).toBe(e3.id)
    expect(result.compensatingEvents[1].payload.originalEventId).toBe(e2.id)
  })

  it('calls registered reversal handlers when reverseEffects is true', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const reverseEdit = vi.fn()
    runtime.registerReversal('custom.tool_called', reverseEdit)

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'start' } })
    await runtime.emit('g1', { type: 'custom.tool_called', payload: { tool: 'Edit', file: '/x.ts' } })

    await runtime.revert('g1', { toEvent: e1.id, reverseEffects: true })

    expect(reverseEdit).toHaveBeenCalledOnce()
    expect(reverseEdit.mock.calls[0][0].payload.tool).toBe('Edit')
  })

  it('tracks unreversible events (no handler registered)', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'start' } })
    await runtime.emit('g1', { type: 'custom.tool_called', payload: { tool: 'Bash', command: 'rm -rf /' } })

    const result = await runtime.revert('g1', { toEvent: e1.id, reverseEffects: true })

    expect(result.unreversible).toHaveLength(1)
    expect(result.unreversible[0].payload.tool).toBe('Bash')
  })

  it('emits a summary custom.reverted event', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'start' } })
    await runtime.emit('g1', { type: 'custom.tool_called', payload: { tool: 'Read' } })

    await runtime.revert('g1', { toEvent: e1.id })

    const allEvents = await storage.queryEvents('g1', {})
    const revertSummary = allEvents.find((e) => e.type === 'custom.reverted')
    expect(revertSummary).toBeDefined()
    expect(revertSummary!.payload.eventsReverted).toBe(1)
  })
})

describe('explore (parallel branch exploration)', () => {
  it('forks N branches and picks the highest scorer', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'find best approach' } })

    const result = await runtime.explore('g1', {
      atEvent: e1.id,
      branches: 3,
      worker: async (graph, branchId) => {
        // Simulate work — each branch produces a different "quality" result
        const quality = Math.random()
        await graph.addObject({ type: 'result', data: { quality } })
        return { quality }
      },
      scorer: (result, _branchId) => {
        return (result as { quality: number }).quality
      },
    })

    expect(result.branches).toHaveLength(3)
    expect(result.winnerScore).toBe(Math.max(...result.branches.map((b) => b.score)))
    expect(result.winnerId).toBeDefined()
    expect(result.winnerGraph).toBeDefined()
  })

  it('emits custom.explored event on the original graph', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'explore' } })

    await runtime.explore('g1', {
      atEvent: e1.id,
      branches: 2,
      worker: async () => ({ score: 1 }),
      scorer: () => 1,
    })

    const events = await storage.queryEvents('g1', {})
    const explored = events.find((e) => e.type === 'custom.explored')
    expect(explored).toBeDefined()
    expect(explored!.payload.branchCount).toBe(2)
  })

  it('uses custom label for branch names', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    await runtime.createGraph('g1')

    const e1 = await runtime.emit('g1', { type: 'goal.set', payload: { text: 'test' } })

    const result = await runtime.explore('g1', {
      atEvent: e1.id,
      branches: 2,
      label: 'hypothesis',
      worker: async () => 'done',
      scorer: () => 1,
    })

    expect(result.branches[0].branchId).toContain('hypothesis')
  })
})
