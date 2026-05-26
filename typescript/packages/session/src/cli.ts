#!/usr/bin/env node
/**
 * operad-session — Git-like CLI for agent session graphs.
 *
 * Subcommands:
 *   commit <path.jsonl>         Import JSONL into the persistent graph
 *   inspect [--event <id>]      Show run summary or single event detail
 *   log [--graph <id>]          Show event history (like git log)
 *   blame [--graph <id>]        Show cost per goal
 *   diff <graph-a> <graph-b>    Compare two sessions
 *   fork --at-event <evt>       Fork a session at an event
 *   replay [--to-event <evt>]   Rebuild graph from events (time-travel)
 *   export-trace [--format]     Export trace as JSONL or text
 *   view [--graph <id>]         Open interactive timeline in browser
 *   stash [--graph <id>]        Show wasted work (redundant reads)
 *   revert <event-id>           Revert to a point (compensating events)
 *   explore <event-id> -n 3     Fork N branches from a point
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir, tmpdir, platform } from 'node:os'
import { execSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRuntime } from '@operad/core'
import type { GraphEvent, GraphDiff, RevertResult, ExploreResult } from '@operad/core'
import { SqliteAdapter } from '@operad/adapter-sqlite'
import { commit } from './session.js'
import { detectStash } from './waste.js'
import { renderHtmlGraph } from './render-html.js'
import { extractForkContext } from './context.js'
import type { RenderableObject, RenderableRelation } from '@operad/core'

// ─── Constants ──────────────────────────────────────────────────────────────

const DB_DIR = join(homedir(), '.operad')
const DB_PATH = join(DB_DIR, 'session.db')

// ─── Color Helpers ──────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY ?? false

const c = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  green: isTTY ? '\x1b[32m' : '',
  red: isTTY ? '\x1b[31m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
  blue: isTTY ? '\x1b[34m' : '',
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return `${n}`
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function getStorage(): SqliteAdapter {
  mkdirSync(DB_DIR, { recursive: true })
  return new SqliteAdapter(DB_PATH)
}

function parseArgs(argv: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }

  return { flags, positional }
}


// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdCommit(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  if (positional.length === 0) {
    console.error(`${c.red}Error:${c.reset} Missing JSONL file path.`)
    console.error(`Usage: operad-session commit <path.jsonl>`)
    process.exit(1)
  }

  const jsonlPath = resolve(positional[0])
  const jsonlText = (() => {
    try {
      return readFileSync(jsonlPath, 'utf-8')
    } catch {
      console.error(`${c.red}Error:${c.reset} Cannot read file: ${jsonlPath}`)
      process.exit(1)
    }
  })()

  const storage = getStorage()
  const runtime = createRuntime({ storage })
  const graphId = (flags['graph'] as string) ?? `session_${Date.now()}`

  const harness = flags['harness'] as string | undefined
  const validHarnesses = ['claude', 'codex', 'opencode'] as const
  const harnessOpt = harness && validHarnesses.includes(harness as typeof validHarnesses[number])
    ? harness as typeof validHarnesses[number]
    : undefined

  await runtime.createGraph(graphId)
  const log = await commit(jsonlText, { storage, runtime, graphId, harness: harnessOpt })
  storage.close()

  if (flags['json']) {
    console.log(JSON.stringify(log, null, 2))
  } else {
    const cost = log.blame.totalCost.toFixed(2)
    const saved = log.blame.cacheSavings.toFixed(2)
    const wasteCost = log.stash.potentialSavings.toFixed(2)

    console.log(`
${c.green}Committed${c.reset} ${jsonlPath}

${c.bold}Session:${c.reset}  ${c.cyan}${log.sessionId.slice(0, 8)}${c.reset} | ${log.goals} goals | ${log.toolCalls} tool calls
${c.bold}Cost:${c.reset}     $${cost} (saved $${saved} via prompt cache)
${c.bold}Stash:${c.reset}    ${log.stash.redundantReads} redundant reads (~${formatTokens(log.stash.tokensWasted)} tokens, ~$${wasteCost})
${c.bold}Files:${c.reset}    ${log.filesRead} read, ${log.filesEdited} edited
${c.bold}Graph:${c.reset}    ${c.yellow}${log.graphId}${c.reset}
${c.dim}Stored in: ${DB_PATH}${c.reset}
`)
  }
}

async function cmdLog(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = (flags['graph'] as string) ?? positional[0]
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} No graph specified.`)
    console.error(`Usage: operad-session log --graph <id>`)
    process.exit(1)
  }

  const storage = getStorage()
  const events = await storage.queryEvents(graphId, {})
  storage.close()

  if (events.length === 0) {
    console.error(`${c.yellow}No events found${c.reset} for graph: ${graphId}`)
    process.exit(0)
  }

  if (flags['json']) {
    console.log(JSON.stringify(events, null, 2))
    return
  }

  // Verbose mode (--verbose): git-log style with full detail
  if (flags['verbose']) {
    console.log(`${c.bold}Event log for graph:${c.reset} ${c.yellow}${graphId}${c.reset}`)
    console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)
    console.log()

    for (const event of events) {
      const typeColor = event.type.startsWith('custom.goal') ? c.green
        : event.type.startsWith('custom.tool') ? c.cyan
        : event.type.startsWith('custom.revert') ? c.red
        : c.magenta

      const shortId = event.id.slice(0, 12)
      const ts = formatTimestamp(event.timestamp)
      const actor = event.actor ? ` ${c.dim}(${event.actor})${c.reset}` : ''

      console.log(`${c.yellow}${shortId}${c.reset} ${typeColor}${event.type}${c.reset}${actor}`)
      console.log(`${c.dim}  ${ts}${c.reset}`)

      if (event.payload.tool) {
        console.log(`  tool: ${c.bold}${event.payload.tool}${c.reset}`)
      }
      if (event.payload.goal) {
        console.log(`  goal: ${c.green}${event.payload.goal}${c.reset}`)
      }
      if (event.payload.file_path) {
        console.log(`  file: ${event.payload.file_path}`)
      }
      if (event.causedBy) {
        console.log(`  ${c.dim}caused by: ${event.causedBy.slice(0, 12)}${c.reset}`)
      }
      console.log()
    }

    console.log(`${c.dim}Total: ${events.length} events${c.reset}`)
    return
  }

  // Default: compact streaming-style trace (like ActiveGraph)
  // Filter out internal bookkeeping events that are noise in the trace
  const internalTypes = new Set([
    'custom.blame_recorded',
    'custom.assistant_responded',
    'custom.reasoning_trace',
  ])
  const traceEvents = events.filter((e) => !internalTypes.has(e.type))

  console.log(`${c.bold}${c.yellow}${graphId}${c.reset} ${c.dim}— ${traceEvents.length} events (${events.length} total)${c.reset}`)
  console.log()

  for (const event of traceEvents) {
    // Format the event type — strip 'custom.' prefix for readability
    const rawType = event.type.replace(/^custom\./, '')

    // Color by category
    const typeColor = rawType === 'goal.set' || rawType === 'goal_started' ? c.green
      : rawType === 'tool_called' ? c.cyan
      : rawType === 'blame_recorded' ? c.yellow
      : rawType.startsWith('object.') || rawType.startsWith('relation.') ? c.magenta
      : rawType === 'reasoning_trace' || rawType === 'assistant_responded' ? c.blue
      : rawType.startsWith('revert') ? c.red
      : c.dim

    // Build the detail string
    let detail = ''
    const p = event.payload

    if (rawType === 'goal.set' || rawType === 'goal_started') {
      const text = (p.text as string) ?? (p.goal as string) ?? ''
      detail = `  ${c.green}"${text.replace(/\n/g, ' ').slice(0, 70)}"${c.reset}`
    } else if (rawType === 'tool_called') {
      const tool = (p.tool as string) ?? '?'
      const filePath = p.file_path as string | undefined
      const input = p.input as Record<string, unknown> | undefined
      const file = filePath ?? (input?.file_path as string | undefined) ?? ''
      const shortFile = file ? ` → ${file.split('/').slice(-2).join('/')}` : ''
      detail = `  ${c.bold}${tool}${c.reset}${c.dim}${shortFile}${c.reset}`
    } else if (rawType.startsWith('object.')) {
      const objType = p.objectType as string | undefined
      if (objType) detail = `  ${c.dim}${objType}${c.reset}`
    }

    const actor = event.actor ?? 'runtime'
    const actorStr = actor === 'agent' ? `${c.cyan}agent  ${c.reset}`
      : actor === 'user' ? `${c.green}user   ${c.reset}`
      : `${c.dim}${actor.padEnd(7)}${c.reset}`

    const typePadded = `[${rawType}]`.padEnd(22)
    console.log(`  ${typeColor}${typePadded}${c.reset} ${actorStr}${detail}`)
  }

  console.log()
  console.log(`${c.dim}Total: ${events.length} events${c.reset}`)
  console.log(`${c.dim}Use --verbose for full detail per event${c.reset}`)
}

async function cmdBlame(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = (flags['graph'] as string) ?? positional[0]
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} No graph specified.`)
    console.error(`Usage: operad-session blame --graph <id>`)
    process.exit(1)
  }

  const storage = getStorage()
  const events = await storage.queryEvents(graphId, {})
  storage.close()

  if (events.length === 0) {
    console.error(`${c.yellow}No events found${c.reset} for graph: ${graphId}`)
    process.exit(0)
  }

  // Group tool calls by goal
  interface GoalStats {
    goal: string
    toolCalls: number
    tools: Map<string, number>
    firstSeen: string
    lastSeen: string
  }

  const goals = new Map<string, GoalStats>()
  let currentGoal = '(no goal)'

  for (const event of events) {
    if (event.type === 'custom.goal_started') {
      currentGoal = (event.payload.goal as string) ?? '(unnamed goal)'
    }

    if (event.type === 'custom.tool_called') {
      const tool = (event.payload.tool as string) ?? 'unknown'
      let stats = goals.get(currentGoal)
      if (!stats) {
        stats = { goal: currentGoal, toolCalls: 0, tools: new Map(), firstSeen: event.timestamp, lastSeen: event.timestamp }
        goals.set(currentGoal, stats)
      }
      stats.toolCalls++
      stats.lastSeen = event.timestamp
      stats.tools.set(tool, (stats.tools.get(tool) ?? 0) + 1)
    }
  }

  if (flags['json']) {
    const result = Array.from(goals.values()).map((g) => ({
      goal: g.goal,
      toolCalls: g.toolCalls,
      tools: Object.fromEntries(g.tools),
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
    }))
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`${c.bold}Blame for graph:${c.reset} ${c.yellow}${graphId}${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)
  console.log()

  const sorted = Array.from(goals.values()).sort((a, b) => b.toolCalls - a.toolCalls)

  for (const stats of sorted) {
    const topTools = Array.from(stats.tools.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}(${count})`)
      .join(', ')

    console.log(`${c.green}${stats.goal}${c.reset}`)
    console.log(`  ${c.bold}${stats.toolCalls}${c.reset} tool calls: ${c.dim}${topTools}${c.reset}`)
    console.log(`  ${c.dim}${formatTimestamp(stats.firstSeen)} → ${formatTimestamp(stats.lastSeen)}${c.reset}`)
    console.log()
  }

  console.log(`${c.dim}Total: ${sorted.length} goals, ${sorted.reduce((s, g) => s + g.toolCalls, 0)} tool calls${c.reset}`)
}

async function cmdDiff(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  if (positional.length < 2) {
    console.error(`${c.red}Error:${c.reset} Need two graph IDs to compare.`)
    console.error(`Usage: operad-session diff <graph-a> <graph-b>`)
    process.exit(1)
  }

  const [graphA, graphB] = positional
  const storage = getStorage()
  const runtime = createRuntime({ storage })

  let diff: GraphDiff
  try {
    diff = await runtime.diff(graphA, graphB)
  } catch (err) {
    console.error(`${c.red}Error:${c.reset} ${(err as Error).message}`)
    storage.close()
    process.exit(1)
  }

  storage.close()

  if (flags['json']) {
    console.log(JSON.stringify(diff, null, 2))
    return
  }

  console.log(`${c.bold}Diff:${c.reset} ${c.yellow}${graphA}${c.reset} ↔ ${c.cyan}${graphB}${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)
  console.log()

  // Objects
  if (diff.objects.length > 0) {
    console.log(`${c.bold}Objects:${c.reset}`)
    for (const obj of diff.objects) {
      const sym = obj.status === 'added' ? `${c.green}+` : obj.status === 'removed' ? `${c.red}-` : `${c.yellow}~`
      console.log(`  ${sym} ${obj.type}${c.reset} ${c.dim}${obj.objectId.slice(0, 12)}${c.reset}`)
    }
    console.log()
  }

  // Relations
  if (diff.relations.length > 0) {
    console.log(`${c.bold}Relations:${c.reset}`)
    for (const rel of diff.relations) {
      const sym = rel.status === 'added' ? `${c.green}+` : `${c.red}-`
      console.log(`  ${sym} ${rel.type}${c.reset} ${c.dim}${rel.sourceId.slice(0, 8)} \u2192 ${rel.targetId.slice(0, 8)}${c.reset}`)
    }
    console.log()
  }

  // Event divergence
  console.log(`${c.bold}Event divergence:${c.reset}`)
  console.log(`  ${c.yellow}${graphA}${c.reset}: ${diff.sourceLog.length} events after fork`)
  console.log(`  ${c.cyan}${graphB}${c.reset}: ${diff.targetLog.length} events after fork`)
  console.log()

  const totalChanges = diff.objects.length + diff.relations.length
  const added = diff.objects.filter((o) => o.status === 'added').length + diff.relations.filter((r) => r.status === 'added').length
  const removed = diff.objects.filter((o) => o.status === 'removed').length + diff.relations.filter((r) => r.status === 'removed').length
  console.log(`${c.dim}Summary: ${totalChanges} changes (${c.green}+${added}${c.dim}, ${c.red}-${removed}${c.dim})${c.reset}`)
}

async function cmdStash(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = (flags['graph'] as string) ?? positional[0]
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} No graph specified.`)
    console.error(`Usage: operad-session stash --graph <id>`)
    process.exit(1)
  }

  const storage = getStorage()
  const events = await storage.queryEvents(graphId, {})
  storage.close()

  if (events.length === 0) {
    console.error(`${c.yellow}No events found${c.reset} for graph: ${graphId}`)
    process.exit(0)
  }

  const stash = detectStash(events)

  if (flags['json']) {
    // Include per-file breakdown
    const fileReads = buildFileReadBreakdown(events)
    console.log(JSON.stringify({ ...stash, files: fileReads }, null, 2))
    return
  }

  console.log(`${c.bold}Stash (wasted work) for graph:${c.reset} ${c.yellow}${graphId}${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)
  console.log()

  if (stash.redundantReads === 0) {
    console.log(`${c.green}No wasted work detected.${c.reset} All reads were necessary.`)
    return
  }

  console.log(`${c.red}${stash.redundantReads}${c.reset} redundant reads detected`)
  console.log(`${c.bold}Tokens wasted:${c.reset}  ~${formatTokens(stash.tokensWasted)}`)
  console.log(`${c.bold}Cost wasted:${c.reset}    ~$${stash.potentialSavings.toFixed(4)}`)
  console.log()

  // Per-file breakdown
  const fileReads = buildFileReadBreakdown(events)
  const redundant = fileReads.filter((f) => f.redundantCount > 0)
    .sort((a, b) => b.redundantCount - a.redundantCount)

  if (redundant.length > 0) {
    console.log(`${c.bold}Files with redundant reads:${c.reset}`)
    for (const f of redundant.slice(0, 15)) {
      console.log(`  ${c.red}${f.redundantCount}x${c.reset} ${f.path} ${c.dim}(${f.totalReads} total reads)${c.reset}`)
    }
    if (redundant.length > 15) {
      console.log(`  ${c.dim}... and ${redundant.length - 15} more${c.reset}`)
    }
  }
}

async function cmdGraph(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = (flags['graph'] as string) ?? positional[0]
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} No graph specified.`)
    console.error(`Usage: operad-session graph --graph <id>`)
    process.exit(1)
  }

  const storage = getStorage()
  const events = await storage.queryEvents(graphId, {})
  storage.close()

  if (events.length === 0) {
    console.error(`${c.yellow}No events found${c.reset} for graph: ${graphId}`)
    process.exit(0)
  }

  if (flags['json']) {
    // Build structured turn data
    const turns = buildTurns(events)
    console.log(JSON.stringify(turns, null, 2))
    return
  }

  // Summary header
  const goalEvents = events.filter(e => e.type === 'goal.set')
  const toolEvents = events.filter(e => e.type === 'custom.tool_called')
  const blameEvents = events.filter(e => e.type === 'custom.blame_recorded')
  const totalCost = blameEvents.reduce((sum, e) => sum + ((e.payload.cost as number) ?? 0), 0)

  console.log(`╔${'═'.repeat(66)}╗`)
  console.log(`║  ${c.bold}OPERAD EVENT GRAPH${c.reset} — ${c.cyan}${graphId}${c.reset}${' '.repeat(Math.max(0, 66 - 22 - graphId.length))}║`)
  console.log(`║  ${events.length} events │ ${goalEvents.length} goals │ ${toolEvents.length} tools │ $${totalCost.toFixed(2)} cost${' '.repeat(Math.max(0, 66 - 50 - totalCost.toFixed(2).length - String(events.length).length - String(goalEvents.length).length - String(toolEvents.length).length))}║`)
  console.log(`╚${'═'.repeat(66)}╝`)
  console.log()

  // Build turns (goal → events until next goal)
  const turns = buildTurns(events)

  const maxTurns = parseInt(flags['limit'] as string ?? '20', 10)
  const showAll = flags['all'] as boolean

  for (let i = 0; i < (showAll ? turns.length : Math.min(turns.length, maxTurns)); i++) {
    const turn = turns[i]
    const goalText = turn.goalText.replace(/\n/g, ' ').slice(0, 72)
    const turnToolEvents = turn.events.filter(e => e.type === 'custom.tool_called')
    const turnBlame = turn.events.filter(e => e.type === 'custom.blame_recorded')
    const turnCost = turnBlame.reduce((sum, e) => sum + ((e.payload.cost as number) ?? 0), 0)

    // Tool breakdown
    const tools: Record<string, number> = {}
    for (const e of turnToolEvents) {
      const t = (e.payload.tool as string) ?? '?'
      tools[t] = (tools[t] ?? 0) + 1
    }
    const toolStr = Object.entries(tools)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => n > 1 ? `${t}×${n}` : t)
      .join(', ')

    console.log(`  ${c.green}★${c.reset} ${c.bold}Goal #${i + 1}:${c.reset} ${goalText}`)
    console.log(`  │`)
    if (turnToolEvents.length > 0) {
      console.log(`  ├── ${c.cyan}⚙ Tools:${c.reset} ${toolStr}`)
    }
    if (turnCost > 0) {
      console.log(`  ├── ${c.yellow}$ Cost:${c.reset} $${turnCost.toFixed(2)}`)
    }
    console.log(`  ├── Events: ${turn.events.length}`)
    console.log(`  │`)
  }

  if (!showAll && turns.length > maxTurns) {
    console.log(`  ${c.dim}... +${turns.length - maxTurns} more turns (use --all to show all)${c.reset}`)
    console.log(`  │`)
  }

  console.log(`  ╰── ${c.bold}◉${c.reset} Graph complete: ${events.length} events`)
  console.log()

  // Tool distribution bar chart
  const toolCounts: Record<string, number> = {}
  for (const e of toolEvents) {
    const tool = (e.payload.tool as string) ?? '?'
    toolCounts[tool] = (toolCounts[tool] ?? 0) + 1
  }

  if (Object.keys(toolCounts).length > 0) {
    console.log(`  ${c.bold}Tool Distribution:${c.reset}`)
    console.log(`  ┌${'─'.repeat(48)}┐`)
    const maxCount = Math.max(...Object.values(toolCounts))
    const sorted = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    for (const [tool, count] of sorted) {
      const bar = '█'.repeat(Math.round((count / maxCount) * 28))
      console.log(`  │ ${tool.padEnd(12)}${bar.padEnd(30)}${String(count).padStart(3)} │`)
    }
    console.log(`  └${'─'.repeat(48)}┘`)
  }
}

interface Turn {
  goalText: string
  events: GraphEvent[]
}

function buildTurns(events: GraphEvent[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const e of events) {
    if (e.type === 'goal.set') {
      if (current) turns.push(current)
      current = { goalText: (e.payload.text as string) ?? '', events: [] }
    } else if (current) {
      current.events.push(e)
    }
  }
  if (current) turns.push(current)
  return turns
}

async function cmdRevert(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  if (positional.length === 0) {
    console.error(`${c.red}Error:${c.reset} Missing event ID to revert to.`)
    console.error(`Usage: operad-session revert <event-id> [--graph <id>]`)
    process.exit(1)
  }

  const eventId = positional[0]
  const graphId = flags['graph'] as string | undefined

  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} --graph is required for revert.`)
    console.error(`Usage: operad-session revert <event-id> --graph <id>`)
    process.exit(1)
  }

  const storage = getStorage()
  const runtime = createRuntime({ storage })

  let result: RevertResult
  try {
    result = await runtime.revert(graphId, {
      toEvent: eventId,
      reverseEffects: (flags['reverse-effects'] as boolean) ?? false,
      actor: 'operad-session-cli',
    })
  } catch (err) {
    console.error(`${c.red}Error:${c.reset} ${(err as Error).message}`)
    storage.close()
    process.exit(1)
  }

  storage.close()

  if (flags['json']) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`${c.bold}Reverted${c.reset} graph ${c.yellow}${graphId}${c.reset} to event ${c.cyan}${eventId.slice(0, 12)}${c.reset}`)
  console.log()
  console.log(`${c.bold}Events reverted:${c.reset}       ${result.eventsReverted}`)
  console.log(`${c.bold}Compensating events:${c.reset}   ${result.compensatingEvents.length}`)

  if (result.unreversible.length > 0) {
    console.log()
    console.log(`${c.yellow}Warning:${c.reset} ${result.unreversible.length} events could not be reversed (no handler):`)
    for (const evt of result.unreversible.slice(0, 5)) {
      console.log(`  ${c.dim}${evt.id.slice(0, 12)}${c.reset} ${evt.type}`)
    }
    if (result.unreversible.length > 5) {
      console.log(`  ${c.dim}... and ${result.unreversible.length - 5} more${c.reset}`)
    }
  }
}

async function cmdExplore(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  if (positional.length === 0) {
    console.error(`${c.red}Error:${c.reset} Missing event ID to explore from.`)
    console.error(`Usage: operad-session explore <event-id> -n <branches> --graph <id>`)
    process.exit(1)
  }

  const eventId = positional[0]
  const branches = parseInt(flags['n'] as string ?? '3', 10)
  const graphId = flags['graph'] as string | undefined

  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} --graph is required for explore.`)
    console.error(`Usage: operad-session explore <event-id> -n <branches> --graph <id>`)
    process.exit(1)
  }

  if (isNaN(branches) || branches < 1) {
    console.error(`${c.red}Error:${c.reset} -n must be a positive integer.`)
    process.exit(1)
  }

  const storage = getStorage()
  const runtime = createRuntime({ storage })

  let result: ExploreResult
  try {
    result = await runtime.explore(graphId, {
      atEvent: eventId,
      branches,
      worker: async (_graph, branchId) => {
        // Default worker: just creates the branch (no additional work)
        return { branchId, created: true }
      },
      scorer: (_result, _branchId) => {
        // Default scorer: random for demo purposes (real usage would pass custom scorer)
        return Math.random()
      },
      label: (flags['label'] as string) ?? 'explore',
    })
  } catch (err) {
    console.error(`${c.red}Error:${c.reset} ${(err as Error).message}`)
    storage.close()
    process.exit(1)
  }

  storage.close()

  if (flags['json']) {
    console.log(JSON.stringify({
      winnerId: result.winnerId,
      winnerScore: result.winnerScore,
      branches: result.branches,
    }, null, 2))
    return
  }

  console.log(`${c.bold}Explored${c.reset} ${branches} branches from event ${c.cyan}${eventId.slice(0, 12)}${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)
  console.log()

  for (const branch of result.branches) {
    const isWinner = branch.branchId === result.winnerId
    const marker = isWinner ? `${c.green}★${c.reset}` : ' '
    const scoreBar = '█'.repeat(Math.round(branch.score * 10))
    console.log(`${marker} ${c.cyan}${branch.branchId}${c.reset}`)
    console.log(`  score: ${c.bold}${branch.score.toFixed(3)}${c.reset} ${c.dim}${scoreBar}${c.reset}`)
  }

  console.log()
  console.log(`${c.green}Winner:${c.reset} ${c.bold}${result.winnerId}${c.reset} (score: ${result.winnerScore.toFixed(3)})`)
}

async function cmdInspect(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = (flags['graph'] as string) ?? positional[0]
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} No graph specified.`)
    console.error(`Usage: operad-session inspect --graph <id> [--event <evt-id>]`)
    process.exit(1)
  }

  const storage = getStorage()
  const events = await storage.queryEvents(graphId, {})

  if (events.length === 0) {
    console.error(`${c.yellow}No events found${c.reset} for graph: ${graphId}`)
    storage.close()
    process.exit(0)
  }

  // If --event specified, show single event detail
  const eventId = flags['event'] as string | undefined
  if (eventId) {
    const event = events.find((e) => e.id === eventId || e.id.startsWith(eventId))
    storage.close()
    if (!event) {
      console.error(`${c.red}Error:${c.reset} Event not found: ${eventId}`)
      process.exit(1)
    }
    if (flags['json']) {
      console.log(JSON.stringify(event, null, 2))
      return
    }
    console.log(`${c.bold}Event:${c.reset} ${c.yellow}${event.id}${c.reset}`)
    console.log(`${c.bold}Type:${c.reset}  ${c.cyan}${event.type}${c.reset}`)
    console.log(`${c.bold}Time:${c.reset}  ${formatTimestamp(event.timestamp)}`)
    console.log(`${c.bold}Actor:${c.reset} ${event.actor ?? 'runtime'}`)
    if (event.causedBy) {
      console.log(`${c.bold}Caused by:${c.reset} ${c.dim}${event.causedBy}${c.reset}`)
    }
    console.log()
    console.log(`${c.bold}Payload:${c.reset}`)
    console.log(JSON.stringify(event.payload, null, 2))
    return
  }

  // Otherwise show run summary (like ActiveGraph's inspect)
  storage.close()

  const goalEvents = events.filter((e) => e.type === 'goal.set')
  const toolEvents = events.filter((e) => e.type === 'custom.tool_called')
  const blameEvents = events.filter((e) => e.type === 'custom.blame_recorded')
  const totalCost = blameEvents.reduce((sum, e) => sum + ((e.payload.cost as number) ?? 0), 0)
  const firstTs = events[0].timestamp
  const lastTs = events[events.length - 1].timestamp

  // Extract model(s) used in the session
  const models = new Map<string, number>()
  for (const e of blameEvents) {
    const model = e.payload.model as string | undefined
    if (model && model !== 'unknown') {
      models.set(model, (models.get(model) ?? 0) + 1)
    }
  }
  const modelList = Array.from(models.entries()).sort((a, b) => b[1] - a[1])

  // Extract total tokens
  const totalInput = blameEvents.reduce((sum, e) => sum + ((e.payload.input_tokens as number) ?? 0), 0)
  const totalOutput = blameEvents.reduce((sum, e) => sum + ((e.payload.output_tokens as number) ?? 0), 0)
  const totalCacheRead = blameEvents.reduce((sum, e) => sum + ((e.payload.cache_read_input_tokens as number) ?? 0), 0)

  if (flags['json']) {
    console.log(JSON.stringify({
      graphId,
      state: 'committed',
      events: events.length,
      goals: goalEvents.length,
      toolCalls: toolEvents.length,
      totalCost,
      models: Object.fromEntries(models),
      tokens: { input: totalInput, output: totalOutput, cacheRead: totalCacheRead },
      firstEvent: firstTs,
      lastEvent: lastTs,
      tailEvents: events.slice(-5).map((e) => ({ id: e.id, type: e.type, timestamp: e.timestamp })),
    }, null, 2))
    return
  }

  console.log(`${c.bold}Inspect:${c.reset} ${c.yellow}${graphId}${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)
  console.log()
  console.log(`  ${c.bold}State:${c.reset}       committed`)
  console.log(`  ${c.bold}Events:${c.reset}      ${events.length}`)
  console.log(`  ${c.bold}Goals:${c.reset}       ${goalEvents.length}`)
  console.log(`  ${c.bold}Tool calls:${c.reset}  ${toolEvents.length}`)
  if (modelList.length > 0) {
    const primary = modelList[0]
    console.log(`  ${c.bold}Model:${c.reset}       ${c.cyan}${primary[0]}${c.reset} ${c.dim}(${primary[1]} calls)${c.reset}`)
    for (const [model, count] of modelList.slice(1)) {
      console.log(`               ${c.cyan}${model}${c.reset} ${c.dim}(${count} calls)${c.reset}`)
    }
  }
  console.log(`  ${c.bold}Total cost:${c.reset}  $${totalCost.toFixed(2)}`)
  console.log(`  ${c.bold}Tokens:${c.reset}      ${formatTokens(totalInput)} in / ${formatTokens(totalOutput)} out / ${formatTokens(totalCacheRead)} cached`)
  console.log(`  ${c.bold}First event:${c.reset} ${formatTimestamp(firstTs)}`)
  console.log(`  ${c.bold}Last event:${c.reset}  ${formatTimestamp(lastTs)}`)
  console.log()

  // Tail of recent events
  const tail = parseInt(flags['tail'] as string ?? '5', 10)
  console.log(`  ${c.bold}Recent events (tail ${tail}):${c.reset}`)
  for (const event of events.slice(-tail)) {
    const shortId = event.id.slice(0, 12)
    console.log(`    ${c.dim}${shortId}${c.reset} ${c.cyan}${event.type}${c.reset} ${c.dim}${formatTimestamp(event.timestamp)}${c.reset}`)
  }
}

async function cmdFork(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = flags['graph'] as string | undefined
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} --graph is required.`)
    console.error(`Usage: operad-session fork --graph <id> --at-event <evt> [--label <name>]`)
    process.exit(1)
  }

  const atEvent = (flags['at-event'] as string) ?? positional[0]
  if (!atEvent) {
    console.error(`${c.red}Error:${c.reset} --at-event is required.`)
    console.error(`Usage: operad-session fork --graph <id> --at-event <evt> [--label <name>]`)
    process.exit(1)
  }

  const label = (flags['label'] as string) ?? 'fork'
  const runInstruction = flags['run'] as string | undefined
  const model = (flags['model'] as string) ?? 'claude-sonnet-4'
  const maxBudget = parseFloat((flags['max-budget'] as string) ?? '5.00')
  const noDiff = flags['no-diff'] === true

  const storage = getStorage()
  const runtime = createRuntime({ storage })

  let branchGraph: Awaited<ReturnType<typeof runtime.branch>>
  try {
    branchGraph = await runtime.branch(graphId, {
      atEvent,
      label,
    })
  } catch (err) {
    console.error(`${c.red}Error:${c.reset} ${(err as Error).message}`)
    storage.close()
    process.exit(1)
  }

  console.log(`${c.green}Forked${c.reset} ${c.yellow}${graphId}${c.reset} at event ${c.cyan}${atEvent.slice(0, 12)}${c.reset}`)
  console.log(`  ${c.bold}Branch:${c.reset} ${c.cyan}${branchGraph.id}${c.reset}`)
  console.log()

  // ─── --run: Execute Claude CLI on the fork ───────────────────────────────
  if (runInstruction) {
    // 1. Extract context from parent graph up to fork point
    const events = await storage.queryEvents(graphId, {})
    const { systemPrompt, workingDir } = extractForkContext(events, atEvent)

    // 2. Spawn Claude CLI
    const sessionId = randomUUID()
    console.log(`${c.bold}Running Claude${c.reset} (${c.dim}${model}, budget: $${maxBudget.toFixed(2)}${c.reset})`)
    console.log(`  ${c.bold}Prompt:${c.reset} "${runInstruction}"`)
    console.log(`  ⏳ Executing...`)
    console.log()

    const cwd = workingDir ?? process.cwd()
    const result = spawnSync('claude', [
      '--print',
      '--model', model,
      '--system-prompt', systemPrompt,
      '--session-id', sessionId,
      '--output-format', 'text',
      '--max-turns', '50',
      '--dangerously-skip-permissions',
      runInstruction,
    ], {
      cwd,
      env: {
        ...process.env,
        OPERAD_GRAPH_ID: branchGraph.id,
        OPERAD_DB_PATH: DB_PATH,
      },
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: 300_000, // 5 minute timeout
    })

    if (result.error) {
      console.error(`${c.red}Error spawning Claude:${c.reset} ${result.error.message}`)
      storage.close()
      process.exit(1)
    }

    if (result.status !== 0) {
      console.error(`${c.red}Claude exited with code ${result.status}${c.reset}`)
    }

    // 3. Find the JSONL file (Claude CLI writes to ~/.claude/projects/<project>/<session-id>.jsonl)
    const claudeDir = join(homedir(), '.claude', 'projects')
    const jsonlPath = findJsonlBySessionId(claudeDir, sessionId)

    if (jsonlPath) {
      // 4. Commit JSONL to the fork graph
      const jsonlText = readFileSync(jsonlPath, 'utf-8')
      const sessionLog = await commit(jsonlText, {
        storage,
        runtime,
        graphId: branchGraph.id,
      })

      console.log()
      console.log(`  ${c.green}✅ Done${c.reset} — ${sessionLog.toolCalls} tool calls, $${sessionLog.blame.totalCost.toFixed(2)}`)
      console.log(`  ${c.dim}Committed to fork graph: ${branchGraph.id}${c.reset}`)
    } else {
      console.log()
      console.log(`  ${c.yellow}⚠ No JSONL found${c.reset} for session ${sessionId.slice(0, 8)}...`)
      console.log(`  ${c.dim}Claude may not have written a session file.${c.reset}`)
    }

    // 5. Auto-diff parent vs fork
    if (!noDiff) {
      console.log()
      try {
        const diff = await runtime.diff(graphId, branchGraph.id)
        const added = diff.objects.filter((o) => o.status === 'added').length +
          diff.relations.filter((r) => r.status === 'added').length
        const removed = diff.objects.filter((o) => o.status === 'removed').length +
          diff.relations.filter((r) => r.status === 'removed').length

        console.log(`${c.bold}Diff:${c.reset} ${c.yellow}${graphId}${c.reset} ↔ ${c.cyan}${branchGraph.id}${c.reset}`)
        console.log(`  ${c.green}+${added}${c.reset} added, ${c.red}-${removed}${c.reset} removed`)
        console.log(`  Original: ${diff.sourceLog.length} events | Fork: ${diff.targetLog.length} events`)
      } catch {
        // Diff may fail if parent has no divergent events — that's fine
        console.log(`${c.dim}(diff skipped — no divergent events yet)${c.reset}`)
      }
    }

    storage.close()
    return
  }

  // ─── Without --run: existing behavior (empty fork) ───────────────────────
  storage.close()

  if (flags['json']) {
    console.log(JSON.stringify({
      parentGraphId: graphId,
      forkGraphId: branchGraph.id,
      atEvent,
      label,
    }, null, 2))
    return
  }

  console.log(`  ${c.bold}Label:${c.reset}     ${label}`)
  console.log()
  console.log(`${c.dim}Use "operad-session diff ${graphId} ${branchGraph.id}" to compare after making changes.${c.reset}`)
}

/**
 * Recursively search for a JSONL file matching a session ID under a directory.
 * Claude CLI writes session files as: ~/.claude/projects/<project-hash>/<session-id>.jsonl
 */
