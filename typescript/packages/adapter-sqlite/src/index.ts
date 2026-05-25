/**
 * @operad/adapter-sqlite — Persistent graph storage for coding agents.
 *
 * This is D5: the live memory that survives context window resets.
 * Think of it as the .git directory for agent cognition —
 * events, objects, relations all persisted to a single file.
 *
 * Usage:
 *   const adapter = new SqliteAdapter('./session.operad.db')
 *   const runtime = createRuntime({ storage: adapter })
 *
 * The agent can now:
 *   - Query "have I read this file?" before issuing a Read
 *   - Track cost across context resets
 *   - Branch and diff across sessions
 *   - Share state with subagents (D6) via the same db file
 */
import Database from 'better-sqlite3'
import type {
  StorageAdapter,
  GraphObject,
  GraphRelation,
  GraphEvent,
  EventInput,
  ObjectInput,
  RelationInput,
  ObjectFilter,
  RelationFilter,
  EventFilter,
  Decision,
  DecisionInput,
  DecisionFilter,
  HealthRecord,
  HealthUpdate,
  JsonValue,
} from '@operad/core'

let idCounter = 0
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`
}

export class SqliteAdapter implements StorageAdapter {
  private db: Database.Database

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL') // concurrent reads during writes
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  // ─── Schema Migration ──────────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operad_events (
        id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        caused_by TEXT,
        timestamp TEXT NOT NULL,
        actor TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_graph ON operad_events(graph_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON operad_events(type);
      CREATE INDEX IF NOT EXISTS idx_events_caused_by ON operad_events(caused_by);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON operad_events(timestamp);

      CREATE TABLE IF NOT EXISTS operad_objects (
        id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by_event_id TEXT NOT NULL REFERENCES operad_events(id)
      );
      CREATE INDEX IF NOT EXISTS idx_objects_graph ON operad_objects(graph_id);
      CREATE INDEX IF NOT EXISTS idx_objects_type ON operad_objects(type);
      CREATE INDEX IF NOT EXISTS idx_objects_graph_type ON operad_objects(graph_id, type);

      CREATE TABLE IF NOT EXISTS operad_relations (
        id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        source_id TEXT NOT NULL REFERENCES operad_objects(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES operad_objects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        created_by_event_id TEXT NOT NULL REFERENCES operad_events(id)
      );
      CREATE INDEX IF NOT EXISTS idx_relations_graph ON operad_relations(graph_id);
      CREATE INDEX IF NOT EXISTS idx_relations_source ON operad_relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON operad_relations(target_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON operad_relations(type);

      CREATE TABLE IF NOT EXISTS operad_decisions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES operad_events(id),
        graph_id TEXT NOT NULL,
        selected_action TEXT NOT NULL,
        alternatives TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        reasoning TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_graph ON operad_decisions(graph_id);

      CREATE TABLE IF NOT EXISTS operad_health (
        object_id TEXT PRIMARY KEY REFERENCES operad_objects(id) ON DELETE CASCADE,
        last_verified_at TEXT NOT NULL,
        verification_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 1.0,
        stale_since TEXT
      );
    `)
  }

  // ─── Events ────────────────────────────────────────────────────────

  async appendEvent(graphId: string, event: EventInput): Promise<GraphEvent> {
    const id = genId('evt')
    const now = new Date().toISOString()
    const actor = event.actor ?? 'user'

    this.db.prepare(`
      INSERT INTO operad_events (id, graph_id, type, payload, caused_by, timestamp, actor)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, graphId, event.type,
      JSON.stringify(event.payload),
      event.causedBy ?? null,
      now, actor
    )

    return { id, graphId, type: event.type as GraphEvent['type'], payload: event.payload, causedBy: event.causedBy ?? null, timestamp: now, actor }
  }

  async queryEvents(graphId: string, filter: EventFilter): Promise<GraphEvent[]> {
    let sql = 'SELECT * FROM operad_events WHERE graph_id = ?'
    const params: unknown[] = [graphId]

    if (filter.type) {
      sql += ' AND type = ?'
      params.push(filter.type)
    }
    if (filter.after) {
      sql += ' AND timestamp > ?'
      params.push(filter.after)
    }
    if (filter.before) {
      sql += ' AND timestamp < ?'
      params.push(filter.before)
    }

    sql += ' ORDER BY timestamp ASC'
    const rows = this.db.prepare(sql).all(...params) as EventRow[]
    return rows.map(rowToEvent)
  }

  async getEventChain(eventId: string): Promise<GraphEvent[]> {
    const rows = this.db.prepare(`
      WITH RECURSIVE chain AS (
        SELECT * FROM operad_events WHERE id = ?
        UNION ALL
        SELECT e.* FROM operad_events e
        JOIN chain c ON e.id = c.caused_by
      )
      SELECT * FROM chain
    `).all(eventId) as EventRow[]
    return rows.map(rowToEvent)
  }

  async getEventsTriggeredBy(eventId: string): Promise<GraphEvent[]> {
    const rows = this.db.prepare(`
      WITH RECURSIVE descendants AS (
        SELECT * FROM operad_events WHERE caused_by = ?
        UNION ALL
        SELECT e.* FROM operad_events e
        JOIN descendants d ON e.caused_by = d.id
      )
      SELECT * FROM descendants
    `).all(eventId) as EventRow[]
    return rows.map(rowToEvent)
  }

  // ─── Objects ───────────────────────────────────────────────────────

  async addObject(graphId: string, obj: ObjectInput, eventId: string): Promise<GraphObject> {
    const id = genId('obj')
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO operad_objects (id, graph_id, type, data, created_at, updated_at, created_by_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, graphId, obj.type, JSON.stringify(obj.data), now, now, eventId)

    return { id, graphId, type: obj.type, data: obj.data as Record<string, JsonValue>, createdAt: now, updatedAt: now, createdByEventId: eventId }
  }

  async getObject(id: string): Promise<GraphObject | null> {
    const row = this.db.prepare('SELECT * FROM operad_objects WHERE id = ?').get(id) as ObjectRow | undefined
    return row ? rowToObject(row) : null
  }

  async patchObject(id: string, data: Record<string, JsonValue>, eventId: string): Promise<GraphObject> {
    const existing = await this.getObject(id)
    if (!existing) throw new Error(`Object not found: ${id}`)

    const merged = { ...existing.data, ...data }
    const now = new Date().toISOString()

    this.db.prepare(`
      UPDATE operad_objects SET data = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(merged), now, id)

    return { ...existing, data: merged, updatedAt: now }
  }

  async removeObject(id: string): Promise<void> {
    this.db.prepare('DELETE FROM operad_objects WHERE id = ?').run(id)
  }

  async queryObjects(graphId: string, filter: ObjectFilter): Promise<GraphObject[]> {
    let sql = 'SELECT * FROM operad_objects WHERE graph_id = ?'
    const params: unknown[] = [graphId]

    if (filter.type) {
      sql += ' AND type = ?'
      params.push(filter.type)
    }

    const rows = this.db.prepare(sql).all(...params) as ObjectRow[]
    let results = rows.map(rowToObject)

    // Manual data matching (SQLite doesn't have @> operator)
    if (filter.dataMatch) {
      results = results.filter((obj) => {
        for (const [key, value] of Object.entries(filter.dataMatch!)) {
          if (JSON.stringify(obj.data[key]) !== JSON.stringify(value)) return false
        }
        return true
      })
    }

    return results
  }

  // ─── Relations ─────────────────────────────────────────────────────

  async addRelation(graphId: string, rel: RelationInput, eventId: string): Promise<GraphRelation> {
    const id = genId('rel')
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO operad_relations (id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, graphId, rel.sourceId, rel.targetId, rel.type, JSON.stringify(rel.data ?? {}), now, eventId)

    return { id, graphId, sourceId: rel.sourceId, targetId: rel.targetId, type: rel.type, data: (rel.data ?? {}) as Record<string, JsonValue>, createdAt: now, createdByEventId: eventId }
  }

  async getRelation(id: string): Promise<GraphRelation | null> {
    const row = this.db.prepare('SELECT * FROM operad_relations WHERE id = ?').get(id) as RelationRow | undefined
    return row ? rowToRelation(row) : null
  }

  async removeRelation(id: string): Promise<void> {
    this.db.prepare('DELETE FROM operad_relations WHERE id = ?').run(id)
  }

  async queryRelations(graphId: string, filter: RelationFilter): Promise<GraphRelation[]> {
    let sql = 'SELECT * FROM operad_relations WHERE graph_id = ?'
    const params: unknown[] = [graphId]

    if (filter.type) { sql += ' AND type = ?'; params.push(filter.type) }
    if (filter.sourceId) { sql += ' AND source_id = ?'; params.push(filter.sourceId) }
    if (filter.targetId) { sql += ' AND target_id = ?'; params.push(filter.targetId) }

    const rows = this.db.prepare(sql).all(...params) as RelationRow[]
    return rows.map(rowToRelation)
  }

  // ─── Decisions ─────────────────────────────────────────────────────

  async recordDecision(graphId: string, eventId: string, decision: DecisionInput): Promise<Decision> {
    const id = genId('dec')
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO operad_decisions (id, event_id, graph_id, selected_action, alternatives, confidence, reasoning, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, eventId, graphId,
      decision.selectedAction,
      JSON.stringify(decision.alternatives ?? []),
      decision.confidence,
      decision.reasoning,
      now
    )

    return { id, eventId, graphId, selectedAction: decision.selectedAction, alternatives: decision.alternatives ?? [], confidence: decision.confidence, reasoning: decision.reasoning, timestamp: now }
  }

  async queryDecisions(graphId: string, filter: DecisionFilter): Promise<Decision[]> {
    let sql = 'SELECT * FROM operad_decisions WHERE graph_id = ?'
    const params: unknown[] = [graphId]

    if (filter.minConfidence !== undefined) {
      sql += ' AND confidence >= ?'
      params.push(filter.minConfidence)
    }

    sql += ' ORDER BY timestamp ASC'
    const rows = this.db.prepare(sql).all(...params) as DecisionRow[]
    return rows.map(rowToDecision)
  }

  // ─── Health ────────────────────────────────────────────────────────

  async updateHealth(objectId: string, update: HealthUpdate): Promise<HealthRecord> {
    const now = new Date().toISOString()
    const success = update.success ? 1 : 0
    const failure = update.success ? 0 : 1

    this.db.prepare(`
      INSERT INTO operad_health (object_id, last_verified_at, verification_count, success_count, failure_count, success_rate)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(object_id) DO UPDATE SET
        last_verified_at = ?,
        verification_count = verification_count + 1,
        success_count = success_count + ?,
        failure_count = failure_count + ?,
        success_rate = CAST((success_count + ?) AS REAL) / (verification_count + 1),
        stale_since = NULL
    `).run(
      objectId, now, success, failure, success ? 1.0 : 0.0,
      now, success, failure, success
    )

    const row = this.db.prepare('SELECT * FROM operad_health WHERE object_id = ?').get(objectId) as HealthRow
    return rowToHealth(row)
  }

  async getStaleObjects(graphId: string, thresholdDays: number): Promise<GraphObject[]> {
    const cutoff = new Date(Date.now() - thresholdDays * 86400000).toISOString()

    const rows = this.db.prepare(`
      SELECT o.* FROM operad_objects o
      JOIN operad_health h ON o.id = h.object_id
      WHERE o.graph_id = ? AND h.last_verified_at < ?
    `).all(graphId, cutoff) as ObjectRow[]

    return rows.map(rowToObject)
  }

  // ─── Branching ─────────────────────────────────────────────────────

  async copyEventsUpTo(sourceGraphId: string, targetGraphId: string, eventId: string): Promise<number> {
    const cutpoint = this.db.prepare(
      'SELECT timestamp FROM operad_events WHERE id = ? AND graph_id = ?'
    ).get(eventId, sourceGraphId) as { timestamp: string } | undefined

    if (!cutpoint) throw new Error(`Cutpoint event not found: ${eventId}`)

    // Copy events up to cutpoint
    const events = this.db.prepare(`
      SELECT * FROM operad_events
      WHERE graph_id = ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(sourceGraphId, cutpoint.timestamp) as EventRow[]

    const insertEvent = this.db.prepare(`
      INSERT INTO operad_events (id, graph_id, type, payload, caused_by, timestamp, actor)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    let count = 0
    const txn = this.db.transaction(() => {
      for (const row of events) {
        const newId = genId('evt')
        insertEvent.run(newId, targetGraphId, row.type, row.payload, row.caused_by, row.timestamp, row.actor)
        count++
        if (row.id === eventId) break
      }

      // Copy objects
      const objects = this.db.prepare('SELECT * FROM operad_objects WHERE graph_id = ?').all(sourceGraphId) as ObjectRow[]
      const insertObj = this.db.prepare(`
        INSERT INTO operad_objects (id, graph_id, type, data, created_at, updated_at, created_by_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const obj of objects) {
        insertObj.run(genId('obj'), targetGraphId, obj.type, obj.data, obj.created_at, obj.updated_at, obj.created_by_event_id)
      }

      // Copy relations
      const relations = this.db.prepare('SELECT * FROM operad_relations WHERE graph_id = ?').all(sourceGraphId) as RelationRow[]
      const insertRel = this.db.prepare(`
        INSERT INTO operad_relations (id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const rel of relations) {
        insertRel.run(genId('rel'), targetGraphId, rel.source_id, rel.target_id, rel.type, rel.data, rel.created_at, rel.created_by_event_id)
      }
    })

    txn()
    return count
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  close(): void {
    this.db.close()
  }
}

// ─── Row Types & Mappers ─────────────────────────────────────────────

interface EventRow { id: string; graph_id: string; type: string; payload: string; caused_by: string | null; timestamp: string; actor: string | null }
interface ObjectRow { id: string; graph_id: string; type: string; data: string; created_at: string; updated_at: string; created_by_event_id: string }
interface RelationRow { id: string; graph_id: string; source_id: string; target_id: string; type: string; data: string; created_at: string; created_by_event_id: string }
interface DecisionRow { id: string; event_id: string; graph_id: string; selected_action: string; alternatives: string; confidence: number; reasoning: string; timestamp: string }
interface HealthRow { object_id: string; last_verified_at: string; verification_count: number; success_count: number; failure_count: number; success_rate: number; stale_since: string | null }

function rowToEvent(row: EventRow): GraphEvent {
  return {
    id: row.id,
    graphId: row.graph_id,
    type: row.type as GraphEvent['type'],
    payload: JSON.parse(row.payload),
    causedBy: row.caused_by ?? null,
    timestamp: row.timestamp,
    actor: row.actor ?? undefined,
  }
}

function rowToObject(row: ObjectRow): GraphObject {
  return {
    id: row.id,
    graphId: row.graph_id,
    type: row.type,
    data: JSON.parse(row.data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByEventId: row.created_by_event_id,
  }
}

function rowToRelation(row: RelationRow): GraphRelation {
  return {
    id: row.id,
    graphId: row.graph_id,
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.type,
    data: JSON.parse(row.data),
    createdAt: row.created_at,
    createdByEventId: row.created_by_event_id,
  }
}

function rowToDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    eventId: row.event_id,
    graphId: row.graph_id,
    selectedAction: row.selected_action,
    alternatives: JSON.parse(row.alternatives),
    confidence: row.confidence,
    reasoning: row.reasoning,
    timestamp: row.timestamp,
  }
}

function rowToHealth(row: HealthRow): HealthRecord {
  return {
    objectId: row.object_id,
    lastVerifiedAt: row.last_verified_at,
    verificationCount: row.verification_count,
    successCount: row.success_count,
    failureCount: row.failure_count,
    successRate: row.success_rate,
    staleSince: row.stale_since ?? null,
  }
}
