/**
 * Auto-detect which coding agent harness produced a session file.
 *
 * Sniffs the first valid JSON line/object to determine the format.
 */
import type { HarnessName } from './types.js'

/**
 * Detect the harness from raw file content.
 * Returns null if the format is unrecognized.
 */
export function detectHarness(content: string): HarnessName | null {
  const trimmedContent = content.trim()

  // If content starts with '[', try parsing as a JSON array (OpenCode format)
  if (trimmedContent.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmedContent)
      if (Array.isArray(arr) && arr.length > 0) {
        const first = arr[0]
        if (first.id && Array.isArray(first.parts) && first.type) {
          const type = first.type as string
          if (['user', 'assistant'].includes(type)) {
            return 'opencode'
          }
        }
      }
    } catch {
      // fall through to line-by-line detection
    }
  }

  // Find the first valid JSON line
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }

    // Claude Code: has uuid + sessionId + type ∈ {user, assistant, progress, system, ...}
    if (parsed.uuid && parsed.sessionId && parsed.type) {
      const type = parsed.type as string
      if (['user', 'assistant', 'progress', 'system', 'file-history-snapshot', 'pr-link', 'queue-operation'].includes(type)) {
        return 'claude'
      }
    }

    // Codex CLI: has type ∈ {thread.started, turn.started, item.started, ...}
    if (parsed.type) {
      const type = parsed.type as string
      if (['thread.started', 'turn.started', 'turn.completed', 'turn.failed',
           'item.started', 'item.completed', 'event_msg', 'response_item',
           'turn_context', 'session_start'].includes(type)) {
        return 'codex'
      }
    }

    // OpenCode: has id (ULID-like) + parts array + type ∈ {user, assistant}
    if (parsed.id && Array.isArray(parsed.parts) && parsed.type) {
      const type = parsed.type as string
      if (['user', 'assistant'].includes(type)) {
        return 'opencode'
      }
    }

    // If we parsed JSON but couldn't identify, try next line
  }

  return null
}