function findJsonlBySessionId(baseDir: string, sessionId: string): string | null {
  if (!existsSync(baseDir)) return null

  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
  const targetFilename = `${sessionId}.jsonl`

  try {
    const entries = readdirSync(baseDir)
    for (const entry of entries) {
      const fullPath = join(baseDir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        // Check if the target file is in this subdirectory
        const candidate = join(fullPath, targetFilename)
        if (existsSync(candidate)) return candidate
        // Also check nested dirs (one level deep is usually enough)
        const nested = findJsonlBySessionId(fullPath, sessionId)
        if (nested) return nested
      } else if (entry === targetFilename) {
        return fullPath
      }
    }
  } catch {
    // Permission errors or missing dirs — ignore
  }
  return null
}

async function cmdReplay(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = (flags['graph'] as string) ?? positional[0]
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} No graph specified.`)
    console.error(`Usage: operad-session replay --graph <id> [--to-event <evt>]`)
    process.exit(1)
  }

  const storage = getStorage()
  const events = await storage.queryEvents(graphId, {})

  if (events.length === 0) {
    console.error(`${c.yellow}No events found${c.reset} for graph: ${graphId}`)
    storage.close()
    process.exit(0)
  }

  const toEvent = flags['to-event'] as string | undefined

  // Rebuild graph from events up to the specified point
  const runtime = createRuntime({ storage })

  if (toEvent) {
    // Checkout to specific event
    try {
      await runtime.checkout(graphId, toEvent)
    } catch (err) {
      console.error(`${c.red}Error:${c.reset} ${(err as Error).message}`)
      storage.close()
      process.exit(1)
    }
  }

  const objects = await storage.queryObjects(graphId, {})
  const relations = await storage.queryRelations(graphId, {})
  storage.close()

  if (flags['json']) {
    console.log(JSON.stringify({
      graphId,
      replayedTo: toEvent ?? events[events.length - 1].id,
      objects: objects.length,
      relations: relations.length,
      events: events.length,
    }, null, 2))
    return
  }

  const target = toEvent ? `event ${toEvent.slice(0, 12)}` : 'latest'
  console.log(`${c.bold}Replayed${c.reset} ${c.yellow}${graphId}${c.reset} to ${c.cyan}${target}${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)
  console.log()
  console.log(`  ${c.bold}Events:${c.reset}    ${events.length}`)
  console.log(`  ${c.bold}Objects:${c.reset}   ${objects.length}`)
  console.log(`  ${c.bold}Relations:${c.reset} ${relations.length}`)

  // Type breakdown
  const byType: Record<string, number> = {}
  for (const obj of objects) {
    byType[obj.type] = (byType[obj.type] ?? 0) + 1
  }
  console.log()
  console.log(`  ${c.bold}Object types:${c.reset}`)
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(3)} ${type}`)
  }
}

async function cmdExportTrace(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = (flags['graph'] as string) ?? positional[0]
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} No graph specified.`)
    console.error(`Usage: operad-session export-trace --graph <id> [--format jsonl|text] [--out <path>]`)
    process.exit(1)
  }

  const format = (flags['format'] as string) ?? 'jsonl'
  const outPath = flags['out'] as string | undefined

  const storage = getStorage()
  const events = await storage.queryEvents(graphId, {})
  storage.close()

  if (events.length === 0) {
    console.error(`${c.yellow}No events found${c.reset} for graph: ${graphId}`)
    process.exit(0)
  }

  let output: string

  if (format === 'jsonl') {
    output = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  } else {
    // Text format: human-readable trace
    const lines: string[] = []
    lines.push(`# Trace: ${graphId}`)
    lines.push(`# Events: ${events.length}`)
    lines.push(`# Exported: ${new Date().toISOString()}`)
    lines.push('')

    for (const event of events) {
      const ts = formatTimestamp(event.timestamp)
      const actor = event.actor ?? 'runtime'
      lines.push(`[${ts}] ${event.type} (${actor})`)

      if (event.payload.goal) lines.push(`  goal: ${event.payload.goal}`)
      if (event.payload.tool) lines.push(`  tool: ${event.payload.tool}`)
      if (event.payload.file_path) lines.push(`  file: ${event.payload.file_path}`)
      if (event.payload.cost) lines.push(`  cost: $${(event.payload.cost as number).toFixed(4)}`)
      lines.push('')
    }
    output = lines.join('\n')
  }

  if (outPath) {
    writeFileSync(resolve(outPath), output, 'utf-8')
    console.error(`${c.green}Exported${c.reset} ${events.length} events to ${outPath} (${format})`)
  } else {
    // Write to stdout
    process.stdout.write(output)
  }
}

