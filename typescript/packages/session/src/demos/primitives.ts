/**
 * Operad Primitives Demo — Interactive walkthrough of all 7 primitives.
 *
 * Scenario: Insurance claim processing with AI governance
 * Shows: Actor, Relation Behaviors, Views, Forking, Patches, Pattern Matching, LLM Behaviors
 *
 * Adapted from apps/example/src/primitives-demo.ts for in-process execution.
 */

import { createInterface } from 'node:readline'
import { createRuntime, behavior, relationBehavior, llmBehavior, renderAsciiGraph, parsePattern, matchPattern } from '@operad/core'
import type { LLMProvider } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Terminal helpers ────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY ?? false

const s = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
  red: isTTY ? '\x1b[31m' : '',
  blue: isTTY ? '\x1b[34m' : '',
}

const W = Math.min(process.stdout.columns ?? 60, 70)
const line = (ch = '─') => ch.repeat(W)
const blank = () => console.log()

function banner(step: number, total: number, title: string) {
  blank()
  console.log(`${s.bold}${s.cyan}┌${line()}┐${s.reset}`)
  console.log(`${s.bold}${s.cyan}│${s.reset}  ${s.bold}Step ${step}/${total}${s.reset}  ${s.yellow}${title}${s.reset}`)
  console.log(`${s.bold}${s.cyan}└${line()}┘${s.reset}`)
}

function explain(text: string) {
  blank()
  for (const ln of text.split('\n')) {
    console.log(`  ${s.dim}${ln}${s.reset}`)
  }
}

function result(label: string, value: string) {
  console.log(`  ${s.green}✓${s.reset} ${s.bold}${label}${s.reset}  ${value}`)
}

function action(text: string) {
  console.log(`  ${s.magenta}▸${s.reset} ${text}`)
}

async function pause(rl: ReturnType<typeof createInterface>) {
  blank()
  await new Promise<void>(resolve => {
    rl.question(`  ${s.dim}↵ Press Enter to continue...${s.reset}`, () => resolve())
  })
}

// ─── Mock LLM Provider ──────────────────────────────────────────────────────

const mockLLM: LLMProvider = {
  async complete({ prompt }) {
    if (prompt.includes('contradicts')) {
      return { text: 'CONTRADICTION_DETECTED: The two claims have conflicting damage descriptions.', usage: { inputTokens: 200, outputTokens: 50 } }
    }
    return { text: 'ANALYSIS_COMPLETE: Claim appears valid based on evidence.', usage: { inputTokens: 150, outputTokens: 30 } }
  },
}

// ─── Behaviors (defined once, used in runtime) ───────────────────────────────

const checkDependencies = relationBehavior({
  name: 'check-claim-dependencies',
  relationType: 'depends_on',
  on: ['object.patched'],
  handler: async (relation, _event, graph, _ctx) => {
    const source = await graph.getObject(relation.sourceId)
    const target = await graph.getObject(relation.targetId)
    action(`Relation behavior fired: "${source?.data.title}" depends on "${target?.data.title}"`)
  },
})

const analyzeWithLLM = llmBehavior(
  {
    name: 'llm-claim-analyzer',
    on: ['custom.analyze_claim'],
    view: { around: 'payload.claimId', depth: 1 },
    model: 'claude-sonnet',
    prompt: (event, view) => {
      const objects = view?.objects() ?? []
      return `Analyze this claim neighborhood (${objects.length} objects). Check if any claim contradicts another.`
    },
    onResponse: async (text, event, graph, ctx) => {
      if (text.includes('CONTRADICTION_DETECTED')) {
        await ctx.propose!({
          type: 'flag',
          data: { reason: 'contradiction_detected', claimId: event.payload.claimId as string },
          reason: 'LLM detected contradicting claims',
        })
      }
    },
  },
  mockLLM
)

const findContradictions = behavior({
  name: 'find-contradictions',
  on: ['relation.created'],
  pattern: '(a:claim)-[:contradicts]->(b:claim)',
  handler: async (_event, _graph, ctx) => {
    const matches = ctx.matches ?? []
    if (matches.length > 0 && matches.length <= 1) {
      await ctx.propose!({
        type: 'review_request',
        data: {
          reason: 'single_contradiction',
          claimA: (matches[0].a as any).id,
          claimB: (matches[0].b as any).id,
        },
        reason: 'Structural contradiction detected between two claims',
      })
    }
  },
})

// ─── Run ─────────────────────────────────────────────────────────────────────

export interface DemoRunResult {
  storage: MemoryAdapter
  graphId: string
}

