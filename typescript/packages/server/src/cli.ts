#!/usr/bin/env node

/**
 * Unified `operad` CLI — Dev inspection + Ops in one binary.
 *
 * Dev commands operate directly against the adapter (no HTTP server needed).
 * Set ADAPTER=postgres DATABASE_URL=... for production data.
 *
 * Usage:
 *   operad                              Show help
 *   operad serve [--port N]             Start HTTP server
 *   operad demo [name]                  Run a built-in demo
 *   operad graph create <id>            Create a new graph
 *   operad graph inspect <id>           Show objects, relations, events summary
 *   operad graph events <id> [--type x] List events with optional type filter
 *   operad graph objects <id> [--type x]List objects with optional type filter
 *   operad graph relations <id>         List relations
 *   operad graph fork <id> --at <evtId> Fork a graph at an event
 *   operad emit <graphId> <type> [json] Emit a custom event
 *   operad match <graphId> <pattern>    Run Cypher-subset pattern query
 *   operad patches <graphId>            List pending patches
 *   operad approve <patchId>            Approve a patch
 *   operad deny <patchId>               Deny a patch
 */

import type { StorageAdapter, Runtime, JsonValue } from '@operad/core'

// ─── Arg Parsing ────────────────────────────────────────────────────────────

interface ParsedArgs {
  positional: string[]
  flags: Record<string, string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = 'true'
      }
    } else {
      positional.push(arg)
    }
  }

  return { positional, flags }
}

// ─── Storage Factory ────────────────────────────────────────────────────────

async function createStorage(): Promise<StorageAdapter> {
  const adapterName = process.env.ADAPTER ?? 'memory'

  if (adapterName === 'postgres') {
    const url = process.env.DATABASE_URL
    if (!url) {
      console.error('ERROR: DATABASE_URL is required when ADAPTER=postgres')
      process.exit(1)
    }
    const { PostgresAdapter } = await import('@operad/adapter-postgres')
    return new PostgresAdapter({ connectionString: url })
  }

  const { MemoryAdapter } = await import('@operad/adapter-memory')
  return new MemoryAdapter()
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

function truncId(id: string, len = 16): string {
  if (id.length <= len) return id
  return id.slice(0, len - 2) + '..'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  )

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ')
  console.log(`  ${headerLine}`)

  for (const row of rows) {
    const line = row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  ')
    console.log(`  ${line}`)
  }
}

