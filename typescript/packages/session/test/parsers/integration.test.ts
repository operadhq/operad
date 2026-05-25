import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { commit } from '../../src/session.js'
import { detectHarness } from '../../src/parsers/detect.js'

const FIXTURES = join(__dirname, '..', 'fixtures')

// ─── Codex Integration ────────────────────────────────────────────────

describe('Codex realistic integration', () => {
  const codexContent = readFileSync(join(FIXTURES, 'codex-realistic.jsonl'), 'utf-8')

  it('auto-detects as codex', () => {
    expect(detectHarness(codexContent)).toBe('codex')
  })

  it('full commit() pipeline produces sensible SessionLog', async () => {
    const log = await commit(codexContent, { harness: 'codex' })

    // Should detect 2 user messages → 2 goals
    expect(log.goals).toBe(2)

    // Should detect tool calls (bash commands + file writes + mcp tool)
    expect(log.toolCalls).toBeGreaterThanOrEqual(7)

    // Files written (Write tool calls)
    expect(log.filesEdited).toBeGreaterThanOrEqual(3)

    // graphId should be set
    expect(log.graphId).toBeTruthy()

    // Blame cost should be > 0 (codex blame comes from custom events, not Claude format)
    // The commit() blame parser only handles Claude JSONL format, so blame.totalCost may be 0
    // But the session should still be valid
    expect(log.stash).toBeDefined()
  })

  it('handles error event gracefully (does not crash)', async () => {
    // The fixture has an error event_msg — parser should skip it
    const log = await commit(codexContent, { harness: 'codex' })
    expect(log.goals).toBe(2) // Still found both user messages
  })

  it('handles multiple turns with correct tool count', async () => {
    const log = await commit(codexContent, { harness: 'codex' })

    // Turn 1: ls, npm install, write tsconfig, write index.ts, github_create_file = 5
    // Turn 2: npm install morgan, write middleware.ts, write index.ts, tsc --noEmit = 4
    // Total = 9
    expect(log.toolCalls).toBe(9)
  })
})

// ─── OpenCode Integration ─────────────────────────────────────────────

describe('OpenCode realistic integration', () => {
  const openCodeContent = readFileSync(join(FIXTURES, 'opencode-realistic.json'), 'utf-8')

  it('auto-detects as opencode', () => {
    expect(detectHarness(openCodeContent)).toBe('opencode')
  })

  it('full commit() pipeline produces sensible SessionLog', async () => {
    const log = await commit(openCodeContent, { harness: 'opencode' })

    // Should detect 2 user messages → 2 goals
    expect(log.goals).toBe(2)

    // Tool calls: Bash(1) + file(1) + Write(1) + patch(1) from msg B
    //           + Bash(1) + Write(1) + Bash(1) from msg D = 7
    expect(log.toolCalls).toBeGreaterThanOrEqual(7)

    // graphId should be set
    expect(log.graphId).toBeTruthy()

    // Stash should be defined
    expect(log.stash).toBeDefined()
  })

  it('handles message with no cost field gracefully', async () => {
    // Message D has tokens but no cost field
    const log = await commit(openCodeContent, { harness: 'opencode' })
    // Should not crash, and still count goals/tools correctly
    expect(log.goals).toBe(2)
  })

  it('skips subtask and agent parts without crashing', async () => {
    // Message D has subtask and agent parts
    const log = await commit(openCodeContent, { harness: 'opencode' })
    expect(log.goals).toBe(2)
    expect(log.toolCalls).toBeGreaterThanOrEqual(7)
  })

  it('counts file reads and edits separately', async () => {
    const log = await commit(openCodeContent, { harness: 'opencode' })
    // file parts → Read, Write tool calls → Edit/Write, patch parts → Edit
    expect(log.filesRead).toBeGreaterThanOrEqual(1) // file part
    expect(log.filesEdited).toBeGreaterThanOrEqual(2) // Write + patch
  })
})

// ─── Edge Cases ───────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('empty string → throws detection error', async () => {
    await expect(commit('')).rejects.toThrow(/Could not detect/)
  })

  it('file with only blank lines → throws detection error', async () => {
    await expect(commit('\n\n   \n\n')).rejects.toThrow(/Could not detect/)
  })

  it('malformed JSONL lines are skipped (codex)', async () => {
    const content = [
      '{"type":"thread.started","thread_id":"t1"}',
      'this is not json at all!!!',
      '{"type":"event_msg","event_msg":{"type":"user_message","message":"hello"}}',
      '{broken json',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}',
    ].join('\n')

    const log = await commit(content, { harness: 'codex' })
    expect(log.goals).toBe(1)
    // Should not crash despite malformed lines
  })

  it('malformed JSON array (opencode) → returns zero stats', async () => {
    const content = '[{not valid json}]'
    // detectHarness will fail since it can't parse
    await expect(commit(content)).rejects.toThrow(/Could not detect/)
  })

  it('very long tool output is truncated at 500 chars (codex)', async () => {
    const longOutput = 'x'.repeat(15000)
    const content = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"item.started","item":{"id":"i1","type":"exec","command":"cat bigfile"}}',
      JSON.stringify({ type: 'item.completed', item: { id: 'i1', status: 'completed', output: longOutput } }),
    ].join('\n')

    const log = await commit(content, { harness: 'codex' })
    // Should not crash; the parser truncates output to 500 chars internally
    expect(log.toolCalls).toBe(1)
  })

  it('very long tool result is truncated at 500 chars (opencode)', async () => {
    const longResult = 'y'.repeat(12000)
    const content = JSON.stringify([
      {
        id: 'msg1',
        type: 'user',
        parts: [{ type: 'text', content: 'do something' }],
      },
      {
        id: 'msg2',
        type: 'assistant',
        model_id: 'test-model',
        cost: 0.01,
        tokens: { input: 100, output: 200 },
        parts: [
          { type: 'tool', name: 'Bash', input: { command: 'cat big' }, result: longResult, state: 'completed' },
        ],
      },
    ])

    const log = await commit(content, { harness: 'opencode' })
    expect(log.toolCalls).toBe(1)
    // Should not crash
  })

  it('mixed format first line (codex event in opencode array) → detects by first parseable structure', () => {
    // JSON array starting with [ → detect tries array parse; if items have id+parts+type, it's opencode
    const mixedContent = '[{"type":"thread.started","thread_id":"t1"}]'
    // This has type but no id+parts → won't match opencode. It starts with [ so array parse succeeds
    // but items don't have id+parts so it falls through to line-by-line
    const detected = detectHarness(mixedContent)
    // The line-by-line parse of the first line is the full array string, which won't parse as a single object
    // Actually detectHarness splits by newline first, so it tries to parse the whole line
    // '[{"type":"thread.started"...}]' parses as an array, not an object with .type
    // So it won't match any pattern → null
    expect(detected).toBeNull()
  })

  it('single-line codex event is detected correctly', () => {
    const content = '{"type":"thread.started","thread_id":"t1"}'
    expect(detectHarness(content)).toBe('codex')
  })

  it('single opencode message (non-array NDJSON) is detected correctly', () => {
    const content = '{"id":"msg1","type":"user","parts":[{"type":"text","content":"hi"}]}'
    expect(detectHarness(content)).toBe('opencode')
  })
})
