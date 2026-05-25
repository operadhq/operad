/**
 * OpenCode parser — JSON messages → Operad events.
 *
 * OpenCode stores sessions as individual JSON files per message, or
 * as newline-delimited JSON objects. Messages have a rich `parts` array
 * with typed entries (text, tool, reasoning, file, patch, etc.)
 *
 * Stored at: ~/.local/share/opencode/storage/session/<project>/<session>.json
 */
import type { Runtime, EventInput } from '@operad/core'
import type { ParseStats } from '../parser.js'
import type { HarnessParser } from './types.js'

// ─── OpenCode-specific types ───────────────────────────────────────────

interface OpenCodeMessage {
  id: string
  type: 'user' | 'assistant'
  created_at?: string
  parts: OpenCodePart[]
  // Assistant-specific
  model_id?: string
  provider_id?: string
  cost?: number
  tokens?: OpenCodeTokens
}

interface OpenCodeTokens {
  input?: number
  output?: number
  reasoning?: number
  cache_read?: number
  cache_write?: number
}

type OpenCodePart =
  | { type: 'text'; content: string }
  | { type: 'tool'; name: string; input: Record<string, unknown>; result?: string; state?: string }
  | { type: 'reasoning'; content: string }
  | { type: 'file'; path: string; source?: string; range?: { start: number; end: number } }
  | { type: 'patch'; path: string; diff: string; applied?: boolean }
  | { type: 'snapshot'; content: string }
  | { type: 'agent'; agent_id: string; content?: string }
  | { type: 'subtask'; task_id: string; description?: string; status?: string }

// ─── Parser ────────────────────────────────────────────────────────────

export const opencodeParser: HarnessParser = {
  name: 'opencode',

  async parseAndEmit(
    input: string,
    graphId: string,
    runtime: Runtime
  ): Promise<ParseStats> {
    const stats: ParseStats = { linesRead: 0, eventsEmitted: 0, goalsFound: 0, toolCalls: 0 }

    const messages = parseMessages(input)

    for (const msg of messages) {
      stats.linesRead++

      if (msg.type === 'user') {
        // Extract text from user message parts
        const text = msg.parts
          .filter((p): p is { type: 'text'; content: string } => p.type === 'text')
          .map((p) => p.content)
          .join('\n')
          .slice(0, 1000)

        if (text) {
          await runtime.emit(graphId, {
            type: 'goal.set',
            payload: { text, messageId: msg.id },
            actor: 'user',
          })
          stats.eventsEmitted++
          stats.goalsFound++
        }
        continue
      }

      // Assistant message — process each part
      if (msg.type === 'assistant') {
        for (const part of msg.parts) {
          switch (part.type) {
            case 'tool': {
              await runtime.emit(graphId, {
                type: 'custom.tool_called',
                payload: {
                  tool: part.name,
                  toolUseId: `${msg.id}_${part.name}`,
                  input: part.input,
                  messageId: msg.id,
                },
                actor: 'agent',
              } as EventInput)
              stats.eventsEmitted++
              stats.toolCalls++

              // Emit result if present
              if (part.result) {
                await runtime.emit(graphId, {
                  type: 'custom.tool_completed',
                  payload: {
                    toolUseId: `${msg.id}_${part.name}`,
                    output: part.result.slice(0, 500),
                    state: part.state ?? 'completed',
                  },
                  actor: 'agent',
                } as EventInput)
                stats.eventsEmitted++
              }
              break
            }

            case 'text': {
              if (part.content) {
                await runtime.emit(graphId, {
                  type: 'custom.assistant_responded',
                  payload: { preview: part.content.slice(0, 300), messageId: msg.id },
                  actor: 'agent',
                } as EventInput)
                stats.eventsEmitted++
              }
              break
            }

            case 'reasoning': {
              await runtime.emit(graphId, {
                type: 'custom.reasoning_trace',
                payload: { preview: part.content.slice(0, 300), messageId: msg.id },
                actor: 'agent',
              } as EventInput)
              stats.eventsEmitted++
              break
            }

            case 'file': {
              await runtime.emit(graphId, {
                type: 'custom.tool_called',
                payload: {
                  tool: 'Read',
                  toolUseId: `${msg.id}_file_${part.path}`,
                  input: { file_path: part.path, range: part.range },
                  messageId: msg.id,
                },
                actor: 'agent',
              } as EventInput)
              stats.eventsEmitted++
              stats.toolCalls++
              break
            }

            case 'patch': {
              await runtime.emit(graphId, {
                type: 'custom.tool_called',
                payload: {
                  tool: 'Edit',
                  toolUseId: `${msg.id}_patch_${part.path}`,
                  input: { file_path: part.path, diff: part.diff },
                  messageId: msg.id,
                },
                actor: 'agent',
              } as EventInput)
              stats.eventsEmitted++
              stats.toolCalls++
              break
            }

            default:
              // snapshot, agent, subtask — skip for now
              break
          }
        }

        // Emit blame if cost/tokens are available
        if (msg.cost !== undefined || msg.tokens) {
          await runtime.emit(graphId, {
            type: 'custom.blame_recorded',
            payload: {
              input_tokens: msg.tokens?.input ?? 0,
              output_tokens: msg.tokens?.output ?? 0,
              reasoning_tokens: msg.tokens?.reasoning ?? 0,
              cache_read_tokens: msg.tokens?.cache_read ?? 0,
              model: msg.model_id ?? 'unknown',
              provider: msg.provider_id ?? 'unknown',
              cost: msg.cost ?? 0,
            },
            actor: 'agent',
          } as EventInput)
          stats.eventsEmitted++
        }
      }
    }

    return stats
  },
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Parse input into messages. Supports:
 * 1. JSON array of messages
 * 2. Newline-delimited JSON objects
 * 3. Single JSON object
 */
function parseMessages(input: string): OpenCodeMessage[] {
  const trimmed = input.trim()

  // Try as JSON array first
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // fall through
    }
  }

  // Try as newline-delimited JSON
  const messages: OpenCodeMessage[] = []
  const lines = trimmed.split('\n')

  for (const line of lines) {
    const l = line.trim()
    if (!l) continue
    try {
      const parsed = JSON.parse(l)
      if (parsed.id && parsed.type && Array.isArray(parsed.parts)) {
        messages.push(parsed)
      }
    } catch {
      continue
    }
  }

  if (messages.length > 0) return messages

  // Try as single object
  try {
    const single = JSON.parse(trimmed)
    if (single.id && single.type && Array.isArray(single.parts)) {
      return [single]
    }
  } catch {
    // nothing
  }

  return []
}