async function cmdView(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const graphId = (flags['graph'] as string) ?? positional[0]
  if (!graphId) {
    console.error(`${c.red}Error:${c.reset} No graph specified.`)
    console.error(`Usage: operad-session view --graph <id>`)
    process.exit(1)
  }

  const storage = getStorage()

  // Objects + relations were projected during `commit` — just query them
  let objects = await storage.queryObjects(graphId, {})
  let relations = await storage.queryRelations(graphId, {})

  if (objects.length === 0) {
    // Fallback: maybe only events exist (committed with older version)
    // Re-project from events
    const events = await storage.queryEvents(graphId, {})
    if (events.length === 0) {
      console.error(`${c.yellow}No events found${c.reset} for graph: ${graphId}`)
      storage.close()
      process.exit(0)
    }

    const runtime = createRuntime({ storage })
    const graph = runtime.getGraph(graphId)
    const { projectGraph } = await import('./projector.js')
    await projectGraph(graph, events)

    objects = await storage.queryObjects(graphId, {})
    relations = await storage.queryRelations(graphId, {})
  }
  storage.close()

  const renderableObjects: RenderableObject[] = objects.map((o) => ({
    id: o.id,
    type: o.type,
    data: { ...o.data, _createdAt: o.createdAt } as Record<string, unknown>,
  }))

  const renderableRelations: RenderableRelation[] = relations.map((r) => ({
    sourceId: r.sourceId,
    targetId: r.targetId,
    type: r.type,
  }))

  const html = renderHtmlGraph(renderableObjects, renderableRelations, {
    title: `Session: ${graphId}`,
  })

  // Write output
  const outputPath = (flags['output'] as string)
    ? resolve(flags['output'] as string)
    : join(tmpdir(), `operad-graph-${graphId.replace(/[^a-zA-Z0-9_-]/g, '_')}.html`)

  writeFileSync(outputPath, html, 'utf-8')
  console.log(`${c.green}Wrote${c.reset} ${outputPath}`)
  console.log(`${c.dim}${renderableObjects.length} nodes, ${renderableRelations.length} edges${c.reset}`)

  // Auto-open in browser unless --no-open
  if (!flags['no-open']) {
    try {
      const cmd = platform() === 'darwin' ? 'open' : 'xdg-open'
      execSync(`${cmd} "${outputPath}"`, { stdio: 'ignore' })
      console.log(`${c.cyan}Opened${c.reset} in default browser`)
    } catch {
      console.log(`${c.yellow}Could not auto-open.${c.reset} Open manually: ${outputPath}`)
    }
  }
}

