import { describe, it, expect } from 'vitest'
import { behavior, matchesWhere, BehaviorRegistry } from '../src/behavior.js'
import type { GraphEvent } from '../src/types.js'

function makeEvent(overrides: Partial<GraphEvent> = {}): GraphEvent {
  return {
    id: 'evt_1',
    graphId: 'test',
    type: 'object.created',
    payload: {},
    causedBy: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe('behavior()', () => {
  it('should create a behavior definition', () => {
    const def = behavior({
      name: 'test',
      on: ['object.created'],
      handler: async () => {},
    })

    expect(def.name).toBe('test')
    expect(def.on).toEqual(['object.created'])
  })
})

describe('matchesWhere()', () => {
  it('should match when no where clause', () => {
    const event = makeEvent()
    expect(matchesWhere(event, undefined)).toBe(true)
  })

  it('should match top-level fields', () => {
    const event = makeEvent({ type: 'object.created' })
    expect(matchesWhere(event, { type: 'object.created' })).toBe(true)
    expect(matchesWhere(event, { type: 'object.removed' })).toBe(false)
  })

  it('should match nested payload fields', () => {
    const event = makeEvent({
      payload: { reason: 'selector_not_found', objectType: 'claim' },
    })

    expect(matchesWhere(event, { 'payload.reason': 'selector_not_found' })).toBe(true)
    expect(matchesWhere(event, { 'payload.reason': 'timeout' })).toBe(false)
  })

  it('should match multiple conditions (AND)', () => {
    const event = makeEvent({
      type: 'behavior.failed',
      payload: { reason: 'selector_not_found', behaviorName: 'scraper' },
    })

    expect(
      matchesWhere(event, {
        type: 'behavior.failed',
        'payload.reason': 'selector_not_found',
      })
    ).toBe(true)

    expect(
      matchesWhere(event, {
        type: 'behavior.failed',
        'payload.reason': 'timeout',
      })
    ).toBe(false)
  })

  it('should handle missing nested paths', () => {
    const event = makeEvent({ payload: {} })
    expect(matchesWhere(event, { 'payload.deep.nested.value': 'x' })).toBe(false)
  })
})

describe('BehaviorRegistry', () => {
  it('should register and match behaviors', () => {
    const registry = new BehaviorRegistry()

    const def = behavior({
      name: 'on-create',
      on: ['object.created'],
      handler: async () => {},
    })

    registry.register(def)

    const event = makeEvent({ type: 'object.created' })
    const matches = registry.match(event)
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('on-create')
  })

  it('should not match behaviors for different event types', () => {
    const registry = new BehaviorRegistry()

    registry.register(
      behavior({
        name: 'on-remove',
        on: ['object.removed'],
        handler: async () => {},
      })
    )

    const event = makeEvent({ type: 'object.created' })
    const matches = registry.match(event)
    expect(matches).toHaveLength(0)
  })

  it('should filter by where clause', () => {
    const registry = new BehaviorRegistry()

    registry.register(
      behavior({
        name: 'on-selector-fail',
        on: ['behavior.failed'],
        where: { 'payload.reason': 'selector_not_found' },
        handler: async () => {},
      })
    )

    const matchingEvent = makeEvent({
      type: 'behavior.failed',
      payload: { reason: 'selector_not_found' },
    })
    const nonMatchingEvent = makeEvent({
      type: 'behavior.failed',
      payload: { reason: 'timeout' },
    })

    expect(registry.match(matchingEvent)).toHaveLength(1)
    expect(registry.match(nonMatchingEvent)).toHaveLength(0)
  })

  it('should match multiple behaviors for same event type', () => {
    const registry = new BehaviorRegistry()

    registry.register(behavior({ name: 'a', on: ['object.created'], handler: async () => {} }))
    registry.register(behavior({ name: 'b', on: ['object.created'], handler: async () => {} }))

    const event = makeEvent({ type: 'object.created' })
    expect(registry.match(event)).toHaveLength(2)
  })

  it('should match behavior subscribed to multiple event types', () => {
    const registry = new BehaviorRegistry()

    registry.register(
      behavior({
        name: 'multi',
        on: ['object.created', 'object.patched'],
        handler: async () => {},
      })
    )

    expect(registry.match(makeEvent({ type: 'object.created' }))).toHaveLength(1)
    expect(registry.match(makeEvent({ type: 'object.patched' }))).toHaveLength(1)
    expect(registry.match(makeEvent({ type: 'object.removed' }))).toHaveLength(0)
  })
})
