/**
 * Synthetic JSONL session builder — generates realistic agent sessions
 * for demos that exercise the full commit pipeline (goals, tools, thinking, causal chains).
 *
 * Each "scenario" is a sequence of goals, where each goal has
 * thinking → research → implement → verify phases.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ScenarioGoal {
  /** User instruction that kicks off this goal */
  instruction: string
  /** Agent thinking/reasoning traces */
  thinking: string[]
  /** Tool calls: [toolName, inputObj][] */
  tools: Array<{ name: string; input: Record<string, unknown> }>
  /** Optional text responses between tool calls */
  responses?: string[]
}

export interface ScenarioConfig {
  sessionId: string
  model?: string
  goals: ScenarioGoal[]
}

// ─── Builder ───────────────────────────────────────────────────────────────

interface JSONLLine {
  uuid: string
  parentUuid?: string
  timestamp: string
  type: 'user' | 'assistant'
  sessionId: string
  message: {
    role: 'user' | 'assistant'
    model?: string
    content: unknown
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
    }
  }
}

let _counter = 0
function uid(prefix: string): string {
  return `${prefix}_${++_counter}`
}

function ts(base: Date, offsetSeconds: number): string {
  return new Date(base.getTime() + offsetSeconds * 1000).toISOString()
}

/**
 * Build a synthetic Claude Code JSONL session from a scenario config.
 * Produces realistic multi-turn conversations with thinking, tool use,
 * and text responses — all with proper parent-child chaining for causedBy.
 */
export function buildSession(config: ScenarioConfig): string {
  _counter = 0
  const lines: JSONLLine[] = []
  const base = new Date('2025-06-15T09:00:00Z')
  let seconds = 0
  const model = config.model ?? 'claude-sonnet-4-20250514'

  for (const goal of config.goals) {
    // ── User message (goal) ──────────────────────────────────────────
    const userUuid = uid('u')
    lines.push({
      uuid: userUuid,
      timestamp: ts(base, seconds++),
      type: 'user',
      sessionId: config.sessionId,
      message: { role: 'user', content: goal.instruction },
    })

    let parentUuid = userUuid

    // ── Thinking traces ──────────────────────────────────────────────
    if (goal.thinking.length > 0) {
      const thinkUuid = uid('a')
      const content: unknown[] = goal.thinking.map((t) => ({
        type: 'thinking',
        thinking: t,
      }))

      // If there are tools, add the first one after thinking
      if (goal.tools.length > 0) {
        content.push({
          type: 'tool_use',
          id: uid('tu'),
          name: goal.tools[0].name,
          input: goal.tools[0].input,
        })
      }

      lines.push({
        uuid: thinkUuid,
        parentUuid,
        timestamp: ts(base, seconds++),
        type: 'assistant',
        sessionId: config.sessionId,
        message: {
          role: 'assistant',
          model,
          content,
          usage: {
            input_tokens: 3000 + Math.floor(Math.random() * 5000),
            output_tokens: 100 + Math.floor(Math.random() * 300),
            cache_read_input_tokens: Math.floor(Math.random() * 2000),
          },
        },
      })
      parentUuid = thinkUuid
    }

    // ── Remaining tool calls ─────────────────────────────────────────
    const startIdx = goal.thinking.length > 0 ? 1 : 0
    for (let i = startIdx; i < goal.tools.length; i++) {
      const tool = goal.tools[i]
      const toolUuid = uid('a')
      const content: unknown[] = []

      // Optionally insert a text response before this tool
      if (goal.responses && goal.responses[i]) {
        content.push({ type: 'text', text: goal.responses[i] })
      }

      content.push({
        type: 'tool_use',
        id: uid('tu'),
        name: tool.name,
        input: tool.input,
      })

      lines.push({
        uuid: toolUuid,
        parentUuid,
        timestamp: ts(base, seconds++),
        type: 'assistant',
        sessionId: config.sessionId,
        message: {
          role: 'assistant',
          model,
          content,
          usage: {
            input_tokens: 2000 + Math.floor(Math.random() * 6000),
            output_tokens: 50 + Math.floor(Math.random() * 400),
            cache_read_input_tokens: Math.floor(Math.random() * 3000),
          },
        },
      })
      parentUuid = toolUuid
    }

    // ── Final text response (if no tools or after tools) ─────────────
    if (goal.tools.length === 0 || (goal.responses && goal.responses.length > goal.tools.length)) {
      const finalUuid = uid('a')
      const finalText = goal.responses?.[goal.responses.length - 1] ?? 'Done.'
      lines.push({
        uuid: finalUuid,
        parentUuid,
        timestamp: ts(base, seconds++),
        type: 'assistant',
        sessionId: config.sessionId,
        message: {
          role: 'assistant',
          model,
          content: [{ type: 'text', text: finalText }],
          usage: {
            input_tokens: 1000 + Math.floor(Math.random() * 2000),
            output_tokens: 50 + Math.floor(Math.random() * 200),
          },
        },
      })
    }

    seconds += 2 // gap between goals
  }

  return lines.map((l) => JSON.stringify(l)).join('\n')
}