// ─── Stash Helpers ──────────────────────────────────────────────────────────

interface FileReadInfo {
  path: string
  totalReads: number
  redundantCount: number
}

function buildFileReadBreakdown(events: GraphEvent[]): FileReadInfo[] {
  const reads = new Map<string, { total: number; redundant: number }>()
  const editIndices = new Map<string, number>()
  const lastReadIndex = new Map<string, number>()

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (event.type !== 'custom.tool_called') continue

    const tool = event.payload.tool as string
    const input = event.payload.input as Record<string, unknown> | undefined

    if (tool === 'Edit' || tool === 'Write') {
      const filePath = (input?.file_path as string) ?? ''
      if (filePath) editIndices.set(filePath, i)
      continue
    }

    if (tool === 'Read') {
      const filePath = (input?.file_path as string) ?? ''
      if (!filePath) continue

      const record = reads.get(filePath) ?? { total: 0, redundant: 0 }
      record.total++

      const lastEdit = editIndices.get(filePath) ?? -1
      const prevRead = lastReadIndex.get(filePath) ?? -1

      if (prevRead >= 0 && lastEdit <= prevRead) {
        record.redundant++
      }

      reads.set(filePath, record)
      lastReadIndex.set(filePath, i)
    }
  }

  return Array.from(reads.entries()).map(([path, info]) => ({
    path,
    totalReads: info.total,
    redundantCount: info.redundant,
  }))
}

