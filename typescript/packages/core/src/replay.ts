import type {
  StorageAdapter,
  GraphAPI,
  GraphEvent,
  GraphObject,
  GraphRelation,
  ObjectInput,
  ObjectFilter,
  RelationInput,
  RelationFilter,
  EventInput,
  EventFilter,
  DecisionInput,
  DecisionFilter,
  Decision,
  HealthRecord,
  HealthUpdate,
  JsonValue,
} from './types.js'
import { Graph } from './graph.js'

// ─── Minimal in-memory storage for replay ───────────────────────────────────

let replayIdCounter = 0
function replayGenId(prefix: string): string {
  return `${prefix}_replay_${++replayIdCounter}`
}

class ReplayStorage implements StorageAdapter {
  objects = new Map<string, GraphObject>()
  relations = new Map<string, GraphRelation>()
  private objectsByGraph = new Map<string, Set<string>>()
  private relationsByGraph = new Map<string, Set<string>>()

  async addObject(graphId: string, obj: ObjectInput, eventId: string): Promise<GraphObject> {
    const id = replayGenId('obj')
    const now = new Date().toISOString()
    const graphObj: GraphObject = {
      id, graphId, type: obj.type, data: { ...obj.data },
      createdAt: now, updatedAt: now, createdByEventId: eventId,
    }
    this.objects.set(id, graphObj)
    if (!this.objectsByGraph.has(graphId)) this.objectsByGraph.set(graphId, new Set())
    this.objectsByGraph.get(graphId)!.add(id)
    return graphObj
  }

  async getObject(id: string): Promise<GraphObject | null> {
    return this.objects.get(id) ?? null
  }

  async patchObject(id: string, data: Record<string, JsonValue>, _eventId: string): Promise<GraphObject> {
    const obj = this.objects.get(id)
    if (!obj) throw new Error(`Replay: object not found: ${id}`)
    const patched = { ...obj, data: { ...obj.data, ...data }, updatedAt: new Date().toISOString() }
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
    const results: GraphObject[] = []
    for (const id of ids) {
      const obj = this.objects.get(id)
      if (!obj) continue
      if (filter.type && obj.type !== filter.type) continue
      if (filter.dataMatch) {
        let matches = true
        for (const [key, value] of Object.entries(filter.dataMatch)) {
          if (JSON.stringify(obj.data[key]) !== JSON.stringify(value)) { matches = false; break }
        }
        if (!matches) continue
      }
      results.push(obj)
    }
    return results
  }

