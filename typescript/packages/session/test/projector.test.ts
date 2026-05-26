import { describe, it, expect } from 'vitest'
import { createRuntime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { projectGraph } from '../src/projector.js'
import type { GraphEvent } from '@operad/core'

function makeEvent(type: string, payload: Record<string, unknown>, index: number): GraphEvent {
  return {
    id: `evt-${index}`,
    graphId: 'test',
    type: type as GraphEvent['type'],
    payload,
    actor: 'agent',
    timestamp: new Date(Date.now() + index * 1000).toISOString(),
  } as GraphEvent
}

describe('projector', () => {
  it('creates goal objects from goal.set events', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graph = await runtime.createGraph('test')

    const events = [
      makeEvent('goal.set', { text: 'Fix the login bug', uuid: 'u1' }, 0),
    ]

    const stats = await projectGraph(graph, events)
    expect(stats.goals).toBe(1)

    const objects = await graph.queryObjects({ type: 'goal' })
    expect(objects).toHaveLength(1)
    expect(objects[0].data.text).toBe('Fix the login bug')
  })

  it('creates file objects from Read tool calls', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graph = await runtime.createGraph('test')

    const events = [
      makeEvent('goal.set', { text: 'Read some files', uuid: 'u1' }, 0),
      makeEvent('custom.tool_called', { tool: 'Read', input: { file_path: '/src/app.ts' }, uuid: 'u2' }, 1),
    ]

    const stats = await projectGraph(graph, events)
    expect(stats.files).toBe(1)

    const files = await graph.queryObjects({ type: 'file' })
    expect(files[0].data.path).toBe('/src/app.ts')
  })

  it('creates patch objects from Edit tool calls', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graph = await runtime.createGraph('test')

    const events = [
      makeEvent('goal.set', { text: 'Fix bug', uuid: 'u1' }, 0),
      makeEvent('custom.tool_called', {
        tool: 'Edit',
        input: { file_path: '/src/app.ts', old_string: 'foo', new_string: 'bar' },
        uuid: 'u2',
      }, 1),
    ]

    const stats = await projectGraph(graph, events)
    expect(stats.patches).toBe(1)

    const patches = await graph.queryObjects({ type: 'patch' })
    expect(patches[0].data.file).toBe('/src/app.ts')
    expect(patches[0].data.oldString).toBe('foo')
  })

  it('detects test runs from Bash commands', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graph = await runtime.createGraph('test')

    const events = [
      makeEvent('goal.set', { text: 'Run tests', uuid: 'u1' }, 0),
      makeEvent('custom.tool_called', { tool: 'Bash', input: { command: 'vitest run' }, uuid: 'u2' }, 1),
    ]

    const stats = await projectGraph(graph, events)
    expect(stats.testRuns).toBe(1)

    const runs = await graph.queryObjects({ type: 'test_run' })
    expect(runs[0].data.command).toBe('vitest run')
  })

  it('links goals to files via triggered relation', async () => {
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graph = await runtime.createGraph('test')

    const events = [
      makeEvent('goal.set', { text: 'Explore', uuid: 'u1' }, 0),
      makeEvent('custom.tool_called', { tool: 'Read', input: { file_path: '/src/x.ts' }, uuid: 'u2' }, 1),
    ]

    const stats = await projectGraph(graph, events)
    expect(stats.relations).toBeGreaterThan(0)

    const relations = await graph.queryRelations({ type: 'triggered' })
    expect(relations).toHaveLength(1)
  })
})
