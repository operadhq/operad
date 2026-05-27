/**
 * @operad/server — REST API for the Operad event-sourced graph runtime.
 *
 * Exposes all GraphAPI operations over HTTP so any language can use Operad.
 * Supports both in-memory (dev) and Postgres (production) adapters.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import {
  createRuntime,
  type Runtime,
  type StorageAdapter,
  type ObjectFilter,
  type RelationFilter,
  type EventFilter,
  type DecisionFilter,
  type DecisionInput,
  type HealthUpdate,
  type JsonValue,
} from '@operad/core'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ServerOptions {
  /** Storage adapter to use (MemoryAdapter or PostgresAdapter) */
  storage: StorageAdapter
  /** Port to listen on (default: 3111) */
  port?: number
  /** Enable CORS (default: true) */
  cors?: boolean
}

// ─── App Factory ────────────────────────────────────────────────────────────

/**
 * Creates a Hono app with all Operad REST routes.
 * Can be used standalone or mounted into a larger app.
 */
export function createApp(storage: StorageAdapter) {
  const app = new Hono()
  const runtime = createRuntime({ storage })
  const graphs = new Map<string, ReturnType<typeof runtime.getGraph>>()

  // ─── Middleware ──────────────────────────────────────────────────────

  app.use('*', logger())
  app.use('*', cors())

  // ─── Auth ─────────────────────────────────────────────────────────

  app.use('*', async (c, next) => {
    if (c.req.method === 'GET' && c.req.path === '/') return next()

    const apiKey = process.env.API_KEY
    if (!apiKey) return next() // Dev mode: no key configured = open access

    const auth = c.req.header('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing Authorization: Bearer <key> header' }, 401)
    }

    if (auth.slice(7) !== apiKey) {
      return c.json({ error: 'Invalid API key' }, 401)
    }

    return next()
  })

  // ─── Health Check ───────────────────────────────────────────────────

  app.get('/', (c) =>
    c.json({
      name: '@operad/server',
      version: '0.1.0',
      status: 'ok',
      docs: 'https://operad.dev/docs/api',
    })
  )

  // ─── Graphs ─────────────────────────────────────────────────────────

  app.post('/graphs', async (c) => {
    const body = await c.req.json<{ id: string }>()
    if (!body.id) return c.json({ error: 'id is required' }, 400)

    const graph = await runtime.createGraph(body.id)
    graphs.set(body.id, graph)
    return c.json({ id: body.id, created: true }, 201)
  })

  // ─── Objects ────────────────────────────────────────────────────────

  app.post('/graphs/:graphId/objects', async (c) => {
    const graph = ensureGraph(runtime, graphs, c.req.param('graphId'))
    const body = await c.req.json<{ type: string; data: Record<string, JsonValue> }>()

    if (!body.type) return c.json({ error: 'type is required' }, 400)

    const obj = await graph.addObject({ type: body.type, data: body.data ?? {} })
    return c.json(obj, 201)
  })

  app.get('/graphs/:graphId/objects', async (c) => {
    const graph = ensureGraph(runtime, graphs, c.req.param('graphId'))
    const filter: ObjectFilter = {}

    const type = c.req.query('type')
    if (type) filter.type = type

    const dataMatch = c.req.query('dataMatch')
    if (dataMatch) {
      try {
        filter.dataMatch = JSON.parse(dataMatch)
      } catch {
        return c.json({ error: 'dataMatch must be valid JSON' }, 400)
      }
    }

    const objects = await graph.queryObjects(filter)
    return c.json(objects)
  })

  app.get('/objects/:id', async (c) => {
    const obj = await storage.getObject(c.req.param('id'))
    if (!obj) return c.json({ error: 'not found' }, 404)
    return c.json(obj)
  })

  app.patch('/objects/:id', async (c) => {
    const id = c.req.param('id')
    const obj = await storage.getObject(id)
    if (!obj) return c.json({ error: 'not found' }, 404)

    const graph = ensureGraph(runtime, graphs, obj.graphId)
    const body = await c.req.json<{ data: Record<string, JsonValue> }>()
    const patched = await graph.patchObject(id, body.data ?? {})
    return c.json(patched)
  })

  app.delete('/objects/:id', async (c) => {
    const id = c.req.param('id')
    const obj = await storage.getObject(id)
    if (!obj) return c.json({ error: 'not found' }, 404)

    const graph = ensureGraph(runtime, graphs, obj.graphId)
    await graph.removeObject(id)
    return c.json({ deleted: true })
  })

  // ─── Relations ──────────────────────────────────────────────────────

  app.post('/graphs/:graphId/relations', async (c) => {
    const graph = ensureGraph(runtime, graphs, c.req.param('graphId'))
    const body = await c.req.json<{
      sourceId: string
      targetId: string
      type: string
      data?: Record<string, JsonValue>
    }>()

    if (!body.sourceId || !body.targetId || !body.type) {
      return c.json({ error: 'sourceId, targetId, and type are required' }, 400)
    }

    const rel = await graph.addRelation(body.sourceId, body.targetId, body.type, body.data)
    return c.json(rel, 201)
  })

  app.get('/graphs/:graphId/relations', async (c) => {
    const graph = ensureGraph(runtime, graphs, c.req.param('graphId'))
    const filter: RelationFilter = {}

    const type = c.req.query('type')
    if (type) filter.type = type
    const sourceId = c.req.query('sourceId')
    if (sourceId) filter.sourceId = sourceId
    const targetId = c.req.query('targetId')
    if (targetId) filter.targetId = targetId

    const relations = await graph.queryRelations(filter)
    return c.json(relations)
  })

  app.get('/relations/:id', async (c) => {
    const rel = await storage.getRelation(c.req.param('id'))
    if (!rel) return c.json({ error: 'not found' }, 404)
    return c.json(rel)
  })

  app.delete('/relations/:id', async (c) => {
    const id = c.req.param('id')
    const rel = await storage.getRelation(id)
    if (!rel) return c.json({ error: 'not found' }, 404)

    const graph = ensureGraph(runtime, graphs, rel.graphId)
    await graph.removeRelation(id)
    return c.json({ deleted: true })
  })

  // ─── Events ─────────────────────────────────────────────────────────

  app.get('/graphs/:graphId/events', async (c) => {
    const graphId = c.req.param('graphId')
    const filter: EventFilter = {}

    const type = c.req.query('type')
    if (type) filter.type = type as EventFilter['type']
    const after = c.req.query('after')
    if (after) filter.after = after
    const before = c.req.query('before')
    if (before) filter.before = before

    const events = await storage.queryEvents(graphId, filter)
    return c.json(events)
  })

  app.get('/events/:id/chain', async (c) => {
    const chain = await storage.getEventChain(c.req.param('id'))
    return c.json(chain)
  })

  app.get('/events/:id/effects', async (c) => {
    const effects = await storage.getEventsTriggeredBy(c.req.param('id'))
    return c.json(effects)
  })

  // ─── Decisions ──────────────────────────────────────────────────────

  app.post('/graphs/:graphId/decisions', async (c) => {
    const graph = ensureGraph(runtime, graphs, c.req.param('graphId'))
    const body = await c.req.json<DecisionInput>()

    if (!body.selectedAction || body.confidence === undefined) {
      return c.json({ error: 'selectedAction and confidence are required' }, 400)
    }

    const decision = await graph.recordDecision(body)
    return c.json(decision, 201)
  })

  app.get('/graphs/:graphId/decisions', async (c) => {
    const graph = ensureGraph(runtime, graphs, c.req.param('graphId'))
    const filter: DecisionFilter = {}

    const after = c.req.query('after')
    if (after) filter.after = after
    const before = c.req.query('before')
    if (before) filter.before = before
    const minConfidence = c.req.query('minConfidence')
    if (minConfidence) filter.minConfidence = parseFloat(minConfidence)

    const decisions = await graph.queryDecisions(filter)
    return c.json(decisions)
  })

  // ─── Health ─────────────────────────────────────────────────────────

  app.get('/graphs/:graphId/stale', async (c) => {
    const graph = ensureGraph(runtime, graphs, c.req.param('graphId'))
    const thresholdDays = parseInt(c.req.query('thresholdDays') ?? '14', 10)
    const stale = await graph.getStaleObjects({ thresholdDays })
    return c.json(stale)
  })

  app.post('/objects/:id/health', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json<HealthUpdate>()
    const record = await storage.updateHealth(id, body)
    return c.json(record)
  })

  return { app, runtime }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function ensureGraph(
  runtime: Runtime,
  graphs: Map<string, ReturnType<typeof runtime.getGraph>>,
  graphId: string
) {
  let graph = graphs.get(graphId)
  if (!graph) {
    graph = runtime.getGraph(graphId)
    graphs.set(graphId, graph)
  }
  return graph
}

export { type StorageAdapter } from '@operad/core'
