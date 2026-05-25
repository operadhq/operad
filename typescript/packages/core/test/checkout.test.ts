import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntime } from '../src/index.js'
import type { Runtime, GraphAPI } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Checkout (time-travel)', () => {
  let storage: MemoryAdapter
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('main')
  })

  it('should reconstruct graph state at a past event', async () => {
    const obj = await graph.addObject({ type: 'claim', data: { amount: 100, status: 'open' } })

    const checkpoint = await runtime.emit('main', {
      type: 'custom.checkpoint',
      payload: {},
    })

    // Mutate after checkpoint
    await graph.patchObject(obj.id, { status: 'closed' })
    await graph.addObject({ type: 'policy', data: { carrier: 'GEICO' } })

    // Current state: claim is closed, policy exists
    const currentObjects = await graph.queryObjects({})
    expect(currentObjects).toHaveLength(2)

    // Checkout at checkpoint: claim should be open, no policy
    const past = await runtime.checkout('main', checkpoint.id)
    const pastObjects = await past.queryObjects({})

    expect(pastObjects).toHaveLength(1)
    expect(pastObjects[0].type).toBe('claim')
    expect(pastObjects[0].data.status).toBe('open')
    expect(pastObjects[0].data.amount).toBe(100)
  })

  it('should handle objects created and then removed before checkpoint', async () => {
    const obj = await graph.addObject({ type: 'temp', data: { value: 'ephemeral' } })
    await graph.removeObject(obj.id)

    const checkpoint = await runtime.emit('main', {
      type: 'custom.checkpoint',
      payload: {},
    })

    // At checkpoint: temp was created then removed → should not exist
    const past = await runtime.checkout('main', checkpoint.id)
    const pastObjects = await past.queryObjects({})
    expect(pastObjects).toHaveLength(0)
  })

  it('should reconstruct patched state at the right point', async () => {
    const obj = await graph.addObject({ type: 'claim', data: { amount: 100 } })

    await graph.patchObject(obj.id, { amount: 200 })

    const midpoint = await runtime.emit('main', {
      type: 'custom.midpoint',
      payload: {},
    })

    await graph.patchObject(obj.id, { amount: 300 })

    // Current: amount is 300
    const current = await graph.queryObjects({ type: 'claim' })
    expect(current[0].data.amount).toBe(300)

    // At midpoint: amount should be 200
    const past = await runtime.checkout('main', midpoint.id)
    const pastObjects = await past.queryObjects({ type: 'claim' })
    expect(pastObjects).toHaveLength(1)
    expect(pastObjects[0].data.amount).toBe(200)
  })

  it('should reconstruct relations at a past point', async () => {
    const person = await graph.addObject({ type: 'person', data: { name: 'Alice' } })
    const claim = await graph.addObject({ type: 'claim', data: { amount: 50 } })
    await graph.addRelation(person.id, claim.id, 'filed')

    const checkpoint = await runtime.emit('main', {
      type: 'custom.checkpoint',
      payload: {},
    })

    // Remove the relation after checkpoint
    const rels = await graph.queryRelations({ type: 'filed' })
    await graph.removeRelation(rels[0].id)

    // Current: no relations
    const currentRels = await graph.queryRelations({})
    expect(currentRels).toHaveLength(0)

    // At checkpoint: relation should exist
    const past = await runtime.checkout('main', checkpoint.id)
    const pastRels = await past.queryRelations({ type: 'filed' })
    expect(pastRels).toHaveLength(1)
  })

  it('should throw for nonexistent event ID', async () => {
    await expect(
      runtime.checkout('main', 'nonexistent_event_id')
    ).rejects.toThrow('Event not found')
  })

  it('should not modify the original graph', async () => {
    await graph.addObject({ type: 'claim', data: { amount: 100 } })

    const checkpoint = await runtime.emit('main', {
      type: 'custom.checkpoint',
      payload: {},
    })

    await graph.addObject({ type: 'policy', data: { carrier: 'GEICO' } })

    // Checkout should not touch the original
    await runtime.checkout('main', checkpoint.id)

    const originalObjects = await graph.queryObjects({})
    expect(originalObjects).toHaveLength(2) // Both still there
  })
})
