import type { StorageAdapter, HealthRecord, HealthUpdate, GraphObject } from './types.js'

/**
 * Health tracking for graph objects. Inspired by how the brain
 * consolidates or prunes memories based on usage patterns.
 *
 * Objects that aren't verified regularly become "stale" —
 * candidates for re-verification or pruning.
 */
export class HealthTracker {
  constructor(
    private graphId: string,
    private storage: StorageAdapter
  ) {}

  async update(objectId: string, update: HealthUpdate): Promise<HealthRecord> {
    return this.storage.updateHealth(objectId, update)
  }

  async getStale(thresholdDays: number): Promise<GraphObject[]> {
    return this.storage.getStaleObjects(this.graphId, thresholdDays)
  }
}
