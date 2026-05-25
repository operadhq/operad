import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntime } from '../src/index.js'
import { resolveView } from '../src/view.js'
import type { Runtime, GraphAPI, GraphEvent } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Views (Scoped Graph Reads)', () => {
  let storage: MemoryAdapter
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('test')
  })

  it('should return depth=1 neighbors around a focal object', async () => {
    const center = await graph.addObject({ type: 'claim', data: { title: 'Center' } })
    const neighbor1 = await graph.addObject({ type: 'evidence', data: { title: 'Ev1' } })
    const neighbor2 = await graph.addObject({ type: 'evidence', data: { title: 'Ev2' } })
    const distant = await graph.addObject({ type: 'note', data: { title: 'Far' } })

    await graph.addRelation(center.id, neighbor1.id, 'supports')
    await graph.addRelation(center.id, neighbor2.id, 'supports')
    await graph.addRelation(neighbor1.id, distant.id, 'references')

    const fakeEvent = {
      id: 'evt1', graphId: 'test', type: 'object.created' as const,
      payload: { objectId: center.id }, causedBy: null, timestamp: new Date().toISOString(),
    }

    const view = await resolveView(
      { around: 'payload.objectId', depth: 1 },
      fakeEvent,
      graph
    )

    expect(view.objects()).toHaveLength(3) // center + 2 neighbors
    expect(view.get(center.id)).toBeDefined()
    expect(view.get(neighbor1.id)).toBeDefined()
    expect(view.get(neighbor2.id)).toBeDefined()
    expect(view.get(distant.id)).toBeUndefined() // 2 hops away
  })

  it('should return depth=2 for two-hop traversal', async () => {
    const a = await graph.addObject({ type: 'node', data: { label: 'A' } })
    const b = await graph.addObject({ type: 'node', data: { label: 'B' } })
    const c = await graph.addObject({ type: 'node', data: { label: 'C' } })

    await graph.addRelation(a.id, b.id, 'link')
    await graph.addRelation(b.id, c.id, 'link')

    const fakeEvent: GraphEvent = {
      id: 'evt1', graphId: 'test', type: 'object.created',
      payload: { objectId: a.id }, causedBy: null, timestamp: new Date().toISOString(),
    }

    const view = await resolveView(
      { around: 'payload.objectId', depth: 2 },
      fakeEvent,
      graph
    )

    expect(view.objects()).toHaveLength(3) // A -> B -> C
    expect(view.get(c.id)).toBeDefined()
  })

  it('should resolve dot-path from event payload', async () => {
    const obj = await graph.addObject({ type: 'task', data: {} })

    const fakeEvent: GraphEvent = {
      id: 'evt1', graphId: 'test', type: 'custom.something',
      payload: { nested: { id: obj.id } as any }, causedBy: null, timestamp: new Date().toISOString(),
    }

    const view = await resolveView(
      { around: 'payload.nested.id', depth: 0 },
      fakeEvent,
      graph
    )

    // depth=0 means just the focal object, no traversal
    expect(view.objects()).toHaveLength(1)
    expect(view.get(obj.id)).toBeDefined()
  })

  it('should support multiple focal points', async () => {
    const a = await graph.addObject({ type: 'node', data: { label: 'A' } })
    const b = await graph.addObject({ type: 'node', data: { label: 'B' } })
    const c = await graph.addObject({ type: 'node', data: { label: 'C' } })

    await graph.addRelation(a.id, c.id, 'link')

    const fakeEvent: GraphEvent = {
      id: 'evt1', graphId: 'test', type: 'custom.multi',
      payload: { id1: a.id, id2: b.id }, causedBy: null, timestamp: new Date().toISOString(),
    }

    const view = await resolveView(
      { around: ['payload.id1', 'payload.id2'], depth: 1 },
      fakeEvent,
      graph
    )

    expect(view.objects()).toHaveLength(3) // A, B, C (C is neighbor of A)
  })

  it('should provide objectsOfType filtering', async () => {
    const claim = await graph.addObject({ type: 'claim', data: {} })
    const ev1 = await graph.addObject({ type: 'evidence', data: {} })
    const ev2 = await graph.addObject({ type: 'evidence', data: {} })

    await graph.addRelation(claim.id, ev1.id, 'supports')
    await graph.addRelation(claim.id, ev2.id, 'supports')

    const fakeEvent: GraphEvent = {
      id: 'evt1', graphId: 'test', type: 'object.created',
      payload: { objectId: claim.id }, causedBy: null, timestamp: new Date().toISOString(),
    }

    const view = await resolveView(
      { around: 'payload.objectId', depth: 1 },
      fakeEvent,
      graph
    )

    expect(view.objectsOfType('evidence')).toHaveLength(2)
    expect(view.objectsOfType('claim')).toHaveLength(1)
  })

  it('should provide neighbors for a given object', async () => {
    const center = await graph.addObject({ type: 'node', data: {} })
    const n1 = await graph.addObject({ type: 'node', data: { label: 'N1' } })
    const n2 = await graph.addObject({ type: 'node', data: { label: 'N2' } })

    await graph.addRelation(center.id, n1.id, 'link')
    await graph.addRelation(n2.id, center.id, 'link') // incoming

    const fakeEvent: GraphEvent = {
      id: 'evt1', graphId: 'test', type: 'object.created',
      payload: { objectId: center.id }, causedBy: null, timestamp: new Date().toISOString(),
    }

    const view = await resolveView(
      { around: 'payload.objectId', depth: 1 },
      fakeEvent,
      graph
    )

    const neighbors = view.neighbors(center.id)
    expect(neighbors).toHaveLength(2)
  })

  it('should include relations in the view', async () => {
    const a = await graph.addObject({ type: 'node', data: {} })
    const b = await graph.addObject({ type: 'node', data: {} })

    await graph.addRelation(a.id, b.id, 'supports')

    const fakeEvent: GraphEvent = {
      id: 'evt1', graphId: 'test', type: 'object.created',
      payload: { objectId: a.id }, causedBy: null, timestamp: new Date().toISOString(),
    }

    const view = await resolveView(
      { around: 'payload.objectId', depth: 1 },
      fakeEvent,
      graph
    )

    expect(view.relations()).toHaveLength(1)
    expect(view.relations()[0].type).toBe('supports')
  })

  it('should work with behavior integration (view on BehaviorDef)', async () => {
    let capturedView: any = null

    const { behavior } = await import('../src/index.js')
    runtime.registerBehavior(
      behavior({
        name: 'with-view',
        on: ['custom.test'],
        view: { around: 'payload.objectId', depth: 1 },
        handler: async (_event, _graph, ctx) => {
          capturedView = ctx.view
        },
      })
    )

    const obj = await graph.addObject({ type: 'node', data: {} })
    const neighbor = await graph.addObject({ type: 'node', data: {} })
    await graph.addRelation(obj.id, neighbor.id, 'link')

    await runtime.emit('test', {
      type: 'custom.test',
      payload: { objectId: obj.id },
    })

    expect(capturedView).toBeDefined()
    expect(capturedView.objects()).toHaveLength(2)
  })
})
