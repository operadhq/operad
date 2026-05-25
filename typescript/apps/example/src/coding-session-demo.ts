/**
 * Operad Example: Coding Session → Graph → Visual Timeline
 *
 * Shows the core loop: JSONL in → event graph → queryable state → visual output.
 *
 * Two modes:
 *   1. Default: uses a bundled synthetic session (no setup required)
 *   2. With arg: `pnpm demo:coding path/to/session.jsonl` — your own session
 *
 * Every Claude Code session lives at ~/.claude/projects/<project>/<id>.jsonl
 *
 * Run: pnpm demo:coding
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { createRuntime } from '@operad/core'
import type { RenderableObject, RenderableRelation } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { commit, renderHtmlGraph } from '@operad/session'

// ─── Bundled Fixture ────────────────────────────────────────────────────────
// A realistic Claude Code session: user asks to add auth, agent reads files,
// edits code, runs tests, user redirects, agent adapts.

function syntheticSession(): string {
  const lines = [
    // Goal 1: Implement authentication
    {
      uuid: 'u1', timestamp: '2026-05-25T10:00:00Z', type: 'user',
      sessionId: 'demo', message: { role: 'user', content: 'Add JWT authentication to the API' },
    },
    {
      uuid: 'a1', parentUuid: 'u1', timestamp: '2026-05-25T10:00:02Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'thinking', thinking: 'Let me check the existing auth setup and route structure...' },
        { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/lib/auth.ts' } },
      ], usage: { input_tokens: 4200, output_tokens: 180, cache_read_input_tokens: 1800 } },
    },
    {
      uuid: 'a2', parentUuid: 'a1', timestamp: '2026-05-25T10:00:04Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: '/src/app/api/route.ts' } },
      ], usage: { input_tokens: 5100, output_tokens: 120 } },
    },
    {
      uuid: 'a3', parentUuid: 'a2', timestamp: '2026-05-25T10:00:08Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu3', name: 'Read', input: { file_path: '/src/middleware.ts' } },
      ], usage: { input_tokens: 5500, output_tokens: 90 } },
    },
    {
      uuid: 'a4', parentUuid: 'a3', timestamp: '2026-05-25T10:00:12Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu4', name: 'Edit', input: {
          file_path: '/src/lib/auth.ts',
          old_string: 'export function getUser() { return null }',
          new_string: 'export function getUser(token: string) {\n  return jwt.verify(token, SECRET)\n}',
        } },
      ], usage: { input_tokens: 6200, output_tokens: 350 } },
    },
    {
      uuid: 'a5', parentUuid: 'a4', timestamp: '2026-05-25T10:00:15Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu5', name: 'Edit', input: {
          file_path: '/src/middleware.ts',
          old_string: 'export const auth = {}',
          new_string: 'export const auth = {\n  verifyToken: (req) => getUser(req.headers.authorization)\n}',
        } },
      ], usage: { input_tokens: 6800, output_tokens: 280 } },
    },
    {
      uuid: 'a6', parentUuid: 'a5', timestamp: '2026-05-25T10:00:18Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu6', name: 'Bash', input: { command: 'pnpm vitest run src/auth.test.ts' } },
      ], usage: { input_tokens: 3800, output_tokens: 60 } },
    },
    // Goal 2: Switch to OAuth
    {
      uuid: 'u2', timestamp: '2026-05-25T10:01:30Z', type: 'user',
      sessionId: 'demo', message: { role: 'user', content: 'Actually, switch to OAuth with Google provider instead of JWT' },
    },
    {
      uuid: 'a7', parentUuid: 'u2', timestamp: '2026-05-25T10:01:33Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu7', name: 'Read', input: { file_path: '/src/lib/auth.ts' } },
      ], usage: { input_tokens: 7200, output_tokens: 140, cache_read_input_tokens: 4000 } },
    },
    {
      uuid: 'a8', parentUuid: 'a7', timestamp: '2026-05-25T10:01:38Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu8', name: 'Edit', input: {
          file_path: '/src/lib/auth.ts',
          old_string: 'export function getUser(token: string) {\n  return jwt.verify(token, SECRET)\n}',
          new_string: 'export async function getUser(token: string) {\n  const { email } = await google.verifyIdToken(token)\n  return findOrCreateUser(email)\n}',
        } },
      ], usage: { input_tokens: 8100, output_tokens: 420 } },
    },
    {
      uuid: 'a9', parentUuid: 'a8', timestamp: '2026-05-25T10:01:42Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu9', name: 'Edit', input: {
          file_path: '/src/app/api/route.ts',
          old_string: 'import { auth } from "@/middleware"',
          new_string: 'import { auth } from "@/middleware"\nimport { OAuth2Client } from "google-auth-library"',
        } },
      ], usage: { input_tokens: 7600, output_tokens: 200 } },
    },
    {
      uuid: 'a10', parentUuid: 'a9', timestamp: '2026-05-25T10:01:46Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu10', name: 'Bash', input: { command: 'pnpm vitest run' } },
      ], usage: { input_tokens: 4500, output_tokens: 45 } },
    },
    // Goal 3: Add rate limiting
    {
      uuid: 'u3', timestamp: '2026-05-25T10:03:00Z', type: 'user',
      sessionId: 'demo', message: { role: 'user', content: 'Now add rate limiting to the API endpoints' },
    },
    {
      uuid: 'a11', parentUuid: 'u3', timestamp: '2026-05-25T10:03:03Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu11', name: 'Read', input: { file_path: '/src/middleware.ts' } },
      ], usage: { input_tokens: 8800, output_tokens: 110, cache_read_input_tokens: 5200 } },
    },
    {
      uuid: 'a12', parentUuid: 'a11', timestamp: '2026-05-25T10:03:08Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu12', name: 'Edit', input: {
          file_path: '/src/middleware.ts',
          old_string: 'export const auth = {\n  verifyToken: (req) => getUser(req.headers.authorization)\n}',
          new_string: 'export const auth = {\n  verifyToken: (req) => getUser(req.headers.authorization),\n  rateLimit: ratelimit({ limit: 100, window: "60s" })\n}',
        } },
      ], usage: { input_tokens: 9200, output_tokens: 380 } },
    },
    {
      uuid: 'a13', parentUuid: 'a12', timestamp: '2026-05-25T10:03:12Z', type: 'assistant',
      sessionId: 'demo', message: { role: 'assistant', model: 'claude-sonnet-4-20250514', content: [
        { type: 'tool_use', id: 'tu13', name: 'Bash', input: { command: 'pnpm vitest run' } },
      ], usage: { input_tokens: 4800, output_tokens: 55 } },
    },
  ]
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const inputPath = process.argv[2]

  console.log('\n◆ Operad — Coding Session Demo')
  console.log('  JSONL → Event Graph → Timeline Viewer\n')
  console.log('─'.repeat(60))

  // ── Step 1: Load JSONL ──────────────────────────────────────────────

  let jsonlText: string
  let sessionLabel: string

  if (inputPath) {
    const resolved = resolve(inputPath)
    if (!existsSync(resolved)) {
      console.error(`\n  Error: File not found: ${resolved}\n`)
      process.exit(1)
    }
    jsonlText = readFileSync(resolved, 'utf-8')
    sessionLabel = resolved
    console.log(`\n  Using: ${resolved}`)
  } else {
    jsonlText = syntheticSession()
    sessionLabel = 'bundled fixture (3 goals, 13 tool calls)'
    console.log(`\n  Using bundled fixture (no args provided)`)
    console.log(`  Tip: pnpm demo:coding ~/.claude/projects/<project>/<session>.jsonl`)
  }

  const lineCount = jsonlText.split('\n').filter(Boolean).length
  console.log(`  Lines: ${lineCount}\n`)

  // ── Step 2: Commit → Event Graph ──────────────────────────────────

  console.log('── Step 1: commit() — JSONL → Event Graph ─────────')

  const storage = new MemoryAdapter()
  const runtime = createRuntime({ storage })
  const graphId = `coding-demo-${Date.now()}`
  await runtime.createGraph(graphId)

  const log = await commit(jsonlText, { storage, runtime, graphId })

  console.log(`  Session:  ${log.sessionId.slice(0, 12)}`)
  console.log(`  Goals:    ${log.goals}`)
  console.log(`  Tools:    ${log.toolCalls}`)
  console.log(`  Cost:     $${log.blame.totalCost.toFixed(2)}`)
  console.log(`  Saved:    $${log.blame.cacheSavings.toFixed(2)} (prompt cache)`)
  console.log(`  Stash:    ${log.stash.redundantReads} redundant reads`)

  // ── Step 3: Query the graph ───────────────────────────────────────

  console.log('\n── Step 2: query() — Explore the Graph ────────────')

  const objects = await storage.queryObjects(graphId, {})
  const relations = await storage.queryRelations(graphId, {})

  const byType: Record<string, number> = {}
  for (const obj of objects) {
    byType[obj.type] = (byType[obj.type] ?? 0) + 1
  }

  console.log(`  ${objects.length} objects, ${relations.length} relations\n`)
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    const icons: Record<string, string> = { goal: '★', file: '📄', patch: '✏️', test_run: '🧪' }
    console.log(`    ${(icons[type] ?? '●')} ${count.toString().padStart(3)} ${type}`)
  }

  // ── Step 4: Event trace ───────────────────────────────────────────

  console.log('\n── Step 3: trace() — Event Log ────────────────────')

  const events = await storage.queryEvents(graphId, {})
  console.log(`  ${events.length} events\n`)

  for (const event of events.slice(0, 15)) {
    const ts = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false })
    const actor = (event.actor ?? 'runtime').padEnd(8)
    const typeStr = event.type.padEnd(20)
    console.log(`  [${ts}] ${typeStr} ${actor}`)
  }
  if (events.length > 15) {
    console.log(`  ... and ${events.length - 15} more events`)
  }

  // ── Step 5: Blame (cost per goal) ─────────────────────────────────

  console.log('\n── Step 4: blame() — Cost per Goal ────────────────')

  const goals = objects.filter((o) => o.type === 'goal')
  for (const goal of goals) {
    const text = (goal.data.text as string) ?? ''
    const display = text.length > 50 ? text.slice(0, 47) + '...' : text
    console.log(`  ★ "${display}"`)
  }

  // ── Step 6: Stash (wasted work) ───────────────────────────────────

  if (log.stash.redundantReads > 0) {
    console.log('\n── Step 5: stash() — Wasted Work ──────────────────')
    console.log(`  ${log.stash.redundantReads} redundant file reads`)
    console.log(`  ~${log.stash.tokensWasted.toLocaleString()} tokens wasted`)
    console.log(`  ~$${log.stash.potentialSavings.toFixed(2)} could be saved`)
  }

  // ── Step 7: Open Visual Timeline ──────────────────────────────────

  console.log('\n── Step 6: view() — Open Timeline Viewer ──────────')

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
    title: `Coding Session: ${log.sessionId.slice(0, 12)}`,
  })

  const outputPath = join(tmpdir(), 'operad-coding-session-demo.html')
  writeFileSync(outputPath, html, 'utf-8')
  console.log(`  Wrote ${outputPath}`)
  console.log(`  Size: ${(Buffer.byteLength(html) / 1024).toFixed(1)}KB (no external deps)\n`)

  try {
    const cmd = platform() === 'darwin' ? 'open' : 'xdg-open'
    execSync(`${cmd} "${outputPath}"`, { stdio: 'ignore' })
    console.log('  Opened in browser\n')
  } catch {
    console.log(`  Open manually: ${outputPath}\n`)
  }

  console.log('─'.repeat(60))
  console.log('◆ That\'s the full pipeline:')
  console.log('  1. commit()  — JSONL → append-only event log')
  console.log('  2. query()   — typed objects + relations')
  console.log('  3. trace()   — every mutation with timestamp + actor')
  console.log('  4. blame()   — cost attribution per goal')
  console.log('  5. stash()   — detect wasted work (redundant reads)')
  console.log('  6. view()    — interactive timeline + tree viewer')
  console.log('')
  console.log('  Try your own session:')
  console.log('  pnpm demo:coding ~/.claude/projects/<project>/<session>.jsonl\n')
}

main().catch(console.error)
