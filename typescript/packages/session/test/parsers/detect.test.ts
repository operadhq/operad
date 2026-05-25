import { describe, it, expect } from 'vitest'
import { detectHarness } from '../../src/parsers/detect.js'

describe('detectHarness', () => {
  it('detects Claude Code JSONL', () => {
    const line = JSON.stringify({
      uuid: 'abc-123',
      parentUuid: 'def-456',
      timestamp: '2025-05-01T00:00:00Z',
      type: 'user',
      sessionId: 'session-1',
      message: { role: 'user', content: 'hello' },
    })
    expect(detectHarness(line)).toBe('claude')
  })

  it('detects Claude assistant type', () => {
    const line = JSON.stringify({
      uuid: 'abc-123',
      timestamp: '2025-05-01T00:00:00Z',
      type: 'assistant',
      sessionId: 'session-1',
      message: { role: 'assistant', content: [] },
    })
    expect(detectHarness(line)).toBe('claude')
  })

  it('detects Codex CLI JSONL', () => {
    const line = JSON.stringify({
      type: 'thread.started',
      thread_id: 'thread_abc123',
    })
    expect(detectHarness(line)).toBe('codex')
  })

  it('detects Codex turn events', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    expect(detectHarness(line)).toBe('codex')
  })

  it('detects OpenCode JSON', () => {
    const line = JSON.stringify({
      id: '01HYXYZ123ABC',
      type: 'user',
      parts: [{ type: 'text', content: 'hello' }],
      created_at: '2025-05-01T00:00:00Z',
    })
    expect(detectHarness(line)).toBe('opencode')
  })

  it('returns null for unrecognized format', () => {
    expect(detectHarness('not json at all')).toBe(null)
    expect(detectHarness(JSON.stringify({ random: 'data' }))).toBe(null)
  })

  it('skips blank lines and finds format in subsequent lines', () => {
    const content = `\n\n${JSON.stringify({ type: 'item.started', item: {} })}`
    expect(detectHarness(content)).toBe('codex')
  })
})
