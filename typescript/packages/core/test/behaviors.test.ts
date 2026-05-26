import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntime } from '../src/index.js'
import { wasteAlert, costBudget, autoRetry, branchOnFailure } from '../src/behaviors/index.js'
import type { Runtime } from '../src/types.js'
import { MemoryAdapter } from '@operad/adapter-memory'

describe('Pre-built Behaviors', () => {
  let storage: MemoryAdapter
  let runtime: Runtime

  beforeEach(() => {
    storage = new MemoryAdapter()
    runtime = createRuntime({ storage })
  })

  describe('wasteAlert', () => {
    it('should emit waste_detected on duplicate read without intervening edit', async () => {
      runtime.registerBehavior(wasteAlert())
      await runtime.createGraph('test')

      // First read
      await runtime.emit('test', {
        type: 'custom.tool_called',
        payload: { tool: 'Read', file_path: '/src/foo.ts' },
      })

      // Second read of same file — should trigger waste
      await runtime.emit('test', {
        type: 'custom.tool_called',
        payload: { tool: 'Read', file_path: '/src/foo.ts' },
      })

      const events = await storage.queryEvents('test', { type: 'custom.waste_detected' })
      expect(events).toHaveLength(1)
      expect(events[0].payload.file_path).toBe('/src/foo.ts')
      expect(events[0].payload.readCount).toBe(2)
    })

    it('should NOT emit waste_detected if file was edited between reads', async () => {
      runtime.registerBehavior(wasteAlert())
      await runtime.createGraph('test')

      await runtime.emit('test', {
        type: 'custom.tool_called',
        payload: { tool: 'Read', file_path: '/src/foo.ts' },
      })

      // Edit resets the counter
      await runtime.emit('test', {
        type: 'custom.tool_called',
        payload: { tool: 'Edit', file_path: '/src/foo.ts' },
      })

      await runtime.emit('test', {
        type: 'custom.tool_called',
        payload: { tool: 'Read', file_path: '/src/foo.ts' },
      })

      const events = await storage.queryEvents('test', { type: 'custom.waste_detected' })
      expect(events).toHaveLength(0)
    })
  })

  describe('costBudget', () => {
    it('should emit budget_exceeded when cost exceeds maxCost', async () => {
      runtime.registerBehavior(costBudget({ maxCost: 1.0 }))
      await runtime.createGraph('test')

      await runtime.emit('test', {
        type: 'custom.blame_recorded',
        payload: { cost: 0.6 },
      })

      await runtime.emit('test', {
        type: 'custom.blame_recorded',
        payload: { cost: 0.5 },
      })

      const events = await storage.queryEvents('test', { type: 'custom.budget_exceeded' })
      expect(events).toHaveLength(1)
      expect(events[0].payload.totalCost).toBe(1.1)
      expect(events[0].payload.maxCost).toBe(1.0)
      expect(events[0].payload.overage).toBeCloseTo(0.1)
    })

    it('should NOT emit if cost stays within budget', async () => {
      runtime.registerBehavior(costBudget({ maxCost: 2.0 }))
      await runtime.createGraph('test')

      await runtime.emit('test', {
        type: 'custom.blame_recorded',
        payload: { cost: 0.5 },
      })

      const events = await storage.queryEvents('test', { type: 'custom.budget_exceeded' })
      expect(events).toHaveLength(0)
    })
  })

  describe('autoRetry', () => {
    it('should re-emit the trigger event on first failure', async () => {
      runtime.registerBehavior(autoRetry())
      await runtime.createGraph('test')

      await runtime.emit('test', {
        type: 'behavior.failed',
        payload: {
          behaviorName: 'scraper',
          error: 'timeout',
          triggerEvent: { type: 'custom.scrape_requested', payload: { url: 'http://x.com' } },
        },
      })

      const retries = await storage.queryEvents('test', { type: 'custom.scrape_requested' })
      expect(retries).toHaveLength(1)
      expect(retries[0].payload.url).toBe('http://x.com')
    })

    it('should emit retry_exhausted after 3 failures', async () => {
      runtime.registerBehavior(autoRetry())
      await runtime.createGraph('test')

      const failPayload = {
        behaviorName: 'scraper',
        error: 'timeout',
        triggerEvent: { type: 'custom.scrape_requested', payload: {} },
      }

      await runtime.emit('test', { type: 'behavior.failed', payload: failPayload })
      await runtime.emit('test', { type: 'behavior.failed', payload: failPayload })
      await runtime.emit('test', { type: 'behavior.failed', payload: failPayload })

      const exhausted = await storage.queryEvents('test', { type: 'custom.retry_exhausted' })
      expect(exhausted).toHaveLength(1)
      expect(exhausted[0].payload.behaviorName).toBe('scraper')
      expect(exhausted[0].payload.failureCount).toBe(3)
    })
  })

  describe('branchOnFailure', () => {
    it('should emit branch_requested on behavior failure', async () => {
      runtime.registerBehavior(branchOnFailure())
      await runtime.createGraph('test')

      await runtime.emit('test', {
        type: 'behavior.failed',
        payload: {
          behaviorName: 'planner',
          error: 'invalid_plan',
          triggerEventId: 'evt_origin',
        },
      })

      const events = await storage.queryEvents('test', { type: 'custom.branch_requested' })
      expect(events).toHaveLength(1)
      expect(events[0].payload.atEvent).toBe('evt_origin')
      expect(events[0].payload.reason).toBe('invalid_plan')
    })
  })
})
