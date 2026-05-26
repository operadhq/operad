/**
 * Claude Code parser — JSONL → Operad events.
 *
 * This is the existing parser logic, now conforming to the HarnessParser interface.
 */
import type { Runtime, EventInput } from '@operad/core'
import type { JSONLLine, ContentBlock } from '../types.js'
import type { ParseStats } from '../parser.js'
import type { HarnessParser } from './types.js'
import { computeMessageCost } from '../cost.js'

export const claudeParser: HarnessParser = {
  name: 'claude',
  parseAndEmit,
}

async function parseAndEmit(
  jsonlText: string,
  graphId: string,
  runtime: Runtime
): Promise<ParseStats> {
  const stats: ParseStats = { linesRead: 0, eventsEmitted: 0, goalsFound: 0, toolCalls: 0 }

  const lines = jsonlText.split('\n').filter((l) => l.trim())

  for (const raw of lines) {
    let line: JSONLLine
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }

    stats.linesRead++

    // Skip non-actionable line types
    if (line.type === 'progress' || line.type === 'queue-operation') continue

    const { message, uuid, parentUuid } = line
    if (!message) continue

    const causedBy = parentUuid ?? undefined
    const content = message.content

    // ─── User message → goal.set
    if (line.type === 'user') {
      const text = typeof content === 'string'
        ? content
        : extractText(content)

      if (text) {
        await runtime.emit(graphId, {
          type: 'goal.set',
          payload: { text, uuid },
          causedBy,
          actor: 'user',
        })
        stats.eventsEmitted++
        stats.goalsFound++
      }
      continue
    }

    // ─── System/snapshot → custom.context_loaded
    if (line.type === 'system' || line.type === 'file-history-snapshot') {
      await runtime.emit(graphId, {
        type: 'custom.context_loaded',
        payload: {
          lineType: line.type,
          uuid,
          preview: typeof content === 'string' ? content.slice(0, 200) : '',
        },
        causedBy,
        actor: 'system',
      })
      stats.eventsEmitted++
      continue
    }

    // ─── Assistant message → extract blocks
    if (line.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        const event = await emitBlock(block, graphId, runtime, uuid, causedBy)
        if (event) {
          stats.eventsEmitted++
          if (block.type === 'tool_use') stats.toolCalls++
        }
      }

      // Emit usage/blame if present
      if (message.usage) {
        const cost = computeMessageCost(message.usage, message.model ?? 'unknown')
        await runtime.emit(graphId, {
          type: 'custom.blame_recorded',
          payload: {
            ...message.usage,
            model: message.model ?? 'unknown',
            cost: cost.totalCost,
            uuid,
          },
          causedBy,
          actor: 'agent',
        })
        stats.eventsEmitted++
      }
    }
  }

  return stats
}

async function emitBlock(
  block: ContentBlock,
  graphId: string,
  runtime: Runtime,
  uuid: string,
  causedBy?: string
): Promise<boolean> {
  switch (block.type) {
    case 'tool_use':
      await runtime.emit(graphId, {
        type: 'custom.tool_called',
        payload: {
          tool: block.name ?? 'unknown',
          toolUseId: block.id ?? '',
          input: (block.input ?? {}) as Record<string, unknown>,
          uuid,
        },
        causedBy,
        actor: 'agent',
      } as EventInput)
      return true

    case 'tool_result':
      await runtime.emit(graphId, {
        type: 'custom.tool_completed',
        payload: {
          toolUseId: block.tool_use_id ?? '',
          output: typeof block.content === 'string'
            ? block.content.slice(0, 500)
            : '',
          uuid,
        },
        causedBy,
        actor: 'agent',
      } as EventInput)
      return true

    case 'thinking':
      await runtime.emit(graphId, {
        type: 'custom.reasoning_trace',
        payload: {
          preview: (block.thinking ?? block.text ?? '').slice(0, 300),
          uuid,
        },
        causedBy,
        actor: 'agent',
      } as EventInput)
      return true

    case 'text':
      if (block.text && block.text.length > 0) {
        await runtime.emit(graphId, {
          type: 'custom.assistant_responded',
          payload: {
            preview: block.text.slice(0, 300),
            uuid,
          },
          causedBy,
          actor: 'agent',
        } as EventInput)
        return true
      }
      return false

    default:
      return false
  }
}

function extractText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n')
    .slice(0, 1000)
}