// ─── Main ───────────────────────────────────────────────────────────────────

const HELP = `
${c.bold}operad-session${c.reset} — Git-like CLI for agent session graphs

${c.bold}USAGE${c.reset}
  operad-session <command> [options]

${c.bold}COMMANDS${c.reset}
  ${c.green}commit${c.reset} <path.jsonl>          Import JSONL into the persistent graph
  ${c.green}inspect${c.reset} --graph <id>          Show run summary (events, goals, cost, tail)
  ${c.green}inspect${c.reset} --graph <id> --event <evt>  Show full payload for one event
  ${c.green}graph${c.reset} --graph <id>            Show ASCII event graph (turn-based view)
  ${c.green}log${c.reset} --graph <id>             Show event history (like git log)
  ${c.green}blame${c.reset} --graph <id>           Show cost per goal (which goal spent how much)
  ${c.green}diff${c.reset} <graph-a> <graph-b>     Compare two sessions
  ${c.green}fork${c.reset} --graph <id> --at-event <evt>  Fork a session at an event
        [--run "<instruction>"]      Run Claude on the fork with new instructions
        [--model <model>]            Model to use (default: claude-sonnet-4)
        [--max-budget <dollars>]     Budget cap (default: 5.00)
        [--no-diff]                  Skip auto-diff after run
  ${c.green}replay${c.reset} --graph <id>           Rebuild graph from events (time-travel)
  ${c.green}export-trace${c.reset} --graph <id>     Export trace as JSONL or text
  ${c.green}stash${c.reset} --graph <id>           Show wasted work (redundant reads)
  ${c.green}revert${c.reset} <event-id> --graph <id>  Revert to a point (compensating events)
  ${c.green}view${c.reset} --graph <id>            Open interactive timeline in browser
  ${c.green}explore${c.reset} <event-id> -n 3 --graph <id>  Fork N branches from a point

${c.bold}GLOBAL OPTIONS${c.reset}
  --json          Machine-readable JSON output
  --graph <id>    Target graph ID
  --help, -h      Show this help

${c.bold}STORAGE${c.reset}
  All data is persisted to: ${c.dim}${DB_PATH}${c.reset}

${c.bold}EXAMPLES${c.reset}
  ${c.dim}# Import a Claude Code session${c.reset}
  operad-session commit ~/.claude/projects/myapp/session.jsonl

  ${c.dim}# Inspect a session${c.reset}
  operad-session inspect --graph session_1716000000000

  ${c.dim}# View a single event's full payload${c.reset}
  operad-session inspect --graph session_1716000000000 --event evt_17160000

  ${c.dim}# Fork at an event (empty fork for manual changes)${c.reset}
  operad-session fork --graph session_1716000000000 --at-event evt_17160000 --label cautious

  ${c.dim}# Fork and run Claude with alternative instructions${c.reset}
  operad-session fork --graph session_1716000000000 --at-event evt_17160000 \\
    --run "Use session cookies instead of JWT" --model claude-sonnet-4 --max-budget 2.00

  ${c.dim}# Compare parent vs fork${c.reset}
  operad-session diff session_1716000000000 session_1716000000000_cautious

  ${c.dim}# Replay to a specific point (time-travel)${c.reset}
  operad-session replay --graph session_1716000000000 --to-event evt_17160000

  ${c.dim}# Export trace as JSONL (pipe to other tools)${c.reset}
  operad-session export-trace --graph session_1716000000000 --format jsonl --out trace.jsonl

  ${c.dim}# Open interactive timeline in browser${c.reset}
  operad-session view --graph session_1716000000000

  ${c.dim}# See cost breakdown per goal${c.reset}
  operad-session blame --graph session_1716000000000

  ${c.dim}# Find wasted reads${c.reset}
  operad-session stash --graph session_1716000000000

  ${c.dim}# Explore 3 branches from a point${c.reset}
  operad-session explore evt_17160000 -n 3 --graph session_1716000000000
`