export async function run(opts: { interactive?: boolean } = {}): Promise<DemoRunResult> {
  const interactive = opts.interactive ?? (isTTY && !process.env.CI)
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null

  const wait = async () => {
    if (rl) await pause(rl)
  }

  try {
    // ── Title ──────────────────────────────────────────────────────────
    blank()
    console.log(`${s.bold}${s.cyan}  ◆  O P E R A D${s.reset}`)
    console.log(`${s.dim}  Interactive walkthrough of all 7 primitives${s.reset}`)
    console.log(`${s.dim}  Scenario: Insurance claim processing with AI governance${s.reset}`)
    blank()
    console.log(`  ${s.dim}${line()}${s.reset}`)
    explain(
      'Operad is an event-sourced graph runtime for AI agents.\n' +
      'Every mutation is recorded. Behaviors react to events.\n' +
      'This demo creates a claim investigation and shows each primitive.'
    )

    await wait()

    // ── Setup ──────────────────────────────────────────────────────────

    const storage = new MemoryAdapter()
    const runtime = createRuntime({
      storage,
      behaviors: [checkDependencies, analyzeWithLLM, findContradictions],
    })

    // ── Step 1: Actor ──────────────────────────────────────────────────

    banner(1, 7, 'Actor Provenance')
    explain(
      'Every event records WHO caused it — user, agent, or system.\n' +
      'This is how you audit "who did what" in an AI workflow.'
    )

    const graph = await runtime.createGraph('claim-investigation')
    result('Graph created', '"claim-investigation"')

    const claim1 = await graph.addObject({
      type: 'claim',
      data: { title: 'Water damage - basement', amount: 35000, status: 'open' },
    })
    const claim2 = await graph.addObject({
      type: 'claim',
      data: { title: 'Water damage - kitchen', amount: 12000, status: 'open' },
    })
    result('Claim 1', `${claim1.data.title}  ($${claim1.data.amount})`)
    result('Claim 2', `${claim2.data.title}  ($${claim2.data.amount})`)

    const events = await storage.queryEvents('claim-investigation', { type: 'object.created' })
    blank()
    console.log(`  ${s.bold}Actor on events:${s.reset} ${s.yellow}"${events[0].actor}"${s.reset}`)
    console.log(`  ${s.dim}Every object.created event knows who created it.${s.reset}`)

    await wait()

    // ── Step 2: Relation Behaviors ─────────────────────────────────────

    banner(2, 7, 'Relation Behaviors')
    explain(
      'Behaviors can trigger on edges, not just nodes.\n' +
      'When evidence is updated, Operad checks all claims that depend on it.'
    )

    const evidence = await graph.addObject({
      type: 'evidence',
      data: { title: 'Plumber report', confidence: 0.95 },
    })
    result('Evidence added', evidence.data.title)

    await graph.addRelation(claim1.id, evidence.id, 'depends_on')
    result('Relation', 'claim1 → depends_on → evidence')

    blank()
    console.log(`  ${s.bold}Patching evidence (verified: true)...${s.reset}`)
    await graph.patchObject(evidence.id, { verified: true })
    console.log(`  ${s.dim}The relation behavior auto-fired because claim1 depends on this evidence.${s.reset}`)

    await wait()

    // ── Step 3: Views + LLM ────────────────────────────────────────────

    banner(3, 7, 'Scoped Views + LLM Behavior')
    explain(
      'LLM behaviors get a "view" — a scoped subgraph around a node.\n' +
      'Instead of dumping the whole graph into the prompt,\n' +
      'Operad gives the LLM only the relevant neighborhood.'
    )

    await graph.addRelation(claim1.id, claim2.id, 'contradicts')
    result('Relation', 'claim1 → contradicts → claim2')

    blank()
    console.log(`  ${s.bold}Triggering LLM analysis...${s.reset}`)
    console.log(`  ${s.dim}View: 1-hop neighborhood around claim1${s.reset}`)
    await runtime.emit('claim-investigation', {
      type: 'custom.analyze_claim',
      payload: { claimId: claim1.id },
    })
    result('LLM verdict', `${s.red}CONTRADICTION_DETECTED${s.reset}`)
    console.log(`  ${s.dim}The LLM proposed a flag — but it can't create it directly.${s.reset}`)

    await wait()

    // ── Step 4: Patches (Governance) ───────────────────────────────────

    banner(4, 7, 'Patches & Governance')
    explain(
      'AI actions aren\'t applied immediately — they\'re PROPOSED.\n' +
      'A human (or policy) must approve before the graph changes.\n' +
      'This is how you keep humans in the loop.'
    )

    const pending = runtime.pendingPatches('claim-investigation')
    console.log(`  ${s.bold}Pending patches:${s.reset} ${s.yellow}${pending.length}${s.reset}`)

    if (pending.length > 0) {
      const patch = pending[0]
      console.log(`  ${s.dim}Reason: "${patch.reason}"${s.reset}`)
      console.log(`  ${s.dim}Proposed by: ${patch.proposedBy}${s.reset}`)
      console.log(`  ${s.dim}Status: ${patch.status}${s.reset}`)

      blank()
      console.log(`  ${s.bold}Admin approves the patch...${s.reset}`)
      await runtime.approve(patch.id, 'admin-user')
      result('Patch approved', 'Flag object created in graph')

      const flags = await graph.queryObjects({ type: 'flag' })
      console.log(`  ${s.dim}Flags now in graph: ${flags.length}${s.reset}`)
    }

    await wait()

    // ── Step 5: Forking ────────────────────────────────────────────────

    banner(5, 7, 'Forking (What-If Scenarios)')
    explain(
      'Fork the graph at any event to explore alternate timelines.\n' +
      'Like git branches — the original is untouched.\n' +
      '"What if we denied this claim?"'
    )

    const allEvents = await storage.queryEvents('claim-investigation', {})
    const forkPoint = allEvents[Math.floor(allEvents.length / 2)]

    const forkedGraph = await runtime.fork('claim-investigation', {
      atEvent: forkPoint.id,
      label: 'what-if-deny-claim',
    })
    result('Forked at', `${forkPoint.type}`)
    result('Fork ID', forkedGraph.id)

    await forkedGraph.addObject({
      type: 'decision',
      data: { action: 'deny', reason: 'Contradicting evidence detected' },
    })

    const sourceDecisions = await graph.queryObjects({ type: 'decision' })
    const forkDecisions = await forkedGraph.queryObjects({ type: 'decision' })
    blank()
    console.log(`  ${s.bold}Source graph decisions:${s.reset} ${sourceDecisions.length}  ${s.dim}(unchanged)${s.reset}`)
    console.log(`  ${s.bold}Fork graph decisions:${s.reset}   ${forkDecisions.length}  ${s.dim}(denial added)${s.reset}`)

    await wait()

    // ── Step 6: Pattern Matching ───────────────────────────────────────

    banner(6, 7, 'Pattern Matching')
    explain(
      'Query the graph with Cypher-style patterns.\n' +
      'Find structural relationships without writing loops.'
    )

    const parsed = parsePattern('(a:claim)-[:contradicts]->(b:claim)')
    const matches = await matchPattern(parsed, graph)

    console.log(`  ${s.bold}Pattern:${s.reset}  ${s.cyan}(a:claim)-[:contradicts]->(b:claim)${s.reset}`)
    console.log(`  ${s.bold}Matches:${s.reset}  ${s.yellow}${matches.length}${s.reset}`)
    for (const m of matches) {
      console.log(`           ${(m.a as any).data.title} ${s.red}←→${s.reset} ${(m.b as any).data.title}`)
    }

    await wait()

    // ── Step 7: Graph Visualization ────────────────────────────────────

    banner(7, 7, 'Event-Sourced Graph')
    explain(
      'Everything above produced events.\n' +
      'Here\'s the final graph — every node, edge, and flag.'
    )

    const finalEvents = await storage.queryEvents('claim-investigation', {})
    const finalObjects = await graph.queryObjects()
    const finalRelations = await graph.queryRelations()

    blank()
    for (const ln of renderAsciiGraph(finalObjects, finalRelations)) {
      console.log(ln)
    }

    blank()
    console.log(`  ${s.bold}Stats${s.reset}`)
    console.log(`  ${s.dim}${'─'.repeat(35)}${s.reset}`)
    console.log(`  Events:    ${s.yellow}${finalEvents.length}${s.reset}`)
    console.log(`  Objects:   ${s.yellow}${finalObjects.length}${s.reset}  (${finalObjects.map(o => o.type).join(', ')})`)
    console.log(`  Relations: ${s.yellow}${finalRelations.length}${s.reset}`)

    const actorCounts = new Map<string, number>()
    for (const e of finalEvents) {
      const actor = e.actor ?? 'unknown'
      actorCounts.set(actor, (actorCounts.get(actor) ?? 0) + 1)
    }
    blank()
    console.log(`  ${s.bold}Events by actor${s.reset}`)
    for (const [actor, count] of actorCounts) {
      const bar = '█'.repeat(Math.ceil(count / 2))
      console.log(`  ${actor.padEnd(20)} ${s.cyan}${bar}${s.reset} ${count}`)
    }

    // ── Outro ──────────────────────────────────────────────────────────
    blank()
    console.log(`  ${s.dim}${line()}${s.reset}`)
    blank()
    console.log(`  ${s.bold}${s.green}◆ Demo complete.${s.reset}`)
    console.log(`  ${s.dim}All 7 primitives exercised. Every action is event-sourced.${s.reset}`)
    console.log(`  ${s.dim}Actor provenance · relation behaviors · scoped views${s.reset}`)
    console.log(`  ${s.dim}forking · governance · pattern matching · LLM integration${s.reset}`)
    blank()

    return { storage, graphId: 'claim-investigation' }
  } finally {
    rl?.close()
  }
}
