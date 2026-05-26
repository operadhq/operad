#!/usr/bin/env npx tsx
/**
 * Operad — Transactional Agent Execution Demo
 *
 * Inspired by Atomix (arxiv.org/html/2602.14849): transactional tool use
 * with effect categories, buffered commits, and speculation isolation.
 *
 * This demo shows Operad isn't just a log viewer — it's a transactional
 * runtime where:
 *
 *   1. Effects are categorized (pure / bufferable / externalized)
 *   2. Changes are PROPOSED, not committed (governance)
 *   3. Multiple branches explore alternatives IN PARALLEL
 *   4. A scorer picks the winner
 *   5. Losers are reverted with compensation — zero residual side effects
 *   6. Only the winner's patches get approved
 *
 * Run: pnpm demo:transactional
 */

import { createRuntime, behavior } from '@operad/core'
import type { GraphAPI, BehaviorContext, GraphEvent } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Colors ──────────────────────────────────────────────────────────────────

const t = process.stdout.isTTY ?? false
const B = t ? '\x1b[1m' : ''
const R = t ? '\x1b[0m' : ''
const G = t ? '\x1b[32m' : ''
const Y = t ? '\x1b[33m' : ''
const C = t ? '\x1b[36m' : ''
const D = t ? '\x1b[2m' : ''
const RED = t ? '\x1b[31m' : ''
const MAG = t ? '\x1b[35m' : ''

// ─── Behaviors ───────────────────────────────────────────────────────────────

/**
 * Safety gate: when an agent proposes an API call (externalized effect),
 * this behavior fires and flags it for human review instead of executing.
 */
const gateExternalEffects = behavior({
  name: 'gate-external-effects',
  on: ['custom.tool_called'],
  handler: async (event: GraphEvent, graph: GraphAPI, ctx: BehaviorContext) => {
    const tool = event.payload.tool as string
    // Simulate: if the tool is externalized, propose instead of executing
    if (tool === 'Bash' || tool.startsWith('mcp__')) {
      if (ctx.propose) {
        await ctx.propose({
          type: 'gated_effect',
          data: {
            tool,
            input: event.payload.input as Record<string, unknown>,
            reason: `Externalized effect "${tool}" requires approval`,
          },
          reason: `Tool "${tool}" has irreversible side effects`,
        })
      }
    }
  },
})

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
${B}◆ Operad — Transactional Agent Execution${R}
  ${D}Atomix-style effect isolation using Operad primitives${R}
