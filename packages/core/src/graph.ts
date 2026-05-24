import type {
  StorageAdapter,
  GraphAPI,
  GraphObject,
  GraphRelation,
  ObjectInput,
  ObjectFilter,
  RelationFilter,
  DecisionInput,
  Decision,
  DecisionFilter,
  GraphEvent,
  EventInput,
  JsonValue,
} from './types.js'
import { EventLog } from './event-log.js'

/**
 * Graph: high-level API over objects + relations + events.
 * Every mutation emits an event, creating a complete audit trail.
 */
export class Graph implements GraphAPI {
  private eventLog: EventLog

  constructor(
    public readonly id: string,
    private storage: StorageAdapter,
    private emitFn?: (graphId: string, input: EventInput) => Promise<GraphEvent>
  ) {
    this.eventLog = new EventLog(id, storage)
  }

  private async emit(input: EventInput): Promise<GraphEvent> {
    if (this.emitFn) {
      return this.emitFn(this.id, input)
    }
    return this.eventLog.append(input)
  }

  // ─── Objects ─────────────────────────────────────────────────────────

  async addObject(input: ObjectInput): Promise<GraphObject> {
    const event = await this.emit({
      type: 'object.created',
      payload: { objectType: input.type, data: input.data as Record<string, JsonValue> },
    })
    return this.storage.addObject(this.id, input, event.id)
  }

  async getObject(id: string): Promise<GraphObject | null> {
    return this.storage.getObject(id)
  }

  async patchObject(id: string, data: Record<string, JsonValue>): Promise<GraphObject> {
    const event = await this.emit({
      type: 'object.patched',
      payload: { objectId: id, patch: data as Record<string, JsonValue> },
    })
    return this.storage.patchObject(id, data, event.id)
  }

  async removeObject(id: string): Promise<void> {
    await this.emit({
      type: 'object.removed',
      payload: { objectId: id },
    })
    return this.storage.removeObject(id)
  }

  async queryObjects(filter: ObjectFilter = {}): Promise<GraphObject[]> {
    return this.storage.queryObjects(this.id, filter)
  }

  // ─── Relations ───────────────────────────────────────────────────────

  async addRelation(
    sourceId: string,
    targetId: string,
    type: string,
    data: Record<string, JsonValue> = {}
  ): Promise<GraphRelation> {
    const event = await this.emit({
      type: 'relation.created',
      payload: { sourceId, targetId, relationType: type },
    })
    return this.storage.addRelation(this.id, { sourceId, targetId, type, data }, event.id)
  }

  async getRelation(id: string): Promise<GraphRelation | null> {
    return this.storage.getRelation(id)
  }

  async removeRelation(id: string): Promise<void> {
    await this.emit({
      type: 'relation.removed',
      payload: { relationId: id },
    })
    return this.storage.removeRelation(id)
  }

  async queryRelations(filter: RelationFilter = {}): Promise<GraphRelation[]> {
    return this.storage.queryRelations(this.id, filter)
  }

  // ─── Event Tracing ──────────────────────────────────────────────────

  async traceBackward(eventId: string): Promise<GraphEvent[]> {
    return this.eventLog.traceBackward(eventId)
  }

  async traceForward(eventId: string): Promise<GraphEvent[]> {
    return this.eventLog.traceForward(eventId)
  }

  // ─── Health ─────────────────────────────────────────────────────────

  async getStaleObjects(opts: { thresholdDays: number }): Promise<GraphObject[]> {
    return this.storage.getStaleObjects(this.id, opts.thresholdDays)
  }

  // ─── Decisions ──────────────────────────────────────────────────────

  async recordDecision(input: DecisionInput): Promise<Decision> {
    const event = await this.emit({
      type: 'decision.recorded',
      payload: {
        selectedAction: input.selectedAction,
        confidence: input.confidence,
        reasoning: input.reasoning,
      },
    })
    return this.storage.recordDecision(this.id, event.id, input)
  }

  async queryDecisions(filter: DecisionFilter = {}): Promise<Decision[]> {
    return this.storage.queryDecisions(this.id, filter)
  }
}
