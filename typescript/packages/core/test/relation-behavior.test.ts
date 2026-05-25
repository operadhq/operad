import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRuntime } from '../src/index.js'
import { relationBehavior } from '../src/relation-behavior.js'
import type { Runtime, GraphAPI } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Relation Behaviors', () => {
  let storage: MemoryAdapter
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('test')
  })

  it('should fire handler once per matching relation', async () => {
    const handler = vi.fn()

    runtime.registerBehavior(
      relationBehavior({
        name: 'on-depends-complete',
        relationType: 'depends_on',
        on: ['object.patched'],
        handler,
      })
    )

    const task1 = await graph.addObject({ type: 'task', data: { title: 'Task 1' } })
    const task2 = await graph.addObject({ type: 'task', data: { title: 'Task 2' } })
    const task3 = await graph.addObject({ type: 'task', data: { title: 'Task 3' } })

    await graph.addRelation(task2.id, task1.id, 'depends_on')
    await graph.addRelation(task3.id, task1.id, 'depends_on')

    // Patch task1 — should fire handler twice (once per depends_on relation)
    await graph.patchObject(task1.id, { status: 'done' })

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should receive correct arguments in handler', async () => {
    const handler = vi.fn()

    runtime.registerBehavior(
      relationBehavior({
        name: 'check-args',
        relationType: 'depends_on',
        on: ['object.patched'],
        handler,
      })
    )

    const task1 = await graph.addObject({ type: 'task', data: { title: 'Source' } })
    const task2 = await graph.addObject({ type: 'task', data: { title: 'Target' } })
    await graph.addRelation(task1.id, task2.id, 'depends_on')

    await graph.patchObject(task2.id, { status: 'done' })

    expect(handler).toHaveBeenCalledOnce()
    const [relation, event, graphApi, ctx] = handler.mock.calls[0]
    expect(relation.type).toBe('depends_on')
    expect(relation.sourceId).toBe(task1.id)
    expect(relation.targetId).toBe(task2.id)
    expect(event.type).toBe('object.patched')
    expect(graphApi.id).toBe('test')
    expect(ctx.graphId).toBe('test')
    expect(typeof ctx.emit).toBe('function')
  })

  it('should not fire when no matching relations exist', async () => {
    const handler = vi.fn()

    runtime.registerBehavior(
      relationBehavior({
        name: 'no-match',
        relationType: 'depends_on',
        on: ['object.patched'],
        handler,
      })
    )

    const task = await graph.addObject({ type: 'task', data: {} })

    // Add a relation of a different type
    const other = await graph.addObject({ type: 'task', data: {} })
    await graph.addRelation(task.id, other.id, 'blocks')

    await graph.patchObject(task.id, { status: 'done' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('should support where clause filtering on the event', async () => {
    const handler = vi.fn()

    runtime.registerBehavior(
      relationBehavior({
        name: 'only-status-patches',
        relationType: 'depends_on',
        on: ['object.patched'],
        where: { 'payload.patch.status': 'done' },
        handler,
      })
    )

    const task1 = await graph.addObject({ type: 'task', data: {} })
    const task2 = await graph.addObject({ type: 'task', data: {} })
    await graph.addRelation(task1.id, task2.id, 'depends_on')

    // Patch with non-matching data — should not fire
    await graph.patchObject(task2.id, { title: 'Updated' })
    expect(handler).not.toHaveBeenCalled()

    // Patch with matching data — should fire
    await graph.patchObject(task2.id, { status: 'done' })
    expect(handler).toHaveBeenCalledOnce()
  })
})