${'─'.repeat(60)}`)

  const storage = new MemoryAdapter()
  const runtime = createRuntime({
    storage,
    behaviors: [gateExternalEffects],
  })

  // Register a reversal handler for file writes
  runtime.registerReversal('custom.tool_called', async (event: GraphEvent) => {
    const tool = event.payload.tool as string
    const input = event.payload.input as Record<string, unknown>
    if (tool === 'Write' || tool === 'Edit') {
      console.log(`    ${RED}↩ Reversed:${R} ${D}${tool}(${input?.file_path ?? 'unknown'})${R}`)
    }
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Step 1: Effect Categories — classify every tool call
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${B}── Step 1: Effect Categories ──${R}`)
  console.log(`${D}Every tool call is classified before execution.${R}\n`)

  const graph = await runtime.createGraph('deploy-session')

  const goal = await graph.addObject({
    type: 'goal',
    data: { text: 'Deploy v2.0 to production' },
  })

  // Simulate agent tool calls with their effect categories
  const toolCalls = [
    { tool: 'Read',     input: { file_path: 'src/config.ts' },            category: 'pure' },
    { tool: 'Grep',     input: { pattern: 'API_VERSION', path: 'src/' },  category: 'pure' },
    { tool: 'Edit',     input: { file_path: 'src/config.ts', old: 'v1', new: 'v2' }, category: 'bufferable' },
    { tool: 'Write',    input: { file_path: 'deploy.yaml', content: '...' },         category: 'bufferable' },
    { tool: 'Bash',     input: { command: 'kubectl apply -f deploy.yaml' },           category: 'externalized' },
    { tool: 'mcp__slack', input: { channel: '#deploys', text: 'v2.0 deployed' },     category: 'externalized' },
  ]

  for (const tc of toolCalls) {
    const icon = tc.category === 'pure' ? `${G}○${R}` :
                 tc.category === 'bufferable' ? `${Y}◐${R}` :
                 `${RED}●${R}`
    console.log(`  ${icon} ${tc.tool.padEnd(12)} → ${tc.category}`)

    await runtime.emit('deploy-session', {
      type: 'custom.tool_called' as any,
      payload: { tool: tc.tool, input: tc.input },
    })
  }

  console.log(`
  ${G}○${R} pure         = no side effects, freely reversible
  ${Y}◐${R} bufferable   = can be undone (file writes)
  ${RED}●${R} externalized = irreversible (API calls, deploys)`)

  // Check: externalized effects should have been gated
  const pending = runtime.pendingPatches('deploy-session')
  console.log(`
  ${MAG}⚡ Governance gate caught ${pending.length} externalized effects:${R}`)
  for (const p of pending) {
    console.log(`    ${Y}⏸${R}  "${(p.data.tool as string)}" — ${p.reason}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Step 2: Explore — fork 3 deploy strategies in parallel
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${B}── Step 2: Parallel Speculation (explore) ──${R}`)
  console.log(`${D}Fork 3 branches, run each strategy, score the results.${R}\n`)

  // Find a good fork point (after reading, before writing)
  const events = await storage.queryEvents('deploy-session', {})
  const forkPoint = events[3] // After the two reads + first edit

  const strategies = [
    { name: 'blue-green', risk: 0.1, rollbackTime: 5,  downtime: 0 },
    { name: 'canary',     risk: 0.2, rollbackTime: 15, downtime: 0 },
    { name: 'in-place',   risk: 0.5, rollbackTime: 60, downtime: 30 },
  ]

  const result = await runtime.explore('deploy-session', {
    atEvent: forkPoint.id,
    branches: 3,
    label: 'deploy-strategy',

    // Each branch simulates a different deploy strategy
    worker: async (branchGraph: GraphAPI, branchId: string) => {
      const idx = parseInt(branchId.split('_')[2]) // extract branch index
      const strategy = strategies[idx] ?? strategies[0]

      // Record what this branch decided
      await branchGraph.recordDecision({
        selectedAction: strategy.name,
        alternatives: strategies
          .filter((s) => s.name !== strategy.name)
          .map((s) => ({ action: s.name, rejected: 'Not selected for this branch' })),
        confidence: 1 - strategy.risk,
        reasoning: `${strategy.name}: ${strategy.downtime}s downtime, ${strategy.rollbackTime}s rollback`,
      })

      // Simulate the deploy work
      await branchGraph.addObject({
        type: 'deploy_plan',
        data: {
          strategy: strategy.name,
          steps: strategy.name === 'blue-green'
            ? ['provision green env', 'deploy to green', 'health check', 'swap traffic', 'teardown blue']
            : strategy.name === 'canary'
            ? ['deploy to 5% traffic', 'monitor errors', 'ramp to 25%', 'ramp to 100%']
            : ['stop service', 'deploy', 'start service', 'health check'],
        },
      })

      return strategy
    },

    // Score: lower risk + lower downtime + faster rollback = better
    scorer: (result: unknown) => {
      const s = result as typeof strategies[0]
      return (1 - s.risk) * 40 + (1 - s.downtime / 60) * 30 + (1 - s.rollbackTime / 60) * 30
    },
  })

  // Display results
  console.log(`  ${B}Branch Results:${R}`)
  for (const branch of result.branches) {
    const s = branch.result as typeof strategies[0]
    const isWinner = branch.branchId === result.winnerId
    const marker = isWinner ? `${G}★ WINNER${R}` : `${D}  loser${R}`
    console.log(`    ${marker}  ${s.name.padEnd(12)} score=${branch.score.toFixed(1)}  risk=${s.risk}  downtime=${s.downtime}s  rollback=${s.rollbackTime}s`)
  }

  console.log(`
  ${G}Winner: ${(result.branches[0].result as any).name}${R} (score: ${result.winnerScore.toFixed(1)})`)

  // ══════════════════════════════════════════════════════════════════════════
  // Step 3: Revert losers — compensating events, zero residue
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${B}── Step 3: Revert Losing Branches ──${R}`)
  console.log(`${D}Compensating events undo the losers. No residual side effects.${R}\n`)

  const losers = result.branches.filter((b) => b.branchId !== result.winnerId)

  for (const loser of losers) {
    const s = loser.result as typeof strategies[0]
    const branchEvents = await storage.queryEvents(loser.branchId, {})

    if (branchEvents.length > 1) {
      const revertResult = await runtime.revert(loser.branchId, {
        toEvent: branchEvents[0].id, // revert to the beginning
        reverseEffects: true,
        actor: 'runtime',
      })

      console.log(`  ${RED}✗${R} ${s.name}: reverted ${revertResult.eventsReverted} events, ${revertResult.unreversible.length} unreversible`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Step 4: Approve winner's patches — only now do effects commit
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${B}── Step 4: Approve Winner's Effects ──${R}`)
  console.log(`${D}Only the winning branch's proposed effects get committed.${R}\n`)

  // The original graph's gated effects — approve them now
  const pendingNow = runtime.pendingPatches('deploy-session')
  for (const patch of pendingNow) {
    console.log(`  ${G}✓${R} Approved: ${patch.data.tool} — "${patch.reason}"`)
    await runtime.approve(patch.id, 'deploy-operator')
  }

  if (pendingNow.length === 0) {
    console.log(`  ${D}(No pending patches on the original graph — effects were on branches)${R}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Step 5: Full audit trail — everything is in the event log
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${B}── Step 5: Audit Trail ──${R}`)
  console.log(`${D}Every action, proposal, approval, and revert is an event.${R}\n`)

  const allEvents = await storage.queryEvents('deploy-session', {})
  const winnerEvents = await storage.queryEvents(result.winnerId, {})

  // Count by type
  const typeCounts = new Map<string, number>()
  for (const e of allEvents) {
    typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1)
  }

  console.log(`  ${B}Original graph:${R} ${allEvents.length} events`)
  for (const [type, count] of [...typeCounts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${count}x ${type}`)
  }

  console.log(`\n  ${B}Winner branch:${R} ${winnerEvents.length} events`)

  // Count branches total
  let totalBranchEvents = 0
  for (const branch of result.branches) {
    const be = await storage.queryEvents(branch.branchId, {})
    totalBranchEvents += be.length
  }
  console.log(`  ${B}All branches:${R} ${totalBranchEvents} events across ${result.branches.length} branches`)

  // ══════════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`
${'─'.repeat(60)}
${B}◆ What Operad provides beyond log history:${R}

  ${G}1.${R} ${B}Effect categories${R} — tools classified as pure/bufferable/externalized
     → Reads are free. Writes can be undone. API calls need gates.

  ${G}2.${R} ${B}Governance (propose → approve)${R} — buffered commits
     → Changes don't take effect until approved. Like Atomix's frontier gating.

  ${G}3.${R} ${B}Parallel speculation (explore)${R} — best-of-K with scoring
     → Fork N branches, run strategies in parallel, pick the winner.

  ${G}4.${R} ${B}Compensation (revert)${R} — Saga-style undo with reversal handlers
     → Losing branches cleaned up. Externalized effects flagged as unreversible.

  ${G}5.${R} ${B}Full audit trail${R} — every proposal, approval, revert is an event
     → Not just "what happened" but "what was considered and rejected."

${D}Atomix ensures the system stays clean during speculation.
Operad ensures the developer can govern, trace, and learn from it.
Together: transactional reasoning for AI agents.${R}
`)
}

main().catch(console.error)
