#!/usr/bin/env node
/**
 * @operad/session hook — Real-time Claude Code hook that emits events into an Operad SQLite graph.
 *
 * Claude Code hooks fire shell commands on events like PreToolUse, PostToolUse, Notification.
 * The hook receives a JSON payload on stdin with the tool name, input, and session info.
 *
 * Usage:
 *   node dist/hook.js
 *
 * Environment:
 *   OPERAD_DB_PATH — Override the default ~/.operad/session.db path
 *   OPERAD_GRAPH_ID — Override the graph ID (defaults to CLAUDE_SESSION_ID or "default")
 *
 * Stdin payload (from Claude Code):
 *   {
 *     "hook_type": "PreToolUse" | "PostToolUse" | "Notification",
 *     "tool_name": "Read" | "Write" | "Edit" | "Bash" | ...,
 *     "tool_input": { ... },
 *     "session_id": "...",
 *     "message"?: { "role": "user", "content": "..." }
 *   }
 */

import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { SqliteAdapter } from '@operad/adapter-sqlite'
import { createRuntime } from '@operad/core'
import type { Runtime, JsonValue } from '@operad/core'
import { forkForSubagent, detectParentGraph } from './subagent.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HookPayload {
  hook_type: 'PreToolUse' | 'PostToolUse' | 'Notification'
  tool_name?: string
  tool_input?: Record<string, unknown>
  session_id?: string
  message?: {
    role: string
    content: string | Array<{ type: string; text?: string }>
  }
}

// ─── Configuration ────────────────────────────────────────────────────────────

function getDbPath(): string {
  const override = process.env['OPERAD_DB_PATH']
  if (override) return resolve(override)

  const dir = resolve(homedir(), '.operad')
  mkdirSync(dir, { recursive: true })
  return resolve(dir, 'session.db')
}

function getGraphId(payload: HookPayload): string {
  return (
    process.env['OPERAD_GRAPH_ID'] ??
    payload.session_id ??
    process.env['CLAUDE_SESSION_ID'] ??
    'default'
  )
}

// ─── Runtime Initialization ───────────────────────────────────────────────────

function initRuntime(): { runtime: Runtime; storage: SqliteAdapter } {
  const dbPath = getDbPath()
  const adapter = new SqliteAdapter(dbPath)
  return { runtime: createRuntime({ storage: adapter }), storage: adapter }
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

async function handleToolCalled(
  runtime: Runtime,
  graphId: string,
  payload: HookPayload,
): Promise<void> {
  const toolName = payload.tool_name ?? 'unknown'
  const toolInput = payload.tool_input ?? {}

  await runtime.emit(graphId, {
    type: 'custom.tool_called',
    payload: {
      tool: toolName,
      input: toolInput as unknown as JsonValue,
      hook_type: payload.hook_type,
      timestamp: new Date().toISOString(),
    },
    actor: 'claude-code',
  })
}

async function handleGoalSet(
  runtime: Runtime,
  graphId: string,
  payload: HookPayload,
): Promise<void> {
  const message = payload.message
  if (!message || message.role !== 'user') return

  // Extract text content from the message
  let content: string
  if (typeof message.content === 'string') {
    content = message.content
  } else if (Array.isArray(message.content)) {
    content = message.content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('\n')
  } else {
    return
  }

  if (!content.trim()) return

  await runtime.emit(graphId, {
    type: 'goal.set',
    payload: {
      goal: content.trim().slice(0, 500), // Cap at 500 chars for the event payload
      full_length: content.trim().length,
      timestamp: new Date().toISOString(),
    },
    actor: 'user',
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Read stdin (Claude Code pipes a JSON payload)
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) {
    process.exit(0)
  }

  let payload: HookPayload
  try {
    payload = JSON.parse(raw) as HookPayload
  } catch {
    process.stderr.write(`[operad-hook] Failed to parse stdin JSON: ${raw.slice(0, 200)}\n`)
    process.exit(1)
  }

  const { runtime, storage } = initRuntime()
  const graphId = getGraphId(payload)

  // Ensure the graph exists
  try {
    runtime.getGraph(graphId)
  } catch {
    // If this is a subagent, fork from the parent graph instead of creating empty
    const parentId = detectParentGraph()
    if (parentId && parentId !== graphId) {
      try {
        await forkForSubagent(parentId, graphId, runtime, storage)
      } catch {
        // Parent graph may not exist yet; fall back to empty graph
        await runtime.createGraph(graphId)
      }
    } else {
      await runtime.createGraph(graphId)
    }
  }

  try {
    switch (payload.hook_type) {
      case 'PreToolUse':
      case 'PostToolUse':
        await handleToolCalled(runtime, graphId, payload)
        break

      case 'Notification':
        // Notifications with user messages emit goal.set
        if (payload.message?.role === 'user') {
          await handleGoalSet(runtime, graphId, payload)
        }
        break

      default:
        // Unknown hook type — still emit as a generic event
        await runtime.emit(graphId, {
          type: 'custom.tool_called',
          payload: {
            hook_type: payload.hook_type,
            tool: payload.tool_name ?? 'unknown',
            input: (payload.tool_input ?? {}) as unknown as JsonValue,
            timestamp: new Date().toISOString(),
          },
          actor: 'claude-code',
        })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[operad-hook] Error emitting event: ${msg}\n`)
    process.exit(1)
  }

  process.exit(0)
}

main()
