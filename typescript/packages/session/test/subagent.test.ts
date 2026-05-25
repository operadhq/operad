import { describe, it, expect } from 'vitest'
import { MemoryAdapter } from '@operad/adapter-memory'
import { createRuntime } from '@operad/core'
import { forkForSubagent } from '../src/subagent.js'

describe('forkForSubagent', () => {
  it('copies parent events into child graph', async () => {
    const adapter = new MemoryAdapter()
    const runtime = createRuntime({ storage: adapter })

    // Set up parent graph with some events
    await runtime.createGraph('parent-session')
    await runtime.emit('parent-session', {
      type: 'goal.set',
      payload: { goal: 'Fix the login bug' },
      actor: 'user',
    })
    await runtime.emit('parent-session', {
      type: 'custom.tool_called',
      payload: { tool: 'Read', input: { file_path: '/src/auth.ts' } },
      actor: 'claude-code',
    })
    await runtime.emit('parent-session', {
      type: 'custom.tool_called',
      payload: { tool: 'Edit', input: { file_path: '/src/auth.ts' } },
      actor: 'claude-code',
    })

    // Fork into child
    const result = await forkForSubagent('parent-session', 'child-session', runtime, adapter)

    expect(result.childGraphId).toBe('child-session')
    expect(result.childGraph).toBeDefined()

    // Query events on child graph via storage adapter
    const childEvents = await adapter.queryEvents('child-session', {})

    // Should have parent events + graph_forked + subagent_forked
    const parentEvents = await adapter.queryEvents('parent-session', {})
    // Child has all parent events plus the two fork marker events
    expect(childEvents.length).toBeGreaterThanOrEqual(parentEvents.length)

    // Verify the subagent_forked event exists
    const forkEvent = childEvents.find((e) => e.type === 'custom.subagent_forked')
    expect(forkEvent).toBeDefined()
    expect(forkEvent!.payload.parentGraphId).toBe('parent-session')

    // Verify parent's tool calls are present in child
    const toolCalls = childEvents.filter((e) => e.type === 'custom.tool_called')
    expect(toolCalls.length).toBe(2)
    expect(toolCalls[0].payload.tool).toBe('Read')
    expect(toolCalls[1].payload.tool).toBe('Edit')

    // Verify goal is inherited
    const goals = childEvents.filter((e) => e.type === 'goal.set')
    expect(goals.length).toBe(1)
    expect(goals[0].payload.goal).toBe('Fix the login bug')
  })
})
