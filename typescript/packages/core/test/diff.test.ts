import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntime } from '../src/index.js'
import type { Runtime, GraphAPI } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Diff (log-based)', () => {
  let storage: MemoryAdapter
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('source')
  })

  it('should return empty diff immediately after branch', async () => {
    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })
    const diff = await runtime.diff('source', branched.id)

    expect(diff.sourceGraphId).toBe('source')
    expect(diff.targetGraphId).toBe(branched.id)
    expect(diff.objects).toHaveLength(0)
    expect(diff.relations).toHaveLength(0)
    expect(diff.sourceLog).toHaveLength(0)
    expect(diff.targetLog).toHaveLength(0)
  })

  it('should detect object added to branch via log', async () => {
    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })
    await branched.addObject({ type: 'claim', data: { amount: 999 } })

    const diff = await runtime.diff('source', branched.id)

    const added = diff.objects.filter((o) => o.status === 'added')
    expect(added).toHaveLength(1)
    expect(added[0].type).toBe('claim')
    expect(added[0].data?.amount).toBe(999)
  })

  it('should detect object added to source after branch', async () => {
    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })
    await graph.addObject({ type: 'policy', data: { carrier: 'GEICO' } })

    const diff = await runtime.diff('source', branched.id)

    // Source added something the branch doesn't have → "removed" from branch perspective
    const removed = diff.objects.filter((o) => o.status === 'removed')
    expect(removed).toHaveLength(1)
    expect(removed[0].type).toBe('policy')
  })

  it('should detect divergent objects on both sides', async () => {
    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })
    await graph.addObject({ type: 'policy', data: { carrier: 'StateFarm' } })
    await branched.addObject({ type: 'claim', data: { amount: 500 } })

    const diff = await runtime.diff('source', branched.id)

    const added = diff.objects.filter((o) => o.status === 'added')
    const removed = diff.objects.filter((o) => o.status === 'removed')
    expect(added).toHaveLength(1)
    expect(added[0].type).toBe('claim')
    expect(removed).toHaveLength(1)
    expect(removed[0].type).toBe('policy')
  })

  it('should detect object modified on branch (patched)', async () => {
    const obj = await graph.addObject({ type: 'claim', data: { amount: 100, status: 'open' } })

    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })

    // The branch has a copy of the object — find it
    const branchObjects = await branched.queryObjects({ type: 'claim' })
    expect(branchObjects).toHaveLength(1)
    await branched.patchObject(branchObjects[0].id, { status: 'closed' })

    const diff = await runtime.diff('source', branched.id)

    const modified = diff.objects.filter((o) => o.status === 'modified')
    expect(modified).toHaveLength(1)
    expect(modified[0].targetData?.status).toBe('closed')
  })

  it('should capture divergent event logs', async () => {
    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })

    await runtime.emit('source', {
      type: 'custom.source_update',
      payload: { info: 'source side' },
    })
    await runtime.emit(branched.id, {
      type: 'custom.branch_update',
      payload: { info: 'branch side' },
    })

    const diff = await runtime.diff('source', branched.id)

    expect(diff.sourceLog.length).toBeGreaterThan(0)
    expect(diff.targetLog.length).toBeGreaterThan(0)

    const sourceCustom = diff.sourceLog.filter(
      (e) => e.type === 'custom.source_update'
    )
    expect(sourceCustom).toHaveLength(1)

    const targetCustom = diff.targetLog.filter(
      (e) => e.type === 'custom.branch_update'
    )
    expect(targetCustom).toHaveLength(1)
  })

  it('should snapshot objects into branch (queryObjects works)', async () => {
    await graph.addObject({ type: 'claim', data: { amount: 42 } })
    await graph.addObject({ type: 'policy', data: { carrier: 'Allstate' } })

    const evt = await runtime.emit('source', {
      type: 'custom.checkpoint',
      payload: {},
    })

    const branched = await runtime.branch('source', { atEvent: evt.id })
    const branchObjects = await branched.queryObjects({})

    expect(branchObjects).toHaveLength(2)
    const types = branchObjects.map((o) => o.type).sort()
    expect(types).toEqual(['claim', 'policy'])
  })
})
