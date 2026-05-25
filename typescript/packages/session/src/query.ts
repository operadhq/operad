/**
 * @operad/session query — Query file state from the Operad SQLite graph.
 *
 * Agents can use this to check "have I already read this file?" before
 * issuing redundant tool calls, reducing token waste.
 *
 * Usage:
 *   import { queryFileState, queryToolHistory } from '@operad/session/query'
 *
 *   const state = queryFileState('/path/to/file.ts')
 *   if (state.hasBeenRead) {
 *     console.log(`File was last read at ${state.lastReadAt}`)
 *   }
 */

import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { SqliteAdapter } from '@operad/adapter-sqlite'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileState {
  /** The normalized file path that was queried */
  filePath: string
  /** Whether the file has been read in this session graph */
  hasBeenRead: boolean
  /** ISO timestamp of the most recent read, or null */
  lastReadAt: string | null
  /** Total number of times this file was read */
  readCount: number
  /** Whether the file has been written/edited in this session graph */
  hasBeenEdited: boolean
  /** ISO timestamp of the most recent edit, or null */
  lastEditedAt: string | null
  /** Total number of edits to this file */
  editCount: number
}

export interface ToolHistoryEntry {
  tool: string
  input: Record<string, unknown>
  timestamp: string
  hookType: string
}

// ─── Configuration ────────────────────────────────────────────────────────────

function getDbPath(): string {
  const override = process.env['OPERAD_DB_PATH']
  if (override) return resolve(override)
  return resolve(homedir(), '.operad', 'session.db')
}

function getGraphId(): string {
  return (
    process.env['OPERAD_GRAPH_ID'] ??
    process.env['CLAUDE_SESSION_ID'] ??
    'default'
  )
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Query whether a file has been read or edited in the current session graph.
 *
 * Returns null if the database does not exist yet (no hook events emitted).
 */
export async function queryFileState(filePath: string): Promise<FileState | null> {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) return null

  const graphId = getGraphId()
  const normalizedPath = resolve(filePath)

  const adapter = new SqliteAdapter(dbPath)

  try {
    const allToolEvents = await adapter.queryEvents(graphId, {
      type: 'custom.tool_called',
    })

    // Filter events for this file path
    const readEvents = allToolEvents.filter((evt) => {
      const payload = evt.payload as Record<string, unknown>
      const tool = payload.tool as string
      const input = payload.input as Record<string, unknown> | undefined
      if (!input) return false

      // Read tool uses file_path
      if (tool === 'Read' && input.file_path === normalizedPath) return true
      // Glob/Grep might reference the path
      return false
    })

    const editEvents = allToolEvents.filter((evt) => {
      const payload = evt.payload as Record<string, unknown>
      const tool = payload.tool as string
      const input = payload.input as Record<string, unknown> | undefined
      if (!input) return false

      // Write and Edit tools use file_path
      if ((tool === 'Write' || tool === 'Edit') && input.file_path === normalizedPath) return true
      return false
    })

    const lastRead = readEvents.length > 0 ? readEvents[readEvents.length - 1] : null
    const lastEdit = editEvents.length > 0 ? editEvents[editEvents.length - 1] : null

    return {
      filePath: normalizedPath,
      hasBeenRead: readEvents.length > 0,
      lastReadAt: lastRead?.timestamp ?? null,
      readCount: readEvents.length,
      hasBeenEdited: editEvents.length > 0,
      lastEditedAt: lastEdit?.timestamp ?? null,
      editCount: editEvents.length,
    }
  } finally {
    adapter.close()
  }
}

/**
 * Query the full tool call history for the current session graph.
 *
 * Optionally filter by tool name.
 */
export async function queryToolHistory(toolName?: string): Promise<ToolHistoryEntry[]> {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) return []

  const graphId = getGraphId()
  const adapter = new SqliteAdapter(dbPath)

  try {
    const events = await adapter.queryEvents(graphId, {
      type: 'custom.tool_called',
    })

    const entries: ToolHistoryEntry[] = events.map((evt) => {
      const payload = evt.payload as Record<string, unknown>
      return {
        tool: (payload.tool as string) ?? 'unknown',
        input: (payload.input as Record<string, unknown>) ?? {},
        timestamp: evt.timestamp,
        hookType: (payload.hook_type as string) ?? 'unknown',
      }
    })

    if (toolName) {
      return entries.filter((e) => e.tool === toolName)
    }

    return entries
  } finally {
    adapter.close()
  }
}

/**
 * Query all goals set in the current session graph.
 */
export async function queryGoals(): Promise<Array<{ goal: string; timestamp: string }>> {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) return []

  const graphId = getGraphId()
  const adapter = new SqliteAdapter(dbPath)

  try {
    const events = await adapter.queryEvents(graphId, {
      type: 'goal.set',
    })

    return events.map((evt) => {
      const payload = evt.payload as Record<string, unknown>
      return {
        goal: (payload.goal as string) ?? '',
        timestamp: evt.timestamp,
      }
    })
  } finally {
    adapter.close()
  }
}
