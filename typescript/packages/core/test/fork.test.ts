import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntime } from '../src/index.js'
import type { Runtime, GraphAPI } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Branching (git vocabulary)', () => {
  let storage: MemoryAdapter
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('source')
  })

  it('should branch using the new branch() method', async () => {
    const evt1 = await runtime.emit('source', {
      type: 'custom.data',
      payload: { value: 'original' },
    })

    const branched = await runtime.branch('source', { atEvent: evt1.id })
    expect(branched.id).toBeTruthy()

    const branchEvents = await storage.queryEvents(branched.id, {})
    expect(branchEvents.length).toBeGreaterThan(0)
  })

  it('should accept branchId option', async () => {
    const evt1 = await runtime.emit('source', {
      type: 'custom.data',
      payload: {},
    })

    const branched = await runtime.branch('source', {
      atEvent: evt1.id,
      branchId: 'my-branch',
    })
    expect(branched.id).toBe('my-branch')
  })

  it('fork() should work as alias for branch()', async () => {
    const evt1 = await runtime.emit('source', {
      type: 'custom.data',
      payload: {},
    })

    const forked = await runtime.fork('source', {
      atEvent: evt1.id,
      branchId: 'via-fork-alias',
    })
    expect(forked.id).toBe('via-fork-alias')
  })

  it('should copy objects into the branched graph', async () => {
    await graph.addObject({ type: 'claim', data: { amount: 100 } })

    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })
    const branchObjects = await branched.queryObjects({})
    expect(branchObjects).toHaveLength(1)
    expect(branchObjects[0].type).toBe('claim')
    expect(branchObjects[0].data.amount).toBe(100)
  })

  it('should copy relations into the branched graph', async () => {
    const obj1 = await graph.addObject({ type: 'person', data: { name: 'Alice' } })
    const obj2 = await graph.addObject({ type: 'claim', data: { amount: 50 } })
    await graph.addRelation(obj1.id, obj2.id, 'filed', {})

    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })
    const branchRelations = await branched.queryRelations({})
    expect(branchRelations).toHaveLength(1)
    expect(branchRelations[0].type).toBe('filed')
  })
})

describe('Forking (legacy)', () => {
  let storage: MemoryAdapter
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('source')
  })

  it('should copy events up to the cutpoint', async () => {
    // Emit several events
    const evt1 = await runtime.emit('source', {
      type: 'custom.step1',
      payload: { step: 1 },
    })
    const evt2 = await runtime.emit('source', {
      type: 'custom.step2',
      payload: { step: 2 },
    })
    await runtime.emit('source', {
      type: 'custom.step3',
      payload: { step: 3 },
    })

    // Fork at evt2 — should copy events up to and including evt2
    const forked = await runtime.fork('source', { atEvent: evt2.id })

    const forkEvents = await storage.queryEvents(forked.id, {})
    // graph.created + step1 + step2 + the graph_forked event
    const customEvents = forkEvents.filter(e => e.type.startsWith('custom.step'))
    expect(customEvents).toHaveLength(2) // step1, step2 (not step3)
  })

  it('should create independent graphs after forking', async () => {
    const evt1 = await runtime.emit('source', {
      type: 'custom.data',
      payload: { value: 'original' },
    })

    const forked = await runtime.fork('source', { atEvent: evt1.id })

    // Add event to forked graph
    await runtime.emit(forked.id, {
      type: 'custom.forked_only',
      payload: { value: 'forked' },
    })

    // Source should not have the forked-only event
    const sourceEvents = await storage.queryEvents('source', { type: 'custom.forked_only' })
    expect(sourceEvents).toHaveLength(0)

    // Fork should have it
    const forkEvents = await storage.queryEvents(forked.id, { type: 'custom.forked_only' })
    expect(forkEvents).toHaveLength(1)
  })

  it('should emit custom.graph_forked event', async () => {
    const evt1 = await runtime.emit('source', {
      type: 'custom.data',
      payload: {},
    })

    const forked = await runtime.fork('source', {
      atEvent: evt1.id,
      label: 'what-if-scenario',
    })

    const forkEvents = await storage.queryEvents(forked.id, { type: 'custom.graph_forked' as any })
    expect(forkEvents).toHaveLength(1)
    expect(forkEvents[0].payload.sourceGraphId).toBe('source')
    expect(forkEvents[0].payload.label).toBe('what-if-scenario')
  })

  it('should throw when adapter does not support forking', async () => {
    // Create a proxy adapter that removes copyEventsUpTo
    const bareStorage = new MemoryAdapter()
    // Delete the method to simulate an adapter without fork support
    ;(bareStorage as any).copyEventsUpTo = undefined
    const bareRuntime = createRuntime({ storage: bareStorage })
    await bareRuntime.createGraph('bare')

    await expect(
      bareRuntime.fork('bare', { atEvent: 'evt1' })
    ).rejects.toThrow('does not support branching')
  })

  it('should use custom forkId when provided', async () => {
    const evt1 = await runtime.emit('source', {
      type: 'custom.data',
      payload: {},
    })

    const forked = await runtime.fork('source', {
      atEvent: evt1.id,
      forkId: 'my-custom-fork-id',
    })

    expect(forked.id).toBe('my-custom-fork-id')
  })
})
