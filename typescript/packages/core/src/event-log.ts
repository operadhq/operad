import type { StorageAdapter, EventInput, EventFilter, GraphEvent } from './types.js'

/**
 * Append-only event log with causal chain tracing.
 * Every mutation in the system flows through here.
 */
export class EventLog {
  constructor(
    private graphId: string,
    private storage: StorageAdapter
  ) {}

  async append(input: EventInput): Promise<GraphEvent> {
    return this.storage.appendEvent(this.graphId, input)
  }

  async query(filter: EventFilter): Promise<GraphEvent[]> {
    return this.storage.queryEvents(this.graphId, filter)
  }

  /** Trace the causal chain backward: event → caused_by → caused_by → ... */
  async traceBackward(eventId: string): Promise<GraphEvent[]> {
    return this.storage.getEventChain(eventId)
  }

  /** Find all events directly or transitively caused by this event */
  async traceForward(eventId: string): Promise<GraphEvent[]> {
    return this.storage.getEventsTriggeredBy(eventId)
  }
}
