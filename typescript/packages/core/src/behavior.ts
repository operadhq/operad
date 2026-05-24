import type { BehaviorDef, GraphEvent, JsonValue, WhereClause } from './types.js'

/**
 * Create a behavior definition. Behaviors subscribe to event types
 * and run handlers when matching events are emitted.
 */
export function behavior(def: BehaviorDef): BehaviorDef {
  return def
}

/**
 * Check if an event matches a behavior's `where` clause.
 * Supports dot-path matching into event payload.
 *
 * Example: { 'payload.reason': 'selector_not_found' }
 * matches event.payload.reason === 'selector_not_found'
 */
export function matchesWhere(event: GraphEvent, where?: WhereClause): boolean {
  if (!where) return true

  for (const [path, expected] of Object.entries(where)) {
    const actual = getNestedValue(event as unknown as Record<string, unknown>, path)
    if (actual !== expected) return false
  }

  return true
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * BehaviorRegistry holds all registered behaviors and finds matching ones for events.
 */
export class BehaviorRegistry {
  private behaviors: BehaviorDef[] = []

  register(def: BehaviorDef): void {
    this.behaviors.push(def)
  }

  /** Find all behaviors that match the given event */
  match(event: GraphEvent): BehaviorDef[] {
    return this.behaviors.filter(
      (b) => b.on.includes(event.type) && matchesWhere(event, b.where)
    )
  }

  getAll(): BehaviorDef[] {
    return [...this.behaviors]
  }
}