async function main() {
  const argv = process.argv.slice(2)

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    process.exit(0)
  }

  const command = argv[0]
  const { flags, positional } = parseArgs(argv.slice(1))

  // Also check for --help on subcommands
  if (flags['help'] || flags['h']) {
    console.log(HELP)
    process.exit(0)
  }

  switch (command) {
    case 'commit':
      await cmdCommit(positional, flags)
      break
    case 'inspect':
      await cmdInspect(positional, flags)
      break
    case 'graph':
      await cmdGraph(positional, flags)
      break
    case 'log':
      await cmdLog(positional, flags)
      break
    case 'blame':
      await cmdBlame(positional, flags)
      break
    case 'diff':
      await cmdDiff(positional, flags)
      break
    case 'fork':
      await cmdFork(positional, flags)
      break
    case 'replay':
      await cmdReplay(positional, flags)
      break
    case 'export-trace':
      await cmdExportTrace(positional, flags)
      break
    case 'stash':
      await cmdStash(positional, flags)
      break
    case 'revert':
      await cmdRevert(positional, flags)
      break
    case 'explore':
      await cmdExplore(positional, flags)
      break
    case 'view':
      await cmdView(positional, flags)
      break
    default:
      // Backward compat: if it looks like a file path, treat as commit
      if (command.endsWith('.jsonl') || command.includes('/')) {
        await cmdCommit([command, ...positional], flags)
      } else {
        console.error(`${c.red}Error:${c.reset} Unknown command: ${command}`)
        console.error(`Run "operad-session --help" for usage.`)
        process.exit(1)
      }
  }
}

main().catch((err) => {
  console.error(`${c.red}Error:${c.reset} ${err.message ?? err}`)
  process.exit(1)
})
