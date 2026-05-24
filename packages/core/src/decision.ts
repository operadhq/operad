import type { StorageAdapter, DecisionInput, Decision, DecisionFilter } from './types.js'

/**
 * Decision records capture what an agent chose, what alternatives
 * were considered, and why each was accepted or rejected.
 * This is the "why" layer of provenance.
 */
export class DecisionLog {
  constructor(
    private graphId: string,
    private storage: StorageAdapter
  ) {}

  async record(eventId: string, input: DecisionInput): Promise<Decision> {
    return this.storage.recordDecision(this.graphId, eventId, input)
  }

  async query(filter: DecisionFilter = {}): Promise<Decision[]> {
    return this.storage.queryDecisions(this.graphId, filter)
  }
}
