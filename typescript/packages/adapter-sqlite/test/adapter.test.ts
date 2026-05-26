import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRuntime } from '@operad/core'
import { SqliteAdapter } from '../src/index.js'
import { unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DB = join(tmpdir(), `operad-test-${Date.now()}.db`)

describe('SqliteAdapter', () => {
  let adapter: SqliteAdapter

  beforeEach(() => {
    adapter = new SqliteAdapter(':memory:')
  })

  afterEach(() => {
    adapter.close()
  })

  describe('events', () => {
    it('appends and queries events', async () => {
      const event = await adapter.appendEvent('g1', {
        type: 'goal.set',
        payload: { text: 'Fix bug' },
        actor: 'user',
      })

      expect(event.id).toMatch(/^evt_/)
      expect(event.type).toBe('goal.set')
      expect(event.payload.text).toBe('Fix bug')

      const events = await adapter.queryEvents('g1', {})
      expect(events).toHaveLength(1)
      expect(events[0].id).toBe(event.id)
    })

    it('filters events by type', async () => {
      await adapter.appendEvent('g1', { type: 'goal.set', payload: { text: 'a' } })
      await adapter.appendEvent('g1', { type: 'custom.tool_called', payload: { tool: 'Read' } })

      const goals = await adapter.queryEvents('g1', { type: 'goal.set' })
      expect(goals).toHaveLength(1)
    })

    it('traces causal chains', async () => {
      const e1 = await adapter.appendEvent('g1', { type: 'goal.set', payload: { text: 'a' } })
      const e2 = await adapter.appendEvent('g1', { type: 'custom.tool_called', payload: { tool: 'Read' }, causedBy: e1.id })

      const chain = await adapter.getEventChain(e2.id)
      expect(chain.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('objects', () => {
    it('adds and queries objects', async () => {
      const evt = await adapter.appendEvent('g1', { type: 'object.created', payload: {} })
      const obj = await adapter.addObject('g1', { type: 'file', data: { path: '/src/app.ts' } }, evt.id)

      expect(obj.id).toMatch(/^obj_/)
      expect(obj.data.path).toBe('/src/app.ts')

      const found = await adapter.getObject(obj.id)
      expect(found).not.toBeNull()
      expect(found!.data.path).toBe('/src/app.ts')
    })

    it('patches objects (shallow merge)', async () => {
      const evt = await adapter.appendEvent('g1', { type: 'object.created', payload: {} })
      const obj = await adapter.addObject('g1', { type: 'file', data: { path: '/src/app.ts', readCount: 1 } }, evt.id)

      const patched = await adapter.patchObject(obj.id, { readCount: 2 }, evt.id)
      expect(patched.data.path).toBe('/src/app.ts')  // preserved
      expect(patched.data.readCount).toBe(2)         // updated
    })

    it('queries by type', async () => {
      const evt = await adapter.appendEvent('g1', { type: 'object.created', payload: {} })
      await adapter.addObject('g1', { type: 'file', data: { path: '/a' } }, evt.id)
      await adapter.addObject('g1', { type: 'goal', data: { text: 'hi' } }, evt.id)

      const files = await adapter.queryObjects('g1', { type: 'file' })
      expect(files).toHaveLength(1)
      expect(files[0].type).toBe('file')
    })

    it('queries by data match', async () => {
      const evt = await adapter.appendEvent('g1', { type: 'object.created', payload: {} })
      await adapter.addObject('g1', { type: 'file', data: { path: '/a.ts' } }, evt.id)
      await adapter.addObject('g1', { type: 'file', data: { path: '/b.ts' } }, evt.id)

      const match = await adapter.queryObjects('g1', { type: 'file', dataMatch: { path: '/a.ts' } })
      expect(match).toHaveLength(1)
    })
  })

  describe('relations', () => {
    it('adds and queries relations', async () => {
      const evt = await adapter.appendEvent('g1', { type: 'relation.created', payload: {} })
      const obj1 = await adapter.addObject('g1', { type: 'goal', data: { text: 'a' } }, evt.id)
      const obj2 = await adapter.addObject('g1', { type: 'file', data: { path: '/x' } }, evt.id)

      const rel = await adapter.addRelation('g1', { sourceId: obj1.id, targetId: obj2.id, type: 'triggered' }, evt.id)
      expect(rel.id).toMatch(/^rel_/)

      const rels = await adapter.queryRelations('g1', { type: 'triggered' })
      expect(rels).toHaveLength(1)
    })
  })

  describe('branching (D6: subagent sharing)', () => {
    it('copies events up to a cutpoint into a new graph', async () => {
      const e1 = await adapter.appendEvent('main', { type: 'goal.set', payload: { text: 'goal 1' } })
      const e2 = await adapter.appendEvent('main', { type: 'custom.tool_called', payload: { tool: 'Read' } })
      await adapter.appendEvent('main', { type: 'custom.tool_called', payload: { tool: 'Edit' } })

      // Branch at e2 (subagent inherits goal + first read, not the edit)
      const count = await adapter.copyEventsUpTo('main', 'subagent-1', e2.id)
      expect(count).toBe(2)

      const branchEvents = await adapter.queryEvents('subagent-1', {})
      expect(branchEvents).toHaveLength(2)
    })
  })
})

describe('SqliteAdapter (persistent file)', () => {
  const dbPath = TEST_DB

  afterEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath)
    if (existsSync(dbPath + '-wal')) unlinkSync(dbPath + '-wal')
    if (existsSync(dbPath + '-shm')) unlinkSync(dbPath + '-shm')
  })

  it('persists data across adapter instances (D5: survives context reset)', async () => {
    // First "session" — agent writes to graph
    const adapter1 = new SqliteAdapter(dbPath)
    const evt = await adapter1.appendEvent('g1', { type: 'goal.set', payload: { text: 'original goal' } })
    await adapter1.addObject('g1', { type: 'file', data: { path: '/src/main.ts', readCount: 3 } }, evt.id)
    adapter1.close()

    // Second "session" — new context window, same db file
    const adapter2 = new SqliteAdapter(dbPath)
    const events = await adapter2.queryEvents('g1', {})
    expect(events).toHaveLength(1)
    expect(events[0].payload.text).toBe('original goal')

    const files = await adapter2.queryObjects('g1', { type: 'file' })
    expect(files).toHaveLength(1)
    expect(files[0].data.path).toBe('/src/main.ts')
    expect(files[0].data.readCount).toBe(3)
    adapter2.close()
  })

  it('D6: two adapters sharing same file (parent + subagent)', async () => {
    // Parent agent writes
    const parent = new SqliteAdapter(dbPath)
    const evt = await parent.appendEvent('shared', { type: 'goal.set', payload: { text: 'parent goal' } })
    await parent.addObject('shared', { type: 'file', data: { path: '/cached.ts' } }, evt.id)

    // Subagent reads same file (simulating D6 shared graph)
    const child = new SqliteAdapter(dbPath)
    const files = await child.queryObjects('shared', { type: 'file' })
    expect(files).toHaveLength(1)
    expect(files[0].data.path).toBe('/cached.ts')

    // Child can query "have I read this?" → YES, parent already cached it
    const cached = await child.queryObjects('shared', { type: 'file', dataMatch: { path: '/cached.ts' } })
    expect(cached).toHaveLength(1)

    parent.close()
    child.close()
  })
})

describe('integration with @operad/core runtime', () => {
  it('works as drop-in storage for createRuntime', async () => {
    const adapter = new SqliteAdapter(':memory:')
    const runtime = createRuntime({ storage: adapter })
    const graph = await runtime.createGraph('test')

    const obj = await graph.addObject({ type: 'goal', data: { text: 'hello' } })
    expect(obj.id).toMatch(/^obj_/)

    const found = await graph.queryObjects({ type: 'goal' })
    expect(found).toHaveLength(1)

    adapter.close()
  })
})
