#!/usr/bin/env node
/**
 * operad-session — Git-like CLI for agent session graphs.
 *
 * Subcommands:
 *   commit <path.jsonl>       Import JSONL into the persistent graph
 *   log [--graph <id>]        Show event history (like git log)
 *   blame [--graph <id>]      Show cost per goal
 *   diff <graph-a> <graph-b>  Compare two sessions
 *   stash [--graph <id>]      Show wasted work (redundant reads)
 *   revert <event-id>         Revert to a point (compensating events)
 *   explore <event-id> -n 3   Fork N branches from a point
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { createRuntime } from '@operad/core'
import type { GraphEvent, GraphDiff, RevertResult, ExploreResult } from '@operad/core'
import { SqliteAdapter } from '@operad/adapter-sqlite'
import { commit } from './session.js'
import { detectStash } from './waste.js'

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

  // Display like git log
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

    // Show payload highlights
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
  ${c.green}log${c.reset} --graph <id>             Show event history (like git log)
  ${c.green}blame${c.reset} --graph <id>           Show cost per goal (which goal spent how much)
  ${c.green}diff${c.reset} <graph-a> <graph-b>     Compare two sessions
  ${c.green}stash${c.reset} --graph <id>           Show wasted work (redundant reads)
  ${c.green}revert${c.reset} <event-id> --graph <id>  Revert to a point (compensating events)
  ${c.green}explore${c.reset} <event-id> -n 3 --graph <id>  Fork N branches from a point

${c.bold}GLOBAL OPTIONS${c.reset}
  --json          Machine-readable JSON output
  --graph <id>    Target graph ID
  --help, -h      Show this help

${c.bold}STORAGE${c.reset}
  All data is persisted to: ${c.dim}${DB_PATH}${c.reset}

${c.bold}EXAMPLES${c.reset}
  ${c.dim}# Import a session${c.reset}
  operad-session commit ~/.claude/projects/myapp/session.jsonl

  ${c.dim}# View event log${c.reset}
  operad-session log --graph session_1716000000000

  ${c.dim}# See cost breakdown per goal${c.reset}
  operad-session blame --graph session_1716000000000

  ${c.dim}# Compare two sessions${c.reset}
  operad-session diff session_a session_b

  ${c.dim}# Find wasted reads${c.reset}
  operad-session stash --graph session_1716000000000

  ${c.dim}# Revert to a specific point${c.reset}
  operad-session revert evt_17160000 --graph session_1716000000000

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
    case 'log':
      await cmdLog(positional, flags)
      break
    case 'blame':
      await cmdBlame(positional, flags)
      break
    case 'diff':
      await cmdDiff(positional, flags)
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
