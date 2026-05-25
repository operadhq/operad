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

let idCounter = 0
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`
}

/**
 * In-memory StorageAdapter backed by Maps.
 * Perfect for development, testing, and short-lived processes.
 *
 * Like working memory in the brain — fast, but doesn't survive a restart.
 */
export class MemoryAdapter implements StorageAdapter {
  private objects = new Map<string, GraphObject>()
  private relations = new Map<string, GraphRelation>()
  private events = new Map<string, GraphEvent>()
  private decisions = new Map<string, Decision>()
  private health = new Map<string, HealthRecord>()

  // Indexes for efficient querying
  private objectsByGraph = new Map<string, Set<string>>()
  private relationsByGraph = new Map<string, Set<string>>()
  private eventsByGraph = new Map<string, string[]>()
  private decisionsByGraph = new Map<string, string[]>()
  private eventsByCausedBy = new Map<string, string[]>()

  // ─── Objects ─────────────────────────────────────────────────────────

  async addObject(graphId: string, obj: ObjectInput, eventId: string): Promise<GraphObject> {
    const id = genId('obj')
    const now = new Date().toISOString()
    const graphObj: GraphObject = {
      id,
      graphId,
      type: obj.type,
      data: { ...obj.data },
      createdAt: now,
      updatedAt: now,
      createdByEventId: eventId,
    }
    this.objects.set(id, graphObj)
    this.indexAdd(this.objectsByGraph, graphId, id)
    return graphObj
  }

  async getObject(id: string): Promise<GraphObject | null> {
    return this.objects.get(id) ?? null
  }

  async patchObject(id: string, data: Record<string, JsonValue>, eventId: string): Promise<GraphObject> {
    const obj = this.objects.get(id)
    if (!obj) throw new Error(`Object not found: ${id}`)

    const patched: GraphObject = {
      ...obj,
      data: { ...obj.data, ...data },
      updatedAt: new Date().toISOString(),
    }
    this.objects.set(id, patched)
    return patched
  }

  async removeObject(id: string): Promise<void> {
    const obj = this.objects.get(id)
    if (!obj) return
    this.objects.delete(id)
    this.objectsByGraph.get(obj.graphId)?.delete(id)
  }

  async queryObjects(graphId: string, filter: ObjectFilter): Promise<GraphObject[]> {
    const ids = this.objectsByGraph.get(graphId)
    if (!ids) return []

    let results: GraphObject[] = []
    for (const id of ids) {
      const obj = this.objects.get(id)
      if (!obj) continue
      if (filter.type && obj.type !== filter.type) continue
      if (filter.dataMatch) {
        let matches = true
        for (const [key, value] of Object.entries(filter.dataMatch)) {
          if (JSON.stringify(obj.data[key]) !== JSON.stringify(value)) {
            matches = false
            break
          }
        }
        if (!matches) continue
      }
      results.push(obj)
    }
    return results
  }

  // ─── Relations ───────────────────────────────────────────────────────

  async addRelation(graphId: string, rel: RelationInput, eventId: string): Promise<GraphRelation> {
    const id = genId('rel')
    const now = new Date().toISOString()
    const graphRel: GraphRelation = {
      id,
      graphId,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      type: rel.type,
      data: rel.data ? { ...rel.data } : {},
      createdAt: now,
      createdByEventId: eventId,
    }
    this.relations.set(id, graphRel)
    this.indexAdd(this.relationsByGraph, graphId, id)
    return graphRel
  }

  async getRelation(id: string): Promise<GraphRelation | null> {
    return this.relations.get(id) ?? null
  }

  async removeRelation(id: string): Promise<void> {
    const rel = this.relations.get(id)
    if (!rel) return
    this.relations.delete(id)
    this.relationsByGraph.get(rel.graphId)?.delete(id)
  }

  async queryRelations(graphId: string, filter: RelationFilter): Promise<GraphRelation[]> {
    const ids = this.relationsByGraph.get(graphId)
    if (!ids) return []

    const results: GraphRelation[] = []
    for (const id of ids) {
      const rel = this.relations.get(id)
      if (!rel) continue
      if (filter.type && rel.type !== filter.type) continue
      if (filter.sourceId && rel.sourceId !== filter.sourceId) continue
      if (filter.targetId && rel.targetId !== filter.targetId) continue
      results.push(rel)
    }
    return results
  }

  // ─── Events ─────────────────────────────────────────────────────────

  async appendEvent(graphId: string, input: EventInput): Promise<GraphEvent> {
    const id = genId('evt')
    const event: GraphEvent = {
      id,
      graphId,
      type: input.type,
      payload: { ...input.payload },
      causedBy: input.causedBy ?? null,
      timestamp: new Date().toISOString(),
      ...(input.actor !== undefined && { actor: input.actor }),
    }
    this.events.set(id, event)

    if (!this.eventsByGraph.has(graphId)) {
      this.eventsByGraph.set(graphId, [])
    }
    this.eventsByGraph.get(graphId)!.push(id)

    // Index by causedBy for forward tracing
    if (event.causedBy) {
      if (!this.eventsByCausedBy.has(event.causedBy)) {
        this.eventsByCausedBy.set(event.causedBy, [])
      }
      this.eventsByCausedBy.get(event.causedBy)!.push(id)
    }

    return event
  }

  async queryEvents(graphId: string, filter: EventFilter): Promise<GraphEvent[]> {
    const ids = this.eventsByGraph.get(graphId)
    if (!ids) return []

    const results: GraphEvent[] = []
    for (const id of ids) {
      const event = this.events.get(id)
      if (!event) continue
      if (filter.type && event.type !== filter.type) continue
      if (filter.after && event.timestamp <= filter.after) continue
      if (filter.before && event.timestamp >= filter.before) continue
      if (filter.causedBy && event.causedBy !== filter.causedBy) continue
      results.push(event)
    }
    return results
  }

  /** Walk backward through the causal chain: event → caused_by → caused_by → ... */
  async getEventChain(eventId: string): Promise<GraphEvent[]> {
    const chain: GraphEvent[] = []
    let currentId: string | null = eventId

    while (currentId) {
      const event = this.events.get(currentId)
      if (!event) break
      chain.push(event)
      currentId = event.causedBy
    }

    return chain
  }

  /** Find all events caused (directly or transitively) by this event */
  async getEventsTriggeredBy(eventId: string): Promise<GraphEvent[]> {
    const result: GraphEvent[] = []
    const queue: string[] = [eventId]

    while (queue.length > 0) {
      const id = queue.shift()!
      const children = this.eventsByCausedBy.get(id)
      if (!children) continue

      for (const childId of children) {
        const event = this.events.get(childId)
        if (event) {
          result.push(event)
          queue.push(childId)
        }
      }
    }

    return result
  }

  // ─── Decisions ──────────────────────────────────────────────────────

  async recordDecision(graphId: string, eventId: string, input: DecisionInput): Promise<Decision> {
    const id = genId('dec')
    const decision: Decision = {
      id,
      eventId,
      graphId,
      selectedAction: input.selectedAction,
      alternatives: [...input.alternatives],
      confidence: input.confidence,
      reasoning: input.reasoning,
      timestamp: new Date().toISOString(),
    }
    this.decisions.set(id, decision)

    if (!this.decisionsByGraph.has(graphId)) {
      this.decisionsByGraph.set(graphId, [])
    }
    this.decisionsByGraph.get(graphId)!.push(id)

    return decision
  }

  async queryDecisions(graphId: string, filter: DecisionFilter): Promise<Decision[]> {
    const ids = this.decisionsByGraph.get(graphId)
    if (!ids) return []

    const results: Decision[] = []
    for (const id of ids) {
      const dec = this.decisions.get(id)
      if (!dec) continue
      if (filter.after && dec.timestamp <= filter.after) continue
      if (filter.before && dec.timestamp >= filter.before) continue
      if (filter.minConfidence !== undefined && dec.confidence < filter.minConfidence) continue
      results.push(dec)
    }
    return results
  }

  // ─── Health ─────────────────────────────────────────────────────────

  async updateHealth(objectId: string, update: HealthUpdate): Promise<HealthRecord> {
    let record = this.health.get(objectId)
    const now = new Date().toISOString()

    if (!record) {
      record = {
        objectId,
        lastVerifiedAt: now,
        verificationCount: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 1,
        staleSince: null,
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

    this.health.set(objectId, record)
    return record
  }

  async getStaleObjects(graphId: string, thresholdDays: number): Promise<GraphObject[]> {
    const threshold = new Date()
    threshold.setDate(threshold.getDate() - thresholdDays)
    const thresholdIso = threshold.toISOString()

    const ids = this.objectsByGraph.get(graphId)
    if (!ids) return []

    const stale: GraphObject[] = []
    for (const id of ids) {
      const obj = this.objects.get(id)
      if (!obj) continue

      const healthRecord = this.health.get(id)
      // Objects without health records that are old enough are stale
      if (!healthRecord) {
        if (obj.updatedAt < thresholdIso) {
          stale.push(obj)
        }
      } else if (healthRecord.lastVerifiedAt < thresholdIso) {
        stale.push(obj)
      }
    }

    return stale
  }

  // ─── Forking ──────────────────────────────────────────────────────

  async copyEventsUpTo(sourceGraphId: string, targetGraphId: string, eventId: string): Promise<number> {
    const sourceEventIds = this.eventsByGraph.get(sourceGraphId)
    if (!sourceEventIds) return 0

    let count = 0
    for (const id of sourceEventIds) {
      const event = this.events.get(id)
      if (!event) continue

      // Copy event with new ID into target graph
      const newId = genId('evt')
      const copied: GraphEvent = {
        ...event,
        id: newId,
        graphId: targetGraphId,
      }
      this.events.set(newId, copied)

      if (!this.eventsByGraph.has(targetGraphId)) {
        this.eventsByGraph.set(targetGraphId, [])
      }
      this.eventsByGraph.get(targetGraphId)!.push(newId)

      if (copied.causedBy) {
        if (!this.eventsByCausedBy.has(copied.causedBy)) {
          this.eventsByCausedBy.set(copied.causedBy, [])
        }
        this.eventsByCausedBy.get(copied.causedBy)!.push(newId)
      }

      count++

      // Stop after copying the cutpoint event
      if (id === eventId) break
    }

    // Copy objects from source graph into target graph
    const sourceObjIds = this.objectsByGraph.get(sourceGraphId)
    if (sourceObjIds) {
      for (const objId of sourceObjIds) {
        const obj = this.objects.get(objId)
        if (!obj) continue
        const newObjId = genId('obj')
        const copiedObj = { ...obj, id: newObjId, graphId: targetGraphId }
        this.objects.set(newObjId, copiedObj)
        this.indexAdd(this.objectsByGraph, targetGraphId, newObjId)
      }
    }

    // Copy relations from source graph into target graph
    const sourceRelIds = this.relationsByGraph.get(sourceGraphId)
    if (sourceRelIds) {
      for (const relId of sourceRelIds) {
        const rel = this.relations.get(relId)
        if (!rel) continue
        const newRelId = genId('rel')
        const copiedRel = { ...rel, id: newRelId, graphId: targetGraphId }
        this.relations.set(newRelId, copiedRel)
        this.indexAdd(this.relationsByGraph, targetGraphId, newRelId)
      }
    }

    return count
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private indexAdd(index: Map<string, Set<string>>, key: string, value: string): void {
    if (!index.has(key)) {
      index.set(key, new Set())
    }
    index.get(key)!.add(value)
  }
}
