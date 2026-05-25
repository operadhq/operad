import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntime } from '../src/index.js'
import type { Runtime, GraphAPI } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Forking', () => {
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
    ).rejects.toThrow('does not support forking')
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
