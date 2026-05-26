import { describe, it, expect } from 'vitest'
import { detectStash } from '../src/waste.js'
import type { GraphEvent } from '@operad/core'

function makeToolEvent(tool: string, input: Record<string, unknown>, index: number): GraphEvent {
  return {
    id: `evt-${index}`,
    graphId: 'test',
    type: 'custom.tool_called',
    payload: { tool, input, uuid: `u${index}` },
    actor: 'agent',
    timestamp: new Date(Date.now() + index * 1000).toISOString(),
  } as GraphEvent
}

describe('waste (stash detection)', () => {
  it('detects redundant reads of the same file', () => {
    const events = [
      makeToolEvent('Read', { file_path: '/src/app.ts' }, 0),
      makeToolEvent('Read', { file_path: '/src/app.ts' }, 1), // redundant
      makeToolEvent('Read', { file_path: '/src/app.ts' }, 2), // redundant
    ]

    const stash = detectStash(events)
    expect(stash.redundantReads).toBe(2)
    expect(stash.tokensWasted).toBe(4000) // 2 * 2000
  })

  it('does not flag reads after edits', () => {
    const events = [
      makeToolEvent('Read', { file_path: '/src/app.ts' }, 0),
      makeToolEvent('Edit', { file_path: '/src/app.ts' }, 1),
      makeToolEvent('Read', { file_path: '/src/app.ts' }, 2), // not redundant — file changed
    ]

    const stash = detectStash(events)
    expect(stash.redundantReads).toBe(0)
  })

  it('tracks files independently', () => {
    const events = [
      makeToolEvent('Read', { file_path: '/src/a.ts' }, 0),
      makeToolEvent('Read', { file_path: '/src/b.ts' }, 1),
      makeToolEvent('Read', { file_path: '/src/a.ts' }, 2), // redundant
      makeToolEvent('Read', { file_path: '/src/b.ts' }, 3), // redundant
    ]

    const stash = detectStash(events)
    expect(stash.redundantReads).toBe(2)
  })

  it('returns zero for empty events', () => {
    const stash = detectStash([])
    expect(stash.redundantReads).toBe(0)
    expect(stash.tokensWasted).toBe(0)
    expect(stash.potentialSavings).toBe(0)
  })
})