  async addRelation(graphId: string, rel: RelationInput, eventId: string): Promise<GraphRelation> {
    const id = replayGenId('rel')
    const now = new Date().toISOString()
    const graphRel: GraphRelation = {
      id, graphId, sourceId: rel.sourceId, targetId: rel.targetId,
      type: rel.type, data: rel.data ? { ...rel.data } : {},
      createdAt: now, createdByEventId: eventId,
    }
    this.relations.set(id, graphRel)
    if (!this.relationsByGraph.has(graphId)) this.relationsByGraph.set(graphId, new Set())
    this.relationsByGraph.get(graphId)!.add(id)
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

  // Stubs — replay doesn't need these
  async appendEvent(_g: string, _i: EventInput): Promise<GraphEvent> { throw new Error('Replay storage is read-only for events') }
  async queryEvents(_g: string, _f: EventFilter): Promise<GraphEvent[]> { return [] }
  async getEventChain(_id: string): Promise<GraphEvent[]> { return [] }
  async getEventsTriggeredBy(_id: string): Promise<GraphEvent[]> { return [] }
  async recordDecision(_g: string, _e: string, _i: DecisionInput): Promise<Decision> { throw new Error('Not supported in replay') }
  async queryDecisions(_g: string, _f: DecisionFilter): Promise<Decision[]> { return [] }
  async updateHealth(_id: string, _u: HealthUpdate): Promise<HealthRecord> { throw new Error('Not supported in replay') }
  async getStaleObjects(_g: string, _d: number): Promise<GraphObject[]> { return [] }
}

// ─── Checkout (time-travel) ─────────────────────────────────────────────────

/**
 * Replay the event log up to a specific event, reconstructing
 * the graph state at that point in time.
 *
 * Strategy for ID mapping:
 * - Pre-scan the FULL event log to build a mapping of which object.created
 *   event produced which objectId (by looking at subsequent object.patched
 *   events that reference the objectId and tracing back to the creating event).
 * - During replay, translate all objectId references using this mapping.
 */
export async function checkout(
  graphId: string,
  eventId: string,
  sourceStorage: StorageAdapter
): Promise<GraphAPI> {
  const allEvents = await sourceStorage.queryEvents(graphId, {})
  const cutoffIndex = allEvents.findIndex((e) => e.id === eventId)
  if (cutoffIndex === -1) {
    throw new Error(`Event not found: ${eventId} in graph ${graphId}`)
  }
  const eventsToReplay = allEvents.slice(0, cutoffIndex + 1)

  // Build: originalObjectId → creatingEventId
  // We know this from live objects (via createdByEventId) + from the event sequence
  const originalIdByCreatingEvent = new Map<string, string>()

  // From live objects in the source storage
  const liveObjects = await sourceStorage.queryObjects(graphId, {})
  for (const obj of liveObjects) {
    originalIdByCreatingEvent.set(obj.createdByEventId, obj.id)
  }

  // For removed objects: scan the full event log.
  // When we see object.patched/removed with an objectId, and we see an
  // object.created event just before it that isn't mapped yet, we can infer the link.
  // Better approach: track the LAST unmapped object.created event, and when we see
  // the first object.patched/removed for an unknown ID, link them.
  const unmappedCreates: string[] = [] // event IDs of object.created events without a known objectId
  const knownObjectIds = new Set(liveObjects.map(o => o.id))

  for (const event of allEvents) {
    if (event.type === 'object.created') {
      if (!originalIdByCreatingEvent.has(event.id)) {
        unmappedCreates.push(event.id)
      }
    } else if (event.type === 'object.patched' || event.type === 'object.removed') {
      const objId = event.payload.objectId as string
      if (!knownObjectIds.has(objId)) {
        // This objectId was removed (not in live objects).
        // Link it to the most recent unmapped object.created event.
        // This works because events are ordered and each create precedes its patches.
        if (unmappedCreates.length > 0) {
          const creatingEventId = unmappedCreates.shift()!
          originalIdByCreatingEvent.set(creatingEventId, objId)
          knownObjectIds.add(objId)
        }
      }
    }
  }

  // Replay
  const replayStorage = new ReplayStorage()
  const replayGraph = new Graph(graphId, replayStorage)
  const objectIdMap = new Map<string, string>() // original → replayed

  for (const event of eventsToReplay) {
    switch (event.type) {
      case 'object.created': {
        const objectType = event.payload.objectType as string
        const data = (event.payload.data as Record<string, JsonValue>) ?? {}
        const replayedObj = await replayStorage.addObject(graphId, { type: objectType, data }, event.id)
        const originalId = originalIdByCreatingEvent.get(event.id)
        if (originalId) {
          objectIdMap.set(originalId, replayedObj.id)
        }
        break
      }

      case 'object.patched': {
        const originalId = event.payload.objectId as string
        const patch = (event.payload.patch as Record<string, JsonValue>) ?? {}
        const replayedId = objectIdMap.get(originalId) ?? originalId
        try {
          await replayStorage.patchObject(replayedId, patch, event.id)
        } catch { /* Object may not exist in replay window */ }
        break
      }

      case 'object.removed': {
        const originalId = event.payload.objectId as string
        const replayedId = objectIdMap.get(originalId) ?? originalId
        await replayStorage.removeObject(replayedId)
        break
      }

      case 'relation.created': {
        const sourceId = event.payload.sourceId as string
        const targetId = event.payload.targetId as string
        const relationType = event.payload.relationType as string
        const replayedSourceId = objectIdMap.get(sourceId) ?? sourceId
        const replayedTargetId = objectIdMap.get(targetId) ?? targetId
        await replayStorage.addRelation(
          graphId,
          { sourceId: replayedSourceId, targetId: replayedTargetId, type: relationType },
          event.id
        )
        break
      }

      case 'relation.removed': {
        const relId = event.payload.relationId as string
        await replayStorage.removeRelation(relId)
        break
      }

      default:
        break
    }
  }

  return replayGraph
}
