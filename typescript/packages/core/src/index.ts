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
  // New types
  RelationBehaviorHandler,
  RelationBehaviorDef,
  ViewSpec,
  GraphView,
  PatternMatch,
  PatchStatus,
  PatchProposal,
  ProposeInput,
  ForkOptions,
  LLMProvider,
  LLMBehaviorDef,
} from './types.js'

// Runtime
export { createRuntime } from './runtime.js'

// Graph
export { Graph } from './graph.js'

// Behavior
export { behavior, matchesWhere, BehaviorRegistry } from './behavior.js'

// Relation Behavior
export { relationBehavior } from './relation-behavior.js'

// View
export { GraphViewImpl, resolveView } from './view.js'

// Pattern Matching
export { parsePattern, matchPattern } from './pattern.js'
export type { ParsedPattern } from './pattern.js'

// Patches + Policies
export { PatchRegistry } from './patch.js'

// LLM Behavior
export { llmBehavior } from './llm-behavior.js'

// Event Log
export { EventLog } from './event-log.js'

// Decision
export { DecisionLog } from './decision.js'

// Health
export { HealthTracker } from './health.js'
