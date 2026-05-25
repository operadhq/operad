import { describe, it, expect, beforeEach } from 'vitest'
import { parsePattern, matchPattern } from '../src/pattern.js'
import { createRuntime, behavior } from '../src/index.js'
import type { Runtime, GraphAPI } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Pattern Matching', () => {
  describe('parsePattern', () => {
    it('should parse a typed pattern', () => {
      const parsed = parsePattern('(a:Claim)-[:contradicts]->(b:Claim)')
      expect(parsed.source).toEqual({ alias: 'a', type: 'Claim' })
      expect(parsed.relation).toEqual({ type: 'contradicts' })
      expect(parsed.target).toEqual({ alias: 'b', type: 'Claim' })
    })

    it('should parse an untyped pattern', () => {
      const parsed = parsePattern('(x)-[:link]->(y)')
      expect(parsed.source).toEqual({ alias: 'x', type: undefined })
      expect(parsed.target).toEqual({ alias: 'y', type: undefined })
      expect(parsed.relation).toEqual({ type: 'link' })
    })

    it('should parse mixed typed/untyped', () => {
      const parsed = parsePattern('(src:Task)-[:depends_on]->(tgt)')
      expect(parsed.source.type).toBe('Task')
      expect(parsed.target.type).toBeUndefined()
    })

    it('should throw on invalid pattern', () => {
      expect(() => parsePattern('invalid')).toThrow('Invalid pattern')
      expect(() => parsePattern('(a)-[bad]->(b)')).toThrow('Invalid pattern')
      expect(() => parsePattern('(a:T)-[:r]-(b:T)')).toThrow('Invalid pattern') // missing >
    })
  })

  describe('matchPattern', () => {
    let storage: MemoryAdapter
    let runtime: Runtime
    let graph: GraphAPI

    beforeEach(async () => {
      storage = new MemoryAdapter()
      runtime = createRuntime({ storage })
      graph = await runtime.createGraph('test')
    })

    it('should match subgraphs with type constraints', async () => {
      const claim1 = await graph.addObject({ type: 'Claim', data: { text: 'A' } })
      const claim2 = await graph.addObject({ type: 'Claim', data: { text: 'B' } })
      const evidence = await graph.addObject({ type: 'Evidence', data: { text: 'E' } })

      await graph.addRelation(claim1.id, claim2.id, 'contradicts')
      await graph.addRelation(claim1.id, evidence.id, 'supports')

      const parsed = parsePattern('(a:Claim)-[:contradicts]->(b:Claim)')
      const matches = await matchPattern(parsed, graph)

      expect(matches).toHaveLength(1)
      expect((matches[0].a as any).data.text).toBe('A')
      expect((matches[0].b as any).data.text).toBe('B')
    })

    it('should match without type constraints', async () => {
      const a = await graph.addObject({ type: 'Node', data: {} })
      const b = await graph.addObject({ type: 'Edge', data: {} })

      await graph.addRelation(a.id, b.id, 'link')

      const parsed = parsePattern('(x)-[:link]->(y)')
      const matches = await matchPattern(parsed, graph)

      expect(matches).toHaveLength(1)
    })

    it('should return empty when no matches', async () => {
      await graph.addObject({ type: 'Claim', data: {} })

      const parsed = parsePattern('(a:Claim)-[:contradicts]->(b:Claim)')
      const matches = await matchPattern(parsed, graph)

      expect(matches).toHaveLength(0)
    })

    it('should filter by source type constraint', async () => {
      const task = await graph.addObject({ type: 'Task', data: {} })
      const note = await graph.addObject({ type: 'Note', data: {} })
      const other = await graph.addObject({ type: 'Other', data: {} })

      await graph.addRelation(task.id, note.id, 'references')
      await graph.addRelation(other.id, note.id, 'references')

      const parsed = parsePattern('(a:Task)-[:references]->(b)')
      const matches = await matchPattern(parsed, graph)

      expect(matches).toHaveLength(1)
      expect((matches[0].a as any).type).toBe('Task')
    })

    it('should integrate with behavior via pattern field', async () => {
      let capturedMatches: any[] = []

      runtime.registerBehavior(
        behavior({
          name: 'find-contradictions',
          on: ['custom.analyze'],
          pattern: '(a:Claim)-[:contradicts]->(b:Claim)',
          handler: async (_event, _graph, ctx) => {
            capturedMatches = ctx.matches ?? []
          },
        })
      )

      const c1 = await graph.addObject({ type: 'Claim', data: { text: 'X' } })
      const c2 = await graph.addObject({ type: 'Claim', data: { text: 'Y' } })
      await graph.addRelation(c1.id, c2.id, 'contradicts')

      await runtime.emit('test', {
        type: 'custom.analyze',
        payload: {},
      })

      expect(capturedMatches).toHaveLength(1)
    })
  })
})
