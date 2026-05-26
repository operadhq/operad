/**
 * Codex CLI parser — JSONL → Operad events.
 *
 * Codex uses event-driven JSONL with lifecycle events:
 * thread.started → turn.started → item.started → item.completed → turn.completed
 *
 * Stored at: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 */
import type { Runtime, EventInput } from '@operad/core'
import type { ParseStats } from '../parser.js'
import type { HarnessParser } from './types.js'

// ─── Codex-specific types ──────────────────────────────────────────────

interface CodexEvent {
  type: string
  thread_id?: string
  item?: CodexItem
  usage?: CodexUsage
  event_msg?: CodexEventMsg
  response_item?: CodexResponseItem
  turn_context?: Record<string, unknown>
}

interface CodexItem {
  type?: string
  id?: string
  status?: string
  command?: string
  text?: string
  // File operations
  filename?: string
  content?: string
  // MCP tool calls
  tool_name?: string
  arguments?: Record<string, unknown>
  output?: string
}

interface CodexUsage {
  input_tokens: number
  cached_input_tokens?: number
  output_tokens: number
  reasoning_output_tokens?: number
}

interface CodexEventMsg {
  type: string
  message?: string
  payload?: Record<string, unknown>
}

interface CodexResponseItem {
  type?: string
  role?: string
  content?: Array<{ type: string; text?: string }>
}

// ─── Pricing (per 1M tokens) ───────────────────────────────────────────

const CODEX_PRICING: Record<string, { input: number; output: number; cached: number }> = {
  'o3': { input: 10.0, output: 40.0, cached: 2.50 },
  'o4-mini': { input: 1.10, output: 4.40, cached: 0.275 },
  'gpt-4.1': { input: 2.0, output: 8.0, cached: 0.50 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60, cached: 0.10 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40, cached: 0.025 },
}

function computeCodexCost(usage: CodexUsage, model: string): number {
  // Try to match model name
  const key = Object.keys(CODEX_PRICING).find((k) => model.includes(k))
  const pricing = key ? CODEX_PRICING[key] : CODEX_PRICING['o4-mini'] // default

  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output
  const cacheSavings = ((usage.cached_input_tokens ?? 0) / 1_000_000) * (pricing.input - pricing.cached)

  return inputCost + outputCost - cacheSavings
}

// ─── Parser ────────────────────────────────────────────────────────────

export const codexParser: HarnessParser = {
  name: 'codex',

  async parseAndEmit(
    jsonlText: string,
    graphId: string,
    runtime: Runtime
  ): Promise<ParseStats> {
    const stats: ParseStats = { linesRead: 0, eventsEmitted: 0, goalsFound: 0, toolCalls: 0 }

    const lines = jsonlText.split('\n').filter((l) => l.trim())
    let threadId = ''
    let currentModel = 'o4-mini'

    for (const raw of lines) {
      let event: CodexEvent
      try {
        event = JSON.parse(raw)
      } catch {
        continue
      }

      stats.linesRead++
      const type = event.type

      // ─── Thread started
      if (type === 'thread.started') {
        threadId = event.thread_id ?? ''
        continue
      }

      // ─── Turn context (contains model info)
      if (type === 'turn_context' && event.turn_context) {
        const model = event.turn_context.model as string | undefined
        if (model) currentModel = model
        continue
      }

      // ─── User message → goal.set
      if (type === 'event_msg' && event.event_msg) {
        const msg = event.event_msg
        if (msg.type === 'user_message' && msg.message) {
          await runtime.emit(graphId, {
            type: 'goal.set',
            payload: { text: msg.message, threadId },
            actor: 'user',
          })
          stats.eventsEmitted++
          stats.goalsFound++
        }
        continue
      }

      // ─── Item started → tool called
      if (type === 'item.started' && event.item) {
        const item = event.item
        const toolName = resolveToolName(item)
        const input = resolveToolInput(item)

        await runtime.emit(graphId, {
          type: 'custom.tool_called',
          payload: {
            tool: toolName,
            toolUseId: item.id ?? '',
            input,
            itemType: item.type ?? 'unknown',
          },
          actor: 'agent',
        } as EventInput)
        stats.eventsEmitted++
        stats.toolCalls++
        continue
      }

      // ─── Item completed → tool result
      if (type === 'item.completed' && event.item) {
        const item = event.item
        const output = item.output ?? item.text ?? item.content ?? ''

        await runtime.emit(graphId, {
          type: 'custom.tool_completed',
          payload: {
            toolUseId: item.id ?? '',
            output: typeof output === 'string' ? output.slice(0, 500) : '',
            status: item.status ?? 'completed',
          },
          actor: 'agent',
        } as EventInput)
        stats.eventsEmitted++
        continue
      }

      // ─── Response item (assistant text)
      if (type === 'response_item' && event.response_item) {
        const resp = event.response_item
        if (resp.role === 'assistant' && resp.content) {
          const text = resp.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text!)
            .join('\n')

          if (text) {
            await runtime.emit(graphId, {
              type: 'custom.assistant_responded',
              payload: { preview: text.slice(0, 300) },
              actor: 'agent',
            } as EventInput)
            stats.eventsEmitted++
          }
        }
        continue
      }

      // ─── Turn completed → blame (cost/usage)
      if (type === 'turn.completed' && event.usage) {
        const usage = event.usage
        const cost = computeCodexCost(usage, currentModel)

        await runtime.emit(graphId, {
          type: 'custom.blame_recorded',
          payload: {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cached_input_tokens: usage.cached_input_tokens ?? 0,
            reasoning_output_tokens: usage.reasoning_output_tokens ?? 0,
            model: currentModel,
            cost,
          },
          actor: 'agent',
        } as EventInput)
        stats.eventsEmitted++

        // Track reasoning separately if present
        if (usage.reasoning_output_tokens && usage.reasoning_output_tokens > 0) {
          await runtime.emit(graphId, {
            type: 'custom.reasoning_trace',
            payload: {
              preview: `[${usage.reasoning_output_tokens} reasoning tokens]`,
              model: currentModel,
            },
            actor: 'agent',
          } as EventInput)
          stats.eventsEmitted++
        }
        continue
      }
    }

    return stats
  },
}

// ─── Helpers ───────────────────────────────────────────────────────────

function resolveToolName(item: CodexItem): string {
  // MCP tool call
  if (item.tool_name) return item.tool_name
  // Command execution
  if (item.command) return 'Bash'
  // File write
  if (item.filename && item.content !== undefined) return 'Write'
  // Generic item type
  return item.type ?? 'unknown'
}

function resolveToolInput(item: CodexItem): Record<string, unknown> {
  if (item.tool_name) {
    return { tool_name: item.tool_name, arguments: item.arguments ?? {} }
  }
  if (item.command) {
    return { command: item.command }
  }
  if (item.filename) {
    return { file_path: item.filename }
  }
  return {}
}
