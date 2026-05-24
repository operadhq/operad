// ─── Primitive Values ─────────────────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

// ─── Graph Objects (Nodes) ───────────────────────────────────────────────────

export interface GraphObject {
  id: string
  graphId: string
  type: string
  data: Record<string, JsonValue>
  createdAt: string      // ISO 8601
  updatedAt: string      // ISO 8601
  createdByEventId: string
}

export interface ObjectInput {
  type: string
  data: Record<string, JsonValue>
}

export interface ObjectFilter {
  type?: string
  /** Shallow key match on data */
  dataMatch?: Record<string, JsonValue>
}

// ─── Graph Relations (Edges) ─────────────────────────────────────────────────

export interface GraphRelation {
  id: string
  graphId: string
  sourceId: string
  targetId: string
  type: string
  data: Record<string, JsonValue>
  createdAt: string
  createdByEventId: string
}

export interface RelationInput {
  sourceId: string
  targetId: string
  type: string
  data?: Record<string, JsonValue>
}

export interface RelationFilter {
  type?: string
  sourceId?: string
  targetId?: string
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type EventType =
  // Lifecycle
  | 'graph.created'
  | 'goal.set'
  | 'runtime.idle'
  // Graph mutations
  | 'object.created'
  | 'object.patched'
  | 'object.removed'
  | 'relation.created'
  | 'relation.removed'
  // Behaviors
  | 'behavior.triggered'
  | 'behavior.completed'
  | 'behavior.failed'
  // Decisions
  | 'decision.recorded'
  // Health
  | 'object.verified'
  | 'object.stale'
  // Custom
  | `custom.${string}`

export interface GraphEvent {
  id: string
  graphId: string
  type: EventType
  payload: Record<string, JsonValue>
  causedBy: string | null   // parent event ID for causal chain
  timestamp: string          // ISO 8601
}

export interface EventInput {
  type: EventType
  payload: Record<string, JsonValue>
  causedBy?: string | null
}

export interface EventFilter {
  type?: EventType
  after?: string    // ISO timestamp
  before?: string   // ISO timestamp
  causedBy?: string
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export interface Alternative {
  action: string
  rejected: string   // reason for rejection
}

export interface Decision {
  id: string
  eventId: string
  graphId: string
  selectedAction: string
  alternatives: Alternative[]
  confidence: number
  reasoning: string
  timestamp: string
}

export interface DecisionInput {
  selectedAction: string
  alternatives: Alternative[]
  confidence: number
  reasoning: string
}

export interface DecisionFilter {
  after?: string
  before?: string
  minConfidence?: number
}

// ─── Health ──────────────────────────────────────────────────────────────────

export interface HealthRecord {
  objectId: string
  lastVerifiedAt: string
  verificationCount: number
  successCount: number
  failureCount: number
  successRate: number
  staleSince: string | null    // set when object goes stale
}

export interface HealthUpdate {
  verified?: boolean
  success?: boolean
}

// ─── Behaviors ───────────────────────────────────────────────────────────────

export interface BehaviorContext {
  graphId: string
  emit: (input: EventInput) => Promise<GraphEvent>
}

export type BehaviorHandler = (
  event: GraphEvent,
  graph: GraphAPI,
  ctx: BehaviorContext
) => Promise<void>

export interface WhereClause {
  [path: string]: JsonValue
}

export interface BehaviorDef {
  name: string
  on: EventType[]
  where?: WhereClause
  handler: BehaviorHandler
}

// ─── Graph API (high-level operations) ───────────────────────────────────────

export interface GraphAPI {
  id: string
  addObject(input: ObjectInput): Promise<GraphObject>
  getObject(id: string): Promise<GraphObject | null>
  patchObject(id: string, data: Record<string, JsonValue>): Promise<GraphObject>
  removeObject(id: string): Promise<void>
  queryObjects(filter?: ObjectFilter): Promise<GraphObject[]>

  addRelation(sourceId: string, targetId: string, type: string, data?: Record<string, JsonValue>): Promise<GraphRelation>
  getRelation(id: string): Promise<GraphRelation | null>
  removeRelation(id: string): Promise<void>
  queryRelations(filter?: RelationFilter): Promise<GraphRelation[]>

  traceBackward(eventId: string): Promise<GraphEvent[]>
  traceForward(eventId: string): Promise<GraphEvent[]>

  getStaleObjects(opts: { thresholdDays: number }): Promise<GraphObject[]>

  recordDecision(input: DecisionInput): Promise<Decision>
  queryDecisions(filter?: DecisionFilter): Promise<Decision[]>
}

// ─── Runtime ─────────────────────────────────────────────────────────────────

export interface RuntimeOptions {
  storage: StorageAdapter
  behaviors?: BehaviorDef[]
}

export interface Runtime {
  createGraph(id: string): Promise<GraphAPI>
  getGraph(id: string): GraphAPI
  registerBehavior(def: BehaviorDef): void
  emit(graphId: string, input: EventInput): Promise<GraphEvent>
}

// ─── Storage Adapter ─────────────────────────────────────────────────────────

export interface StorageAdapter {
  // Objects
  addObject(graphId: string, obj: ObjectInput, eventId: string): Promise<GraphObject>
  getObject(id: string): Promise<GraphObject | null>
  patchObject(id: string, data: Record<string, JsonValue>, eventId: string): Promise<GraphObject>
  removeObject(id: string): Promise<void>
  queryObjects(graphId: string, filter: ObjectFilter): Promise<GraphObject[]>

  // Relations
  addRelation(graphId: string, rel: RelationInput, eventId: string): Promise<GraphRelation>
  getRelation(id: string): Promise<GraphRelation | null>
  removeRelation(id: string): Promise<void>
  queryRelations(graphId: string, filter: RelationFilter): Promise<GraphRelation[]>

  // Events
  appendEvent(graphId: string, event: EventInput): Promise<GraphEvent>
  queryEvents(graphId: string, filter: EventFilter): Promise<GraphEvent[]>
  getEventChain(eventId: string): Promise<GraphEvent[]>
  getEventsTriggeredBy(eventId: string): Promise<GraphEvent[]>

  // Decisions
  recordDecision(graphId: string, eventId: string, decision: DecisionInput): Promise<Decision>
  queryDecisions(graphId: string, filter: DecisionFilter): Promise<Decision[]>

  // Health
  updateHealth(objectId: string, update: HealthUpdate): Promise<HealthRecord>
  getStaleObjects(graphId: string, thresholdDays: number): Promise<GraphObject[]>
}
