import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRuntime, behavior } from '../src/index.js'
import type { Runtime } from '../src/types.js'
import { MemoryAdapter } from '@engram-ai/adapter-memory'

describe('Runtime', () => {
  let storage: MemoryAdapter
  let runtime: Runtime

  beforeEach(() => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
  })

  it('should create a graph and emit graph.created event', async () => {
    const graph = await runtime.createGraph('test')

    const events = await storage.queryEvents('test', { type: 'graph.created' })
    expect(events).toHaveLength(1)
    expect(events[0].payload.graphId).toBe('test')
  })

  it('should emit custom events', async () => {
    await runtime.createGraph('test')

    const event = await runtime.emit('test', {
      type: 'custom.user_action',
      payload: { action: 'clicked_button' },
    })

    expect(event.type).toBe('custom.user_action')
    expect(event.payload.action).toBe('clicked_button')
  })

  it('should fire matching behaviors when events are emitted', async () => {
    const handler = vi.fn()

    runtime.registerBehavior(
      behavior({
        name: 'on-object-created',
        on: ['object.created'],
        handler,
      })
    )

    const graph = await runtime.createGraph('test')
    await graph.addObject({ type: 'claim', data: {} })

    expect(handler).toHaveBeenCalledOnce()
    const [event] = handler.mock.calls[0]
    expect(event.type).toBe('object.created')
  })

  it('should emit behavior.triggered and behavior.completed events', async () => {
    runtime.registerBehavior(
      behavior({
        name: 'noop-behavior',
        on: ['object.created'],
        handler: async () => {},
      })
    )

    const graph = await runtime.createGraph('test')
    await graph.addObject({ type: 'test', data: {} })

    const triggered = await storage.queryEvents('test', { type: 'behavior.triggered' })
    expect(triggered).toHaveLength(1)
    expect(triggered[0].payload.behaviorName).toBe('noop-behavior')

    const completed = await storage.queryEvents('test', { type: 'behavior.completed' })
    expect(completed).toHaveLength(1)
  })

  it('should emit behavior.failed when handler throws', async () => {
    runtime.registerBehavior(
      behavior({
        name: 'failing-behavior',
        on: ['object.created'],
        handler: async () => {
          throw new Error('selector_not_found')
        },
      })
    )

    const graph = await runtime.createGraph('test')
    await graph.addObject({ type: 'test', data: {} })

    const failed = await storage.queryEvents('test', { type: 'behavior.failed' })
    expect(failed).toHaveLength(1)
    expect(failed[0].payload.reason).toBe('selector_not_found')
  })

  it('should support causal chains through behaviors', async () => {
    runtime.registerBehavior(
      behavior({
        name: 'auto-tag',
        on: ['object.created'],
        handler: async (event, graph, ctx) => {
          // This emit creates a new event caused by the object.created event
          await ctx.emit({
            type: 'custom.auto_tagged',
            payload: { objectId: event.payload.objectType },
          })
        },
      })
    )

    const graph = await runtime.createGraph('test')
    await graph.addObject({ type: 'claim', data: {} })

    const customEvents = await storage.queryEvents('test', { type: 'custom.auto_tagged' })
    expect(customEvents).toHaveLength(1)

    // The custom event should be caused by the object.created event
    expect(customEvents[0].causedBy).toBeDefined()

    // Trace backward from the custom event
    const chain = await storage.getEventChain(customEvents[0].id)
    expect(chain.length).toBeGreaterThanOrEqual(2)
    expect(chain[0].type).toBe('custom.auto_tagged')
    expect(chain[1].type).toBe('object.created')
  })

  it('should only fire behaviors matching where clause', async () => {
    const handler = vi.fn()

    runtime.registerBehavior(
      behavior({
        name: 'on-selector-failed',
        on: ['behavior.failed'],
        where: { 'payload.reason': 'selector_not_found' },
        handler,
      })
    )

    // Register a behavior that fails with matching reason
    runtime.registerBehavior(
      behavior({
        name: 'fails-with-selector',
        on: ['custom.trigger_fail'],
        handler: async () => {
          throw new Error('selector_not_found')
        },
      })
    )

    await runtime.createGraph('test')

    // Emit a trigger that causes the failing behavior
    await runtime.emit('test', {
      type: 'custom.trigger_fail',
      payload: {},
    })

    // The where-clause behavior should have been triggered
    expect(handler).toHaveBeenCalledOnce()
  })
})
