import type {
  StorageAdapter,
  GraphObject,
  ObjectInput,
  ObjectFilter,
  GraphRelation,
  RelationInput,
  RelationFilter,
  GraphEvent,
  EventInput,
  EventFilter,
  Decision,
  DecisionInput,
  DecisionFilter,
  HealthRecord,
  HealthUpdate,
  JsonValue,
} from '@operad/core'
import postgres from 'postgres'
import { migrate } from './migrations.js'

let idCounter = 0
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`
}

export interface PostgresAdapterOptions {
  /** postgres.js connection string or options */
  connectionString: string
  /** Run migrations on init (default: true) */
  autoMigrate?: boolean
}

/**
 * Postgres StorageAdapter for production use.
 * Uses postgres.js for zero-dependency, high-performance queries.
 *
 * All tables are prefixed with `operad_` to avoid collisions
 * when sharing a database with your application.
 */
export class PostgresAdapter implements StorageAdapter {
  private sql: postgres.Sql
  private initialized: Promise<void>

  constructor(options: PostgresAdapterOptions) {
    this.sql = postgres(options.connectionString)
    this.initialized =
      options.autoMigrate !== false ? migrate(this.sql) : Promise.resolve()
  }

  private async ready(): Promise<void> {
    await this.initialized
  }

  /** Close the connection pool. Call when shutting down. */
  async close(): Promise<void> {
    await this.sql.end()
  }

  // ─── Objects ─────────────────────────────────────────────────────────

  async addObject(graphId: string, obj: ObjectInput, eventId: string): Promise<GraphObject> {
    await this.ready()
    const id = genId('obj')
    const now = new Date().toISOString()

    await this.sql`
      INSERT INTO operad_objects (id, graph_id, type, data, created_at, updated_at, created_by_event_id)
      VALUES (${id}, ${graphId}, ${obj.type}, ${JSON.stringify(obj.data)}, ${now}, ${now}, ${eventId})
    `

    return {
      id,
      graphId,
      type: obj.type,
      data: { ...obj.data },
      createdAt: now,
      updatedAt: now,
      createdByEventId: eventId,
    }
  }

  async getObject(id: string): Promise<GraphObject | null> {
    await this.ready()
    const rows = await this.sql`
      SELECT id, graph_id, type, data, created_at, updated_at, created_by_event_id
      FROM operad_objects WHERE id = ${id}
    `
    if (rows.length === 0) return null
    return this.rowToObject(rows[0])
  }

  async patchObject(id: string, data: Record<string, JsonValue>, eventId: string): Promise<GraphObject> {
    await this.ready()
    const now = new Date().toISOString()

    // Merge data using jsonb || operator
    const rows = await this.sql`
      UPDATE operad_objects
      SET data = data || ${JSON.stringify(data)}::jsonb,
          updated_at = ${now}
      WHERE id = ${id}
      RETURNING id, graph_id, type, data, created_at, updated_at, created_by_event_id
    `

    if (rows.length === 0) throw new Error(`Object not found: ${id}`)
    return this.rowToObject(rows[0])
  }

  async removeObject(id: string): Promise<void> {
    await this.ready()
    await this.sql`DELETE FROM operad_objects WHERE id = ${id}`
  }

  async queryObjects(graphId: string, filter: ObjectFilter): Promise<GraphObject[]> {
    await this.ready()

    let rows
    if (filter.type && filter.dataMatch) {
      rows = await this.sql`
        SELECT id, graph_id, type, data, created_at, updated_at, created_by_event_id
        FROM operad_objects
        WHERE graph_id = ${graphId}
          AND type = ${filter.type}
          AND data @> ${JSON.stringify(filter.dataMatch)}::jsonb
      `
    } else if (filter.type) {
      rows = await this.sql`
        SELECT id, graph_id, type, data, created_at, updated_at, created_by_event_id
        FROM operad_objects
        WHERE graph_id = ${graphId} AND type = ${filter.type}
      `
    } else if (filter.dataMatch) {
      rows = await this.sql`
        SELECT id, graph_id, type, data, created_at, updated_at, created_by_event_id
        FROM operad_objects
        WHERE graph_id = ${graphId}
          AND data @> ${JSON.stringify(filter.dataMatch)}::jsonb
      `
    } else {
      rows = await this.sql`
        SELECT id, graph_id, type, data, created_at, updated_at, created_by_event_id
        FROM operad_objects
        WHERE graph_id = ${graphId}
      `
    }

    return rows.map((r) => this.rowToObject(r))
  }

  // ─── Relations ───────────────────────────────────────────────────────

  async addRelation(graphId: string, rel: RelationInput, eventId: string): Promise<GraphRelation> {
    await this.ready()
    const id = genId('rel')
    const now = new Date().toISOString()
    const data = rel.data ?? {}

    await this.sql`
      INSERT INTO operad_relations (id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id)
      VALUES (${id}, ${graphId}, ${rel.sourceId}, ${rel.targetId}, ${rel.type}, ${JSON.stringify(data)}, ${now}, ${eventId})
    `

    return {
      id,
      graphId,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      type: rel.type,
      data,
      createdAt: now,
      createdByEventId: eventId,
    }
  }

  async getRelation(id: string): Promise<GraphRelation | null> {
    await this.ready()
    const rows = await this.sql`
      SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
      FROM operad_relations WHERE id = ${id}
    `
    if (rows.length === 0) return null
    return this.rowToRelation(rows[0])
  }

  async removeRelation(id: string): Promise<void> {
    await this.ready()
    await this.sql`DELETE FROM operad_relations WHERE id = ${id}`
  }

  async queryRelations(graphId: string, filter: RelationFilter): Promise<GraphRelation[]> {
    await this.ready()

    // Build dynamic WHERE conditions
    const conditions: string[] = [`graph_id = '${graphId}'`]
    if (filter.type) conditions.push(`type = '${filter.type}'`)
    if (filter.sourceId) conditions.push(`source_id = '${filter.sourceId}'`)
    if (filter.targetId) conditions.push(`target_id = '${filter.targetId}'`)

    // Use parameterized queries for safety
    let rows
    if (filter.type && filter.sourceId && filter.targetId) {
      rows = await this.sql`
        SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
        FROM operad_relations
        WHERE graph_id = ${graphId} AND type = ${filter.type}
          AND source_id = ${filter.sourceId} AND target_id = ${filter.targetId}
      `
    } else if (filter.type && filter.sourceId) {
      rows = await this.sql`
        SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
        FROM operad_relations
        WHERE graph_id = ${graphId} AND type = ${filter.type} AND source_id = ${filter.sourceId}
      `
    } else if (filter.type && filter.targetId) {
      rows = await this.sql`
        SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
        FROM operad_relations
        WHERE graph_id = ${graphId} AND type = ${filter.type} AND target_id = ${filter.targetId}
      `
    } else if (filter.sourceId && filter.targetId) {
      rows = await this.sql`
        SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
        FROM operad_relations
        WHERE graph_id = ${graphId} AND source_id = ${filter.sourceId} AND target_id = ${filter.targetId}
      `
    } else if (filter.type) {
      rows = await this.sql`
        SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
        FROM operad_relations
        WHERE graph_id = ${graphId} AND type = ${filter.type}
      `
    } else if (filter.sourceId) {
      rows = await this.sql`
        SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
        FROM operad_relations
        WHERE graph_id = ${graphId} AND source_id = ${filter.sourceId}
      `
    } else if (filter.targetId) {
      rows = await this.sql`
        SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
        FROM operad_relations
        WHERE graph_id = ${graphId} AND target_id = ${filter.targetId}
      `
    } else {
      rows = await this.sql`
        SELECT id, graph_id, source_id, target_id, type, data, created_at, created_by_event_id
        FROM operad_relations
        WHERE graph_id = ${graphId}
      `
    }

    return rows.map((r) => this.rowToRelation(r))
  }

  // ─── Events ─────────────────────────────────────────────────────────

  async appendEvent(graphId: string, input: EventInput): Promise<GraphEvent> {
    await this.ready()
    const id = genId('evt')
    const now = new Date().toISOString()
    const causedBy = input.causedBy ?? null

    const actor = input.actor ?? null

    await this.sql`
      INSERT INTO operad_events (id, graph_id, type, payload, caused_by, timestamp, actor)
      VALUES (${id}, ${graphId}, ${input.type}, ${JSON.stringify(input.payload)}, ${causedBy}, ${now}, ${actor})
    `

    return {
      id,
      graphId,
      type: input.type,
      payload: { ...input.payload },
      causedBy,
      timestamp: now,
      ...(input.actor !== undefined && { actor: input.actor }),
    }
  }

  async queryEvents(graphId: string, filter: EventFilter): Promise<GraphEvent[]> {
    await this.ready()

    // Build conditions based on filter
    let rows
    if (filter.type && filter.causedBy) {
      rows = await this.sql`
        SELECT id, graph_id, type, payload, caused_by, timestamp
        FROM operad_events
        WHERE graph_id = ${graphId} AND type = ${filter.type} AND caused_by = ${filter.causedBy}
        ORDER BY timestamp
      `
    } else if (filter.type) {
      rows = await this.sql`
        SELECT id, graph_id, type, payload, caused_by, timestamp
        FROM operad_events
        WHERE graph_id = ${graphId} AND type = ${filter.type}
          ${filter.after ? this.sql`AND timestamp > ${filter.after}` : this.sql``}
          ${filter.before ? this.sql`AND timestamp < ${filter.before}` : this.sql``}
        ORDER BY timestamp
      `
    } else if (filter.causedBy) {
      rows = await this.sql`
        SELECT id, graph_id, type, payload, caused_by, timestamp
        FROM operad_events
        WHERE graph_id = ${graphId} AND caused_by = ${filter.causedBy}
        ORDER BY timestamp
      `
    } else {
      rows = await this.sql`
        SELECT id, graph_id, type, payload, caused_by, timestamp
        FROM operad_events
        WHERE graph_id = ${graphId}
          ${filter.after ? this.sql`AND timestamp > ${filter.after}` : this.sql``}
          ${filter.before ? this.sql`AND timestamp < ${filter.before}` : this.sql``}
        ORDER BY timestamp
      `
    }

    return rows.map((r) => this.rowToEvent(r))
  }

  /** Walk backward: event → caused_by → caused_by → ... using recursive CTE */
  async getEventChain(eventId: string): Promise<GraphEvent[]> {
    await this.ready()

    const rows = await this.sql`
      WITH RECURSIVE chain AS (
        SELECT id, graph_id, type, payload, caused_by, timestamp, 0 AS depth
        FROM operad_events WHERE id = ${eventId}
        UNION ALL
        SELECT e.id, e.graph_id, e.type, e.payload, e.caused_by, e.timestamp, c.depth + 1
        FROM operad_events e
        JOIN chain c ON e.id = c.caused_by
      )
      SELECT id, graph_id, type, payload, caused_by, timestamp
      FROM chain
      ORDER BY depth
    `

    return rows.map((r) => this.rowToEvent(r))
  }

  /** Find all events caused (directly or transitively) by this event using recursive CTE */
  async getEventsTriggeredBy(eventId: string): Promise<GraphEvent[]> {
    await this.ready()

    const rows = await this.sql`
      WITH RECURSIVE descendants AS (
        SELECT id, graph_id, type, payload, caused_by, timestamp
        FROM operad_events WHERE caused_by = ${eventId}
        UNION ALL
        SELECT e.id, e.graph_id, e.type, e.payload, e.caused_by, e.timestamp
        FROM operad_events e
        JOIN descendants d ON e.caused_by = d.id
      )
      SELECT id, graph_id, type, payload, caused_by, timestamp
      FROM descendants
    `

    return rows.map((r) => this.rowToEvent(r))
  }

  // ─── Decisions ──────────────────────────────────────────────────────

  async recordDecision(graphId: string, eventId: string, input: DecisionInput): Promise<Decision> {
    await this.ready()
    const id = genId('dec')
    const now = new Date().toISOString()

    await this.sql`
      INSERT INTO operad_decisions (id, event_id, graph_id, selected_action, alternatives, confidence, reasoning, timestamp)
      VALUES (${id}, ${eventId}, ${graphId}, ${input.selectedAction}, ${JSON.stringify(input.alternatives)}, ${input.confidence}, ${input.reasoning}, ${now})
    `

    return {
      id,
      eventId,
      graphId,
      selectedAction: input.selectedAction,
      alternatives: [...input.alternatives],
      confidence: input.confidence,
      reasoning: input.reasoning,
      timestamp: now,
    }
  }

  async queryDecisions(graphId: string, filter: DecisionFilter): Promise<Decision[]> {
    await this.ready()

    const rows = await this.sql`
      SELECT id, event_id, graph_id, selected_action, alternatives, confidence, reasoning, timestamp
      FROM operad_decisions
      WHERE graph_id = ${graphId}
        ${filter.after ? this.sql`AND timestamp > ${filter.after}` : this.sql``}
        ${filter.before ? this.sql`AND timestamp < ${filter.before}` : this.sql``}
        ${filter.minConfidence !== undefined ? this.sql`AND confidence >= ${filter.minConfidence}` : this.sql``}
      ORDER BY timestamp
    `

    return rows.map((r) => this.rowToDecision(r))
  }

  // ─── Health ─────────────────────────────────────────────────────────

  async updateHealth(objectId: string, update: HealthUpdate): Promise<HealthRecord> {
    await this.ready()
    const now = new Date().toISOString()

    // Upsert: insert or update
    const existing = await this.sql`SELECT * FROM operad_health WHERE object_id = ${objectId}`

    let record: HealthRecord
    if (existing.length === 0) {
      record = {
        objectId,
        lastVerifiedAt: now,
        verificationCount: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 1,
        staleSince: null,
      }
    } else {
      record = {
        objectId: existing[0].object_id,
        lastVerifiedAt: new Date(existing[0].last_verified_at).toISOString(),
        verificationCount: existing[0].verification_count,
        successCount: existing[0].success_count,
        failureCount: existing[0].failure_count,
        successRate: parseFloat(existing[0].success_rate),
        staleSince: existing[0].stale_since ? new Date(existing[0].stale_since).toISOString() : null,
      }
    }

    if (update.verified) {
      record = {
        ...record,
        lastVerifiedAt: now,
        verificationCount: record.verificationCount + 1,
        staleSince: null,
      }
    }

    if (update.success !== undefined) {
      if (update.success) {
        record = { ...record, successCount: record.successCount + 1 }
      } else {
        record = { ...record, failureCount: record.failureCount + 1 }
      }
      const total = record.successCount + record.failureCount
      record = { ...record, successRate: total > 0 ? record.successCount / total : 1 }
    }

    // Upsert into Postgres
    await this.sql`
      INSERT INTO operad_health (object_id, last_verified_at, verification_count, success_count, failure_count, success_rate, stale_since)
      VALUES (${record.objectId}, ${record.lastVerifiedAt}, ${record.verificationCount}, ${record.successCount}, ${record.failureCount}, ${record.successRate}, ${record.staleSince})
      ON CONFLICT (object_id) DO UPDATE SET
        last_verified_at = ${record.lastVerifiedAt},
        verification_count = ${record.verificationCount},
        success_count = ${record.successCount},
        failure_count = ${record.failureCount},
        success_rate = ${record.successRate},
        stale_since = ${record.staleSince}
    `

    return record
  }

  async getStaleObjects(graphId: string, thresholdDays: number): Promise<GraphObject[]> {
    await this.ready()

    const rows = await this.sql`
      SELECT o.id, o.graph_id, o.type, o.data, o.created_at, o.updated_at, o.created_by_event_id
      FROM operad_objects o
      LEFT JOIN operad_health h ON o.id = h.object_id
      WHERE o.graph_id = ${graphId}
        AND (
          (h.object_id IS NULL AND o.updated_at < now() - ${thresholdDays + ' days'}::interval)
          OR
          (h.object_id IS NOT NULL AND h.last_verified_at < now() - ${thresholdDays + ' days'}::interval)
        )
    `

    return rows.map((r) => this.rowToObject(r))
  }

  // ─── Row Mappers ──────────────────────────────────────────────────

  private rowToObject(row: Record<string, unknown>): GraphObject {
    return {
      id: row.id as string,
      graphId: row.graph_id as string,
      type: row.type as string,
      data: (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, JsonValue>,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
      createdByEventId: row.created_by_event_id as string,
    }
  }

  private rowToRelation(row: Record<string, unknown>): GraphRelation {
    return {
      id: row.id as string,
      graphId: row.graph_id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      type: row.type as string,
      data: (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, JsonValue>,
      createdAt: new Date(row.created_at as string).toISOString(),
      createdByEventId: row.created_by_event_id as string,
    }
  }

  private rowToEvent(row: Record<string, unknown>): GraphEvent {
    const event: GraphEvent = {
      id: row.id as string,
      graphId: row.graph_id as string,
      type: row.type as GraphEvent['type'],
      payload: (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as Record<string, JsonValue>,
      causedBy: (row.caused_by as string | null) ?? null,
      timestamp: new Date(row.timestamp as string).toISOString(),
    }
    if (row.actor) event.actor = row.actor as string
    return event
  }

  private rowToDecision(row: Record<string, unknown>): Decision {
    return {
      id: row.id as string,
      eventId: row.event_id as string,
      graphId: row.graph_id as string,
      selectedAction: row.selected_action as string,
      alternatives: (typeof row.alternatives === 'string'
        ? JSON.parse(row.alternatives)
        : row.alternatives) as Decision['alternatives'],
      confidence: parseFloat(row.confidence as string),
      reasoning: row.reasoning as string,
      timestamp: new Date(row.timestamp as string).toISOString(),
    }
  }
}

export { migrate } from './migrations.js'
