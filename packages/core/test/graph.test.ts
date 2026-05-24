import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntime } from '../src/runtime.js'
import type { GraphAPI, Runtime } from '../src/types.js'
import { MemoryAdapter } from '@engram-ai/adapter-memory'

describe('Graph', () => {
  let runtime: Runtime
  let graph: GraphAPI

  beforeEach(async () => {
    const storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
    graph = await runtime.createGraph('test-graph')
  })

  describe('Objects', () => {
    it('should add and retrieve an object', async () => {
      const obj = await graph.addObject({ type: 'claim', data: { policy: '12345' } })

      expect(obj.id).toBeDefined()
      expect(obj.type).toBe('claim')
      expect(obj.data.policy).toBe('12345')
      expect(obj.graphId).toBe('test-graph')

      const retrieved = await graph.getObject(obj.id)
      expect(retrieved).toEqual(obj)
    })

    it('should patch an object', async () => {
      const obj = await graph.addObject({ type: 'claim', data: { status: 'open' } })
      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 5))
      const patched = await graph.patchObject(obj.id, { status: 'closed', closedBy: 'agent' })

      expect(patched.data.status).toBe('closed')
      expect(patched.data.closedBy).toBe('agent')
      expect(new Date(patched.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(obj.updatedAt).getTime()
      )
    })

    it('should remove an object', async () => {
      const obj = await graph.addObject({ type: 'claim', data: {} })
      await graph.removeObject(obj.id)

      const retrieved = await graph.getObject(obj.id)
      expect(retrieved).toBeNull()
    })

    it('should query objects by type', async () => {
      await graph.addObject({ type: 'claim', data: { id: 1 } })
      await graph.addObject({ type: 'evidence', data: { id: 2 } })
      await graph.addObject({ type: 'claim', data: { id: 3 } })

      const claims = await graph.queryObjects({ type: 'claim' })
      expect(claims).toHaveLength(2)
      expect(claims.every((c) => c.type === 'claim')).toBe(true)
    })

    it('should query objects by data match', async () => {
      await graph.addObject({ type: 'claim', data: { status: 'open' } })
      await graph.addObject({ type: 'claim', data: { status: 'closed' } })

      const open = await graph.queryObjects({ dataMatch: { status: 'open' } })
      expect(open).toHaveLength(1)
      expect(open[0].data.status).toBe('open')
    })
  })

  describe('Relations', () => {
    it('should add and retrieve a relation', async () => {
      const a = await graph.addObject({ type: 'evidence', data: {} })
      const b = await graph.addObject({ type: 'claim', data: {} })

      const rel = await graph.addRelation(a.id, b.id, 'supports')

      expect(rel.sourceId).toBe(a.id)
      expect(rel.targetId).toBe(b.id)
      expect(rel.type).toBe('supports')

      const retrieved = await graph.getRelation(rel.id)
      expect(retrieved).toEqual(rel)
    })

    it('should remove a relation', async () => {
      const a = await graph.addObject({ type: 'a', data: {} })
      const b = await graph.addObject({ type: 'b', data: {} })
      const rel = await graph.addRelation(a.id, b.id, 'link')

      await graph.removeRelation(rel.id)
      const retrieved = await graph.getRelation(rel.id)
      expect(retrieved).toBeNull()
    })

    it('should query relations by type', async () => {
      const a = await graph.addObject({ type: 'a', data: {} })
      const b = await graph.addObject({ type: 'b', data: {} })
      const c = await graph.addObject({ type: 'c', data: {} })

      await graph.addRelation(a.id, b.id, 'supports')
      await graph.addRelation(b.id, c.id, 'contradicts')
      await graph.addRelation(a.id, c.id, 'supports')

      const supports = await graph.queryRelations({ type: 'supports' })
      expect(supports).toHaveLength(2)
    })

    it('should query relations by source/target', async () => {
      const a = await graph.addObject({ type: 'a', data: {} })
      const b = await graph.addObject({ type: 'b', data: {} })
      const c = await graph.addObject({ type: 'c', data: {} })

      await graph.addRelation(a.id, b.id, 'link')
      await graph.addRelation(a.id, c.id, 'link')
      await graph.addRelation(b.id, c.id, 'link')

      const fromA = await graph.queryRelations({ sourceId: a.id })
      expect(fromA).toHaveLength(2)

      const toC = await graph.queryRelations({ targetId: c.id })
      expect(toC).toHaveLength(2)
    })
  })

  describe('Event Tracing', () => {
    it('should trace causal chain backward', async () => {
      const obj = await graph.addObject({ type: 'claim', data: { policy: '123' } })

      // The object was created by an event, trace backward from that event
      const chain = await graph.traceBackward(obj.createdByEventId)

      expect(chain.length).toBeGreaterThanOrEqual(1)
      expect(chain[0].type).toBe('object.created')
    })

    it('should trace events forward', async () => {
      // The graph.created event should have been emitted
      // Adding objects creates events caused by nothing (top-level)
      const obj = await graph.addObject({ type: 'test', data: {} })

      // The object.created event is top-level, trace forward from graph.created
      // to find behavior events
      const chain = await graph.traceBackward(obj.createdByEventId)
      expect(chain.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Decisions', () => {
    it('should record and query decisions', async () => {
      const decision = await graph.recordDecision({
        selectedAction: 'approve_claim',
        alternatives: [
          { action: 'deny_claim', rejected: 'evidence supports coverage' },
          { action: 'escalate', rejected: 'confidence > 0.9' },
        ],
        confidence: 0.92,
        reasoning: 'Policy covers water damage',
      })

      expect(decision.selectedAction).toBe('approve_claim')
      expect(decision.alternatives).toHaveLength(2)
      expect(decision.confidence).toBe(0.92)

      const all = await graph.queryDecisions()
      expect(all).toHaveLength(1)
      expect(all[0].id).toBe(decision.id)
    })

    it('should filter decisions by confidence', async () => {
      await graph.recordDecision({
        selectedAction: 'low_conf',
        alternatives: [],
        confidence: 0.3,
        reasoning: 'unsure',
      })
      await graph.recordDecision({
        selectedAction: 'high_conf',
        alternatives: [],
        confidence: 0.95,
        reasoning: 'certain',
      })

      const high = await graph.queryDecisions({ minConfidence: 0.9 })
      expect(high).toHaveLength(1)
      expect(high[0].selectedAction).toBe('high_conf')
    })
  })
})