function truncData(data: Record<string, unknown>, maxLen = 40): string {
  const json = JSON.stringify(data)
  if (json.length <= maxLen) return json
  return json.slice(0, maxLen - 3) + '...'
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdServe(flags: Record<string, string>) {
  const port = parseInt(flags.port ?? process.env.PORT ?? '3111', 10)
  const storage = await createStorage()
  const adapterName = process.env.ADAPTER ?? 'memory'

  const { createApp } = await import('./index.js')
  const { serve } = await import('@hono/node-server')
  const { app } = createApp(storage)

  console.log()
  console.log('  ◆ Operad Server')
  console.log(`  ├─ http://localhost:${port}`)
  console.log(`  ├─ adapter: ${adapterName}`)
  console.log('  └─ ready')
  console.log()

  serve({ fetch: app.fetch, port })
}

async function cmdDemo(name: string | undefined) {
  const demos = ['primitives', 'insurance', 'fraud']
  const demoMap: Record<string, string> = {
    primitives: 'primitives-demo',
    insurance: 'insurance-agent',
    fraud: 'fraud-detection',
  }

  if (!name) {
    console.log()
    console.log('  ◆ Available demos:')
    for (const d of demos) {
      console.log(`    operad demo ${d}`)
    }
    console.log()
    return
  }

  const file = demoMap[name]
  if (!file) {
    console.error(`Unknown demo: "${name}". Available: ${demos.join(', ')}`)
    process.exit(1)
  }

  // Demos live in the example app — resolve at runtime via child process
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const { dirname, resolve } = await import('node:path')

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  // Try source first (dev), then dist (built)
  const candidates = [
    resolve(__dirname, '../../apps/example/src', `${file}.ts`),
    resolve(__dirname, '../../../apps/example/src', `${file}.ts`),
    resolve(__dirname, '../../apps/example/dist', `${file}.js`),
    resolve(__dirname, '../../../apps/example/dist', `${file}.js`),
  ]

  const { existsSync } = await import('node:fs')
  const found = candidates.find((c) => existsSync(c))

  if (!found) {
    console.error(`Failed to locate demo "${name}". Make sure the example app is built.`)
    console.error(`  Try: cd typescript && pnpm build`)
    console.error(`  Searched: ${candidates.join(', ')}`)
    process.exit(1)
  }

  // Resolve tsx binary from local node_modules
  const tsxCandidates = [
    resolve(__dirname, '../node_modules/.bin/tsx'),
    resolve(__dirname, '../../node_modules/.bin/tsx'),
    resolve(__dirname, '../../../node_modules/.bin/tsx'),
    resolve(__dirname, '../../apps/example/node_modules/.bin/tsx'),
  ]
  const tsxBin = tsxCandidates.find((c) => existsSync(c))

  if (!tsxBin) {
    console.error('ERROR: tsx not found. Install it: pnpm add -D tsx')
    process.exit(1)
  }

  try {
    execFileSync(tsxBin, [found], { stdio: 'inherit' })
  } catch {
    console.error(`Demo "${name}" exited with an error.`)
    process.exit(1)
  }
}

async function cmdGraphCreate(id: string, runtime: Runtime) {
  await runtime.createGraph(id)
  console.log(`◆ Graph created: ${id}`)
}

async function cmdGraphInspect(id: string, runtime: Runtime, storage: StorageAdapter) {
  const graph = runtime.getGraph(id)

  const [objects, relations, events] = await Promise.all([
    graph.queryObjects({}),
    graph.queryRelations({}),
    storage.queryEvents(id, {}),
  ])

  console.log()
  console.log(`◆ Graph: ${id}`)
  console.log()

  // ── ASCII graph visualization ──
  if (objects.length > 0) {
    console.log('Graph:')
    renderAsciiGraph(objects, relations)
    console.log()
  }

  // Objects table
  console.log(`Objects (${objects.length}):`)
  if (objects.length > 0) {
    table(
      ['ID', 'TYPE', 'DATA', 'UPDATED'],
      objects.map((o) => [
        truncId(o.id),
        o.type,
        truncData(o.data),
        timeAgo(o.updatedAt),
      ])
    )
  } else {
    console.log('  (none)')
  }
  console.log()

  // Relations table
  console.log(`Relations (${relations.length}):`)
  if (relations.length > 0) {
    table(
      ['SOURCE', 'TARGET', 'TYPE'],
      relations.map((r) => [truncId(r.sourceId), truncId(r.targetId), r.type])
    )
  } else {
    console.log('  (none)')
  }
  console.log()

  // Events summary
  console.log(`Events: ${events.length} total`)
  if (events.length > 0) {
    const byActor: Record<string, number> = {}
    const byType: Record<string, number> = {}
    for (const e of events) {
      const actor = e.actor ?? 'unknown'
      byActor[actor] = (byActor[actor] ?? 0) + 1
      byType[e.type] = (byType[e.type] ?? 0) + 1
    }

    const actorStr = Object.entries(byActor)
      .map(([a, c]) => `${a}=${c}`)
      .join(', ')
    console.log(`  By actor: ${actorStr}`)

    const typeStr = Object.entries(byType)
      .map(([t, c]) => `${t}=${c}`)
      .join(', ')
    console.log(`  By type: ${typeStr}`)
  }
  console.log()
}

/**
 * Renders a visual ASCII graph with box-drawn node cards and edge trees.
 *
 * Full IDs and full data are shown — no truncation. Box width adapts to content.
 * Outgoing edges shown as ├──▶ tree, incoming edges as ├──◀.
 * Topologically ordered via BFS. Isolated nodes marked with ○.
 */
function renderAsciiGraph(
  objects: Array<{ id: string; type: string; data: Record<string, unknown> }>,
  relations: Array<{ sourceId: string; targetId: string; type: string }>,
): void {
  // Lookups
  const objById = new Map(objects.map((o) => [o.id, o]))
  const connected = new Set<string>()

  // Group edges
  const outgoing = new Map<string, Array<{ targetId: string; type: string }>>()
  const incoming = new Map<string, Array<{ sourceId: string; type: string }>>()

  for (const rel of relations) {
    connected.add(rel.sourceId)
    connected.add(rel.targetId)
    if (!outgoing.has(rel.sourceId)) outgoing.set(rel.sourceId, [])
    outgoing.get(rel.sourceId)!.push({ targetId: rel.targetId, type: rel.type })
    if (!incoming.has(rel.targetId)) incoming.set(rel.targetId, [])
    incoming.get(rel.targetId)!.push({ sourceId: rel.sourceId, type: rel.type })
  }

  // Edge label builders — full IDs, no truncation
  const edgeLabel = (type: string, targetId: string): string => {
    const target = objById.get(targetId)
    const tLabel = target ? `${target.type}:${targetId}` : targetId
    return `${type} ── ${tLabel}`
  }

  const inEdgeLabel = (type: string, sourceId: string): string => {
    const source = objById.get(sourceId)
    const sLabel = source ? `${source.type}:${sourceId}` : sourceId
    return `${sLabel} ── ${type}`
  }

  // Format data as multi-line key: value pairs
  const dataLines = (data: Record<string, unknown>): string[] => {
    const entries = Object.entries(data)
    if (entries.length === 0) return ['(empty)']
    return entries.map(([k, v]) => {
      const val = typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
      return `${k}: ${val}`
    })
  }

  // Topological order via BFS
  const printed = new Set<string>()
  const order: string[] = []
  const roots = objects.filter((o) => outgoing.has(o.id) && !incoming.has(o.id))
  if (roots.length === 0) {
    for (const o of objects) {
      if (outgoing.has(o.id)) roots.push(o)
    }
  }
  const queue = [...roots]
  while (queue.length > 0) {
    const node = queue.shift()!
    if (printed.has(node.id)) continue
    printed.add(node.id)
    order.push(node.id)
    for (const e of outgoing.get(node.id) ?? []) {
      if (!printed.has(e.targetId)) queue.push(objById.get(e.targetId)!)
    }
  }
  for (const o of objects) {
    if (!printed.has(o.id)) order.push(o.id)
  }

  // Render each node with dynamic-width box
  const pad = (s: string, w: number) => s.length >= w ? s : s + ' '.repeat(w - s.length)
  let isFirst = true

  for (const id of order) {
    const obj = objById.get(id)!
    const isIsolated = !connected.has(id)
    const out = outgoing.get(id) ?? []
    const inc = incoming.get(id) ?? []
    const icon = isIsolated ? '○' : '●'

    // Collect all content lines to measure max width
    const idStr = isIsolated ? `${obj.id}  (isolated)` : obj.id
    const dLines = dataLines(obj.data)
    const outLabels = out.map((e) => `├──▶ ${edgeLabel(e.type, e.targetId)}`)
    if (outLabels.length > 0) outLabels[outLabels.length - 1] = '└' + outLabels[outLabels.length - 1].slice(1)
    const incLabels = (inc.length > 0 && !outgoing.has(id))
      ? inc.map((e) => `├──◀ ${inEdgeLabel(e.type, e.sourceId)}`)
      : []
    if (incLabels.length > 0) incLabels[incLabels.length - 1] = '└' + incLabels[incLabels.length - 1].slice(1)

    const allLines = [idStr, ...dLines, ...outLabels, ...incLabels]
    const maxContent = Math.max(...allLines.map((l) => l.length))
    const innerW = Math.max(maxContent, 20) // minimum width
    const boxW = innerW + 4 // "│  " + content + " │"

    // Connector between cards
    if (!isFirst && !isIsolated && inc.length > 0) {
      console.log('       │')
      console.log('       ▼')
    }
    if (!isFirst && isIsolated) console.log()
    isFirst = false

    // Top border
    const typeHeader = ` ${icon} ${obj.type} `
    const topFill = '─'.repeat(Math.max(0, boxW - 3 - typeHeader.length))
    console.log(`  ╭─${typeHeader}${topFill}╮`)

    // ID
    console.log(`  │  ${pad(idStr, innerW)} │`)

    // Data — each key on its own line
    for (const line of dLines) {
      console.log(`  │  ${pad(line, innerW)} │`)
    }

    // Outgoing edges
    if (outLabels.length > 0) {
      console.log(`  ├${'─'.repeat(boxW - 2)}┤`)
      for (const line of outLabels) {
        console.log(`  │  ${pad(line, innerW)} │`)
      }
    }

    // Incoming edges (leaf nodes only)
    if (incLabels.length > 0) {
      console.log(`  ├${'─'.repeat(boxW - 2)}┤`)
      for (const line of incLabels) {
        console.log(`  │  ${pad(line, innerW)} │`)
      }
    }

    // Bottom border
    console.log(`  ╰${'─'.repeat(boxW - 2)}╯`)
  }
}

async function cmdGraphEvents(
  id: string,
  flags: Record<string, string>,
  storage: StorageAdapter
) {
  const filter: Record<string, unknown> = {}
  if (flags.type) filter.type = flags.type

  const events = await storage.queryEvents(id, filter)

  console.log()
  console.log(`◆ Events for graph: ${id} (${events.length})`)
  console.log()

  if (events.length === 0) {
    console.log('  (no events)')
    return
  }

  table(
    ['ID', 'TYPE', 'ACTOR', 'TIME'],
    events.map((e) => [
      truncId(e.id),
      e.type,
      e.actor ?? '-',
      timeAgo(e.timestamp),
    ])
  )
  console.log()
}

async function cmdGraphObjects(
  id: string,
  flags: Record<string, string>,
  runtime: Runtime
) {
  const graph = runtime.getGraph(id)
  const filter: Record<string, unknown> = {}
  if (flags.type) filter.type = flags.type

  const objects = await graph.queryObjects(filter)

  console.log()
  console.log(`◆ Objects in graph: ${id} (${objects.length})`)
  console.log()

  if (objects.length === 0) {
    console.log('  (no objects)')
    return
  }

  table(
    ['ID', 'TYPE', 'DATA', 'UPDATED'],
    objects.map((o) => [
      truncId(o.id),
      o.type,
      truncData(o.data),
      timeAgo(o.updatedAt),
    ])
  )
  console.log()
}

async function cmdGraphRelations(id: string, runtime: Runtime) {
  const graph = runtime.getGraph(id)
  const relations = await graph.queryRelations({})

  console.log()
  console.log(`◆ Relations in graph: ${id} (${relations.length})`)
  console.log()

  if (relations.length === 0) {
    console.log('  (no relations)')
    return
  }

  table(
    ['SOURCE', 'TARGET', 'TYPE', 'DATA'],
    relations.map((r) => [
      truncId(r.sourceId),
      truncId(r.targetId),
      r.type,
      r.data ? truncData(r.data) : '-',
    ])
  )
  console.log()
}

async function cmdGraphFork(
  id: string,
  flags: Record<string, string>,
  runtime: Runtime
) {
  const atEvent = flags.at
  if (!atEvent) {
    console.error('ERROR: --at <eventId> is required for fork')
    process.exit(1)
  }

  const label = flags.label
  const forked = await runtime.fork(id, { atEvent, label })
  console.log(`◆ Forked graph "${id}" at event ${truncId(atEvent)}`)
  console.log(`  New graph: ${forked.id}`)
}

async function cmdEmit(
  graphId: string,
  type: string,
  jsonStr: string | undefined,
  runtime: Runtime
) {
  let payload: Record<string, JsonValue> = {}
  if (jsonStr) {
    try {
      payload = JSON.parse(jsonStr) as Record<string, JsonValue>
    } catch {
      console.error('ERROR: Invalid JSON payload')
      process.exit(1)
    }
  }

  const event = await runtime.emit(graphId, {
    type: type as 'custom.event',
    payload,
    actor: 'cli',
  })
  console.log(`◆ Event emitted: ${event.type} (${truncId(event.id)})`)
}

async function cmdMatch(graphId: string, pattern: string, runtime: Runtime) {
  const { parsePattern, matchPattern } = await import('@operad/core')
  const graph = runtime.getGraph(graphId)

  const parsed = parsePattern(pattern)
  const matches = await matchPattern(parsed, graph)

  console.log()
  console.log(`◆ Pattern: ${pattern}`)
  console.log(`  Matches: ${matches.length}`)
  console.log()

  for (let i = 0; i < matches.length; i++) {
    console.log(`  Match ${i + 1}:`)
    for (const [alias, node] of Object.entries(matches[i])) {
      const n = node as { id: string; type?: string; data?: Record<string, unknown> }
      if (n.data) {
        console.log(`    ${alias}: ${n.type} ${truncId(n.id)} ${truncData(n.data)}`)
      } else {
        console.log(`    ${alias}: ${truncId(n.id)}`)
      }
    }
  }
  console.log()
}

async function cmdPatches(graphId: string, runtime: Runtime) {
  const patches = runtime.pendingPatches(graphId)

  console.log()
  console.log(`◆ Pending patches for: ${graphId} (${patches.length})`)
  console.log()

  if (patches.length === 0) {
    console.log('  (no pending patches)')
    return
  }

  table(
    ['ID', 'TYPE', 'REASON', 'PROPOSED BY', 'CREATED'],
    patches.map((p) => [
      truncId(p.id),
      p.objectType,
      p.reason ?? '-',
      p.proposedBy ?? '-',
      timeAgo(p.createdAt),
    ])
  )
  console.log()
}

async function cmdApprove(patchId: string, runtime: Runtime) {
  await runtime.approve(patchId, 'cli-user')
  console.log(`◆ Patch approved: ${patchId}`)
}

async function cmdDeny(patchId: string, runtime: Runtime) {
  await runtime.deny(patchId, 'cli-user')
  console.log(`◆ Patch denied: ${patchId}`)
}

function printHelp() {
  console.log(`
  ◆ operad — unified CLI for the Operad event-sourced graph runtime

  Dev Commands:
    operad demo [name]                  Run a built-in demo (primitives, insurance, fraud)
    operad graph create <id>            Create a new graph
    operad graph inspect <id>           Show objects, relations, events summary
    operad graph events <id> [--type x] List events with optional type filter
    operad graph objects <id> [--type x]List objects with optional type filter
    operad graph relations <id>         List relations
    operad graph fork <id> --at <evtId> Fork a graph at an event
    operad emit <graphId> <type> [json] Emit a custom event
    operad match <graphId> <pattern>    Run Cypher-subset pattern query

  Ops Commands:
    operad serve [--port N]             Start HTTP server (default: 3111)
    operad patches <graphId>            List pending patches
    operad approve <patchId>            Approve a patch
    operad deny <patchId>               Deny a patch

  Environment:
    ADAPTER       "memory" (default) or "postgres"
    DATABASE_URL  Postgres connection string (required when ADAPTER=postgres)
    PORT          HTTP port for serve command (default: 3111)
`)
}

// ─── Main Router ────────────────────────────────────────────────────────────

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const cmd = positional[0]

  if (!cmd || cmd === 'help' || flags.help) {
    printHelp()
    return
  }

  // Commands that don't need runtime
  if (cmd === 'serve') {
    await cmdServe(flags)
    return
  }

  if (cmd === 'demo') {
    await cmdDemo(positional[1])
    return
  }

  // All other commands need storage + runtime
  const storage = await createStorage()
  const { createRuntime } = await import('@operad/core')
  const runtime = createRuntime({ storage })

  switch (cmd) {
    case 'graph': {
      const sub = positional[1]
      const id = positional[2]

      if (!sub) {
        console.error('Usage: operad graph <create|inspect|events|objects|relations|fork> <id>')
        process.exit(1)
      }

      if (!id && sub !== 'help') {
        console.error(`Usage: operad graph ${sub} <id>`)
        process.exit(1)
      }

      switch (sub) {
        case 'create':
          await cmdGraphCreate(id, runtime)
          break
        case 'inspect':
          await cmdGraphInspect(id, runtime, storage)
          break
        case 'events':
          await cmdGraphEvents(id, flags, storage)
          break
        case 'objects':
          await cmdGraphObjects(id, flags, runtime)
          break
        case 'relations':
          await cmdGraphRelations(id, runtime)
          break
        case 'fork':
          await cmdGraphFork(id, flags, runtime)
          break
        default:
          console.error(`Unknown graph subcommand: ${sub}`)
          printHelp()
          process.exit(1)
      }
      break
    }

    case 'emit': {
      const graphId = positional[1]
      const type = positional[2]
      if (!graphId || !type) {
        console.error('Usage: operad emit <graphId> <type> [json]')
        process.exit(1)
      }
      await cmdEmit(graphId, type, positional[3], runtime)
      break
    }

    case 'match': {
      const graphId = positional[1]
      const pattern = positional[2]
      if (!graphId || !pattern) {
        console.error('Usage: operad match <graphId> <pattern>')
        process.exit(1)
      }
      await cmdMatch(graphId, pattern, runtime)
      break
    }

    case 'patches': {
      const graphId = positional[1]
      if (!graphId) {
        console.error('Usage: operad patches <graphId>')
        process.exit(1)
      }
      await cmdPatches(graphId, runtime)
      break
    }

    case 'approve': {
      const patchId = positional[1]
      if (!patchId) {
        console.error('Usage: operad approve <patchId>')
        process.exit(1)
      }
      await cmdApprove(patchId, runtime)
      break
    }

    case 'deny': {
      const patchId = positional[1]
      if (!patchId) {
        console.error('Usage: operad deny <patchId>')
        process.exit(1)
      }
      await cmdDeny(patchId, runtime)
      break
    }

    default:
      console.error(`Unknown command: ${cmd}`)
      printHelp()
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('operad error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
