// ─── Public API ──────────────────────────────────────────────────────────────

// Types
export type {
  JsonValue,
  JsonPrimitive,
  GraphObject,
  ObjectInput,
  ObjectFilter,
  GraphRelation,
  RelationInput,
  RelationFilter,
  EventType,
  GraphEvent,
  EventInput,
  EventFilter,
  Alternative,
  Decision,
  DecisionInput,
  DecisionFilter,
  HealthRecord,
  HealthUpdate,
  BehaviorContext,
  BehaviorHandler,
  WhereClause,
  BehaviorDef,
  GraphAPI,
  Runtime,
  RuntimeOptions,
  StorageAdapter,
} from './types.js'

// Runtime
export { createRuntime } from './runtime.js'

// Graph
export { Graph } from './graph.js'

// Behavior
export { behavior, matchesWhere, BehaviorRegistry } from './behavior.js'

// Event Log
export { EventLog } from './event-log.js'

// Decision
export { DecisionLog } from './decision.js'

// Health
export { HealthTracker } from './health.js'
