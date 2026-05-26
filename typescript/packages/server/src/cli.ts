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
import { renderAsciiGraph } from '@operad/core'

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

async function cmdInit(name: string | undefined) {
  const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
  const { resolve } = await import('node:path')

  const projectName = name ?? 'my-operad-agent'
  const dir = resolve(process.cwd(), projectName)

  if (existsSync(dir)) {
    console.error(`ERROR: Directory "${projectName}" already exists.`)
    process.exit(1)
  }

  mkdirSync(resolve(dir, 'src'), { recursive: true })

  // package.json
  writeFileSync(
    resolve(dir, 'package.json'),
    JSON.stringify(
      {
        name: projectName,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          start: 'tsx src/agent.ts',
          build: 'tsc',
        },
        dependencies: {
          '@operad/core': '^0.1.0',
          '@operad/adapter-memory': '^0.1.0',
        },
        devDependencies: {
          tsx: '^4.19.0',
          typescript: '^5.7.0',
        },
      },
      null,
      2
    ) + '\n'
  )

  // tsconfig.json
  writeFileSync(
    resolve(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'Node16',
          moduleResolution: 'Node16',
          strict: true,
          esModuleInterop: true,
          outDir: 'dist',
          rootDir: 'src',
          declaration: true,
        },
        include: ['src'],
      },
      null,
      2
    ) + '\n'
  )

  // src/agent.ts — starter agent based on the insurance demo
  writeFileSync(
    resolve(dir, 'src/agent.ts'),
    `/**
 * My Operad Agent — Starter Template
 *
 * This agent demonstrates the core Operad primitives:
 *   - Graph: Objects (nodes) + Relations (edges)
 *   - Event Log: Every mutation is an immutable event
 *   - Behaviors: Reactive handlers that fire on events
 *   - Decisions: Record choices with alternatives + confidence
 *
 * Run: npx tsx src/agent.ts
 */

import { createRuntime, behavior } from '@operad/core'
import type { GraphEvent, GraphAPI } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Define Behaviors ───────────────────────────────────────────────────────
// Behaviors are reactive subscriptions — they fire when matching events occur.

const logActivity = behavior({
  name: 'log-activity',
  on: ['object.created', 'relation.created'],
  handler: async (event: GraphEvent, graph: GraphAPI) => {
    console.log(\`  [behavior] \${event.type}: \${JSON.stringify(event.payload)}\`)
  },
})

// TODO(human): Add a custom behavior here
// Define a behavior that reacts to 'object.patched' events.
// Consider: What should happen when an object is updated?
// Maybe validate data, trigger a downstream action, or record a decision.

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const runtime = createRuntime({
    storage: new MemoryAdapter(),
    behaviors: [logActivity],
  })

  console.log('\\n◆ My Operad Agent\\n')

  // Create a graph — all objects, relations, and events live here
  const graph = await runtime.createGraph('my-agent')
  console.log('  ✓ Graph created: my-agent')

  // Add objects (nodes)
  const user = await graph.addObject({
    type: 'user',
    data: { name: 'Alice', role: 'admin' },
  })
  console.log(\`  + User: \${user.data.name}\`)

  const task = await graph.addObject({
    type: 'task',
    data: { title: 'Review report', status: 'open', priority: 'high' },
  })
  console.log(\`  + Task: \${task.data.title}\`)

  // Add a relation (edge)
  await graph.addRelation(user.id, task.id, 'assigned_to')
  console.log(\`  + Relation: \${user.data.name} → assigned_to → \${task.data.title}\`)

  // Patch an object — triggers behaviors
  console.log('\\n  → Updating task status...')
  await graph.patchObject(task.id, { status: 'in_progress' })

  // Record a decision — captures reasoning for audit
  const runtime2 = createRuntime({ storage: new MemoryAdapter() })
  console.log('\\n  ✓ Agent complete. Every action is event-sourced.')
  console.log('    Run \`operad graph inspect my-agent\` to see the full graph.\\n')
}

main().catch(console.error)
`
  )

  console.log()
  console.log(`  ◆ Project created: ${projectName}/`)
  console.log()
  console.log('  Next steps:')
  console.log(`    cd ${projectName}`)
  console.log('    npm install')
  console.log('    npx tsx src/agent.ts')
  console.log()
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
    for (const line of renderAsciiGraph(objects, relations)) {
      console.log(line)
    }
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

// renderAsciiGraph is imported from @operad/core

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
    operad init [name]                  Scaffold a new Operad project
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

  if (cmd === 'init') {
    await cmdInit(positional[1])
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
