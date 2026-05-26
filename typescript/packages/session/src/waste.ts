/**
 * Waste detector — finds stashed (wasted) work.
 *
 * Like `git stash list` showing you abandoned work,
 * this finds tokens you burned for nothing:
 * - Redundant reads (same file, no edits between reads)
 * - Re-spent context (file read again after already being in cache)
 */
import type { GraphEvent } from '@operad/core'
import type { Stash } from './types.js'

interface ReadRecord {
  count: number
  lastEditBefore: number // event index of last edit to this file
}

/**
 * Walk tool_called events and detect redundant file reads.
 * A read is "redundant" if the same path was read before
 * with no edit to that file in between.
 */
export function detectStash(events: GraphEvent[]): Stash {
  const reads = new Map<string, ReadRecord>()
  const editIndices = new Map<string, number>() // file → last edit event index
  let redundantReads = 0

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (event.type !== 'custom.tool_called') continue

    const tool = event.payload.tool as string
    const input = event.payload.input as Record<string, unknown> | undefined

    // Track edits to files
    if (tool === 'Edit' || tool === 'Write') {
      const filePath = (input?.file_path as string) ?? ''
      if (filePath) editIndices.set(filePath, i)
      continue
    }

    // Check reads for redundancy
    if (tool === 'Read') {
      const filePath = (input?.file_path as string) ?? ''
      if (!filePath) continue

      const record = reads.get(filePath)
      const lastEdit = editIndices.get(filePath) ?? -1

      if (record && lastEdit <= record.lastEditBefore) {
        // Same file, no edit since last read → redundant
        redundantReads++
      }

      reads.set(filePath, {
        count: (record?.count ?? 0) + 1,
        lastEditBefore: lastEdit,
      })
    }
  }

  // Estimate: ~2000 tokens per redundant read (avg file content)
  const tokensWasted = redundantReads * 2000
  // At ~$3/M input tokens (sonnet pricing)
  const potentialSavings = tokensWasted * (3.0 / 1_000_000)

  return { redundantReads, tokensWasted, potentialSavings }
}
