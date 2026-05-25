import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntime, behavior } from '../src/index.js'
import type { Runtime, GraphAPI } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Patches + Policies', () => {
  let storage: MemoryAdapter
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('test')
  })

  it('should allow behaviors to propose patches', async () => {
    runtime.registerBehavior(
      behavior({
        name: 'auto-propose',
        on: ['custom.needs_review'],
        handler: async (_event, _graph, ctx) => {
          await ctx.propose!({
            type: 'recommendation',
            data: { action: 'upgrade_policy', confidence: 0.92 },
            reason: 'High claim frequency detected',
          })
        },
      })
    )

    await runtime.emit('test', {
      type: 'custom.needs_review',
      payload: {},
    })

    const pending = runtime.pendingPatches('test')
    expect(pending).toHaveLength(1)
    expect(pending[0].objectType).toBe('recommendation')
    expect(pending[0].proposedBy).toBe('auto-propose')
    expect(pending[0].status).toBe('pending')
  })

  it('should emit patch.proposed event when proposing', async () => {
    runtime.registerBehavior(
      behavior({
        name: 'proposer',
        on: ['custom.trigger'],
        handler: async (_event, _graph, ctx) => {
          await ctx.propose!({
            type: 'alert',
            data: { severity: 'high' },
          })
        },
      })
    )

    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    const events = await storage.queryEvents('test', { type: 'patch.proposed' })
    expect(events).toHaveLength(1)
    expect(events[0].payload.objectType).toBe('alert')
    expect(events[0].payload.proposedBy).toBe('proposer')
  })

  it('should create object when patch is approved', async () => {
    runtime.registerBehavior(
      behavior({
        name: 'proposer',
        on: ['custom.trigger'],
        handler: async (_event, _graph, ctx) => {
          await ctx.propose!({
            type: 'task',
            data: { title: 'Follow up on claim', priority: 'high' },
          })
        },
      })
    )

    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    const pending = runtime.pendingPatches('test')
    expect(pending).toHaveLength(1)

    await runtime.approve(pending[0].id, 'admin')

    // Object should now exist
    const tasks = await graph.queryObjects({ type: 'task' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].data.title).toBe('Follow up on claim')

    // patch.applied event should be emitted
    const events = await storage.queryEvents('test', { type: 'patch.applied' })
    expect(events).toHaveLength(1)
    expect(events[0].payload.decidedBy).toBe('admin')

    // No more pending patches
    expect(runtime.pendingPatches('test')).toHaveLength(0)
  })

  it('should reject patch without creating object', async () => {
    runtime.registerBehavior(
      behavior({
        name: 'proposer',
        on: ['custom.trigger'],
        handler: async (_event, _graph, ctx) => {
          await ctx.propose!({
            type: 'task',
            data: { title: 'Should not exist' },
          })
        },
      })
    )

    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    const pending = runtime.pendingPatches('test')
    await runtime.deny(pending[0].id, 'admin')

    // Object should NOT exist
    const tasks = await graph.queryObjects({ type: 'task' })
    expect(tasks).toHaveLength(0)

    // patch.rejected event should be emitted
    const events = await storage.queryEvents('test', { type: 'patch.rejected' })
    expect(events).toHaveLength(1)
  })

  it('should throw on double-approve', async () => {
    runtime.registerBehavior(
      behavior({
        name: 'proposer',
        on: ['custom.trigger'],
        handler: async (_event, _graph, ctx) => {
          await ctx.propose!({
            type: 'task',
            data: {},
          })
        },
      })
    )

    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    const pending = runtime.pendingPatches('test')
    await runtime.approve(pending[0].id, 'admin')

    await expect(
      runtime.approve(pending[0].id, 'admin')
    ).rejects.toThrow('already resolved')
  })

  it('should allow behaviors to react to patch events', async () => {
    let patchApplied = false

    runtime.registerBehavior(
      behavior({
        name: 'proposer',
        on: ['custom.trigger'],
        handler: async (_event, _graph, ctx) => {
          await ctx.propose!({
            type: 'action',
            data: { name: 'send_email' },
          })
        },
      })
    )

    runtime.registerBehavior(
      behavior({
        name: 'on-patch-applied',
        on: ['patch.applied'],
        handler: async () => {
          patchApplied = true
        },
      })
    )

    await runtime.emit('test', {
      type: 'custom.trigger',
      payload: {},
    })

    const pending = runtime.pendingPatches('test')
    await runtime.approve(pending[0].id, 'admin')

    expect(patchApplied).toBe(true)
  })
})
