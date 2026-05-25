import type { PatchProposal, PatchStatus, JsonValue } from './types.js'

let patchCounter = 0
function genPatchId(): string {
  return `patch_${Date.now()}_${++patchCounter}`
}

export interface PatchInput {
  graphId: string
  objectType: string
  data: Record<string, JsonValue>
  reason: string
  proposedBy: string
}

/**
 * In-memory registry for patch proposals.
 * Tracks propose → approve/deny lifecycle.
 */
export class PatchRegistry {
  private proposals = new Map<string, PatchProposal>()

  add(input: PatchInput): PatchProposal {
    const id = genPatchId()
    const proposal: PatchProposal = {
      id,
      graphId: input.graphId,
      objectType: input.objectType,
      data: { ...input.data },
      reason: input.reason,
      status: 'pending',
      proposedBy: input.proposedBy,
      createdAt: new Date().toISOString(),
    }
    this.proposals.set(id, proposal)
    return proposal
  }

  get(id: string): PatchProposal | undefined {
    return this.proposals.get(id)
  }

  pending(graphId: string): PatchProposal[] {
    return [...this.proposals.values()].filter(
      (p) => p.graphId === graphId && p.status === 'pending'
    )
  }

  resolve(id: string, status: 'applied' | 'rejected', decidedBy: string): PatchProposal {
    const proposal = this.proposals.get(id)
    if (!proposal) throw new Error(`Patch not found: ${id}`)
    if (proposal.status !== 'pending') {
      throw new Error(`Patch ${id} already resolved as ${proposal.status}`)
    }

    const resolved: PatchProposal = {
      ...proposal,
      status,
      decidedBy,
      resolvedAt: new Date().toISOString(),
    }
    this.proposals.set(id, resolved)
    return resolved
  }
}
