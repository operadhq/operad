/**
 * Operad Primitives Demo — All 7 New Primitives
 *
 * Scenario: Insurance claim processing with AI governance
 * Shows: Actor, Relation Behaviors, Views, Forking, Patches, Pattern Matching, LLM Behaviors
 *
 * Run: pnpm demo:primitives
 */

import { createRuntime, behavior, relationBehavior, llmBehavior } from '@operad/core'
import type { Runtime, GraphAPI, LLMProvider } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Mock LLM Provider ──────────────────────────────────────────────────────

const mockLLM: LLMProvider = {
  async complete({ prompt }) {
    console.log(`  🤖 LLM called with ${prompt.length}-char prompt`)
    // Simulate analysis based on prompt content
    if (prompt.includes('contradicts')) {
      return { text: 'CONTRADICTION_DETECTED: The two claims have conflicting damage descriptions.', usage: { inputTokens: 200, outputTokens: 50 } }
    }
    return { text: 'ANALYSIS_COMPLETE: Claim appears valid based on evidence.', usage: { inputTokens: 150, outputTokens: 30 } }
  },
}

// ─── Behaviors ───────────────────────────────────────────────────────────────

/** 1. RELATION BEHAVIOR: When a claim is patched, check all dependencies */
const checkDependencies = relationBehavior({
  name: 'check-claim-dependencies',
  relationType: 'depends_on',
  on: ['object.patched'],
  handler: async (relation, event, graph, ctx) => {
    const source = await graph.getObject(relation.sourceId)
    const target = await graph.getObject(relation.targetId)
    console.log(`  🔗 Relation behavior fired: "${source?.data.title}" depends on "${target?.data.title}"`)
    console.log(`     Checking if dependency is satisfied...`)
  },
})

/** 2. LLM BEHAVIOR: Analyze claims using a scoped view */
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
      console.log(`  📝 LLM response: ${text}`)
      if (text.includes('CONTRADICTION_DETECTED')) {
        // Propose a patch (governance!) instead of directly creating
        await ctx.propose!({
          type: 'flag',
          data: { reason: 'contradiction_detected', claimId: event.payload.claimId as string },
          reason: 'LLM detected contradicting claims',
        })
        console.log(`  ⚠️  Proposed a flag (requires human approval)`)
      }
    },
  },
  mockLLM
)

/** 3. PATTERN MATCHING: Find contradicting claims */
const findContradictions = behavior({
  name: 'find-contradictions',
  on: ['relation.created'],
  pattern: '(a:claim)-[:contradicts]->(b:claim)',
  handler: async (event, graph, ctx) => {
    const matches = ctx.matches ?? []
    if (matches.length > 0) {
      console.log(`  🔍 Pattern match found ${matches.length} contradiction(s)!`)
      if (matches.length > 1) {
        // Multiple contradictions = high risk, auto-escalate
        await ctx.emit({
          type: 'custom.escalate',
          payload: { reason: 'multiple_contradictions', count: matches.length },
        })
        console.log(`  🚨 Auto-escalated: ${matches.length} contradictions detected`)
      } else {
        // Single contradiction = propose for human review
        await ctx.propose!({
          type: 'review_request',
          data: {
            reason: 'single_contradiction',
            claimA: (matches[0].a as any).id,
            claimB: (matches[0].b as any).id,
          },
          reason: 'Structural contradiction detected between two claims',
        })
        console.log(`  📋 Proposed review (single contradiction, needs human approval)`)
      }
    }
  },
})

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n◆ Operad — 7 New Primitives Demo\n')
  console.log('─'.repeat(55))

  const storage = new MemoryAdapter()
  const runtime = createRuntime({
    storage,
    behaviors: [checkDependencies, analyzeWithLLM, findContradictions],
  })

  // ── Step 1: Actor field ────────────────────────────────────────────

  console.log('\n── 1. Actor Field ──────────────────────────────')

  const graph = await runtime.createGraph('claim-investigation')
  console.log('  ✓ Created graph (actor: "user")')

  const claim1 = await graph.addObject({
    type: 'claim',
    data: { title: 'Water damage - basement', amount: 35000, status: 'open' },
  })
  console.log(`  + Claim 1: ${claim1.data.title}`)

  const claim2 = await graph.addObject({
    type: 'claim',
    data: { title: 'Water damage - kitchen', amount: 12000, status: 'open' },
  })
  console.log(`  + Claim 2: ${claim2.data.title}`)

  // Check actor on events
  const events = await storage.queryEvents('claim-investigation', { type: 'object.created' })
  console.log(`  Actor on object.created: "${events[0].actor}"`)

  // ── Step 2: Relation Behaviors ─────────────────────────────────────

  console.log('\n── 2. Relation Behaviors ───────────────────────')

  const evidence = await graph.addObject({
    type: 'evidence',
    data: { title: 'Plumber report', confidence: 0.95 },
  })
  console.log(`  + Evidence: ${evidence.data.title}`)

  await graph.addRelation(claim1.id, evidence.id, 'depends_on')
  console.log(`  + Relation: claim1 → depends_on → evidence`)

  // Patching evidence triggers the relation behavior
  console.log('  → Patching evidence (triggers relation behavior):')
  await graph.patchObject(evidence.id, { verified: true })

  // ── Step 3: Views ──────────────────────────────────────────────────

  console.log('\n── 3. Views (Scoped Reads) + LLM Behavior ─────')

  // Add a contradiction for pattern matching
  await graph.addRelation(claim1.id, claim2.id, 'contradicts')
  console.log(`  + Relation: claim1 → contradicts → claim2`)

  // Trigger LLM analysis with a view scoped to claim1's neighborhood
  console.log('  → Triggering LLM analysis (scoped to claim1 neighborhood):')
  await runtime.emit('claim-investigation', {
    type: 'custom.analyze_claim',
    payload: { claimId: claim1.id },
  })

  // ── Step 4: Patches + Policies ─────────────────────────────────────

  console.log('\n── 4. Patches + Policies (Governance) ─────────')

  const pending = runtime.pendingPatches('claim-investigation')
  console.log(`  Pending patches: ${pending.length}`)

  if (pending.length > 0) {
    const patch = pending[0]
    console.log(`  Patch: "${patch.reason}" proposed by "${patch.proposedBy}"`)
    console.log(`  Status: ${patch.status}`)

    // Human approves the patch
    console.log('  → Admin approves the patch...')
    await runtime.approve(patch.id, 'admin-user')
    console.log('  ✓ Patch approved — flag object created')

    const flags = await graph.queryObjects({ type: 'flag' })
    console.log(`  Flags in graph: ${flags.length}`)
  }

  // ── Step 5: Forking ────────────────────────────────────────────────

  console.log('\n── 5. Forking (What-If Scenarios) ──────────────')

  // Get an event to fork at
  const allEvents = await storage.queryEvents('claim-investigation', {})
  const forkPoint = allEvents[Math.floor(allEvents.length / 2)]
  console.log(`  Fork point: ${forkPoint.type} (${forkPoint.id})`)

  const forkedGraph = await runtime.fork('claim-investigation', {
    atEvent: forkPoint.id,
    label: 'what-if-deny-claim',
  })
  console.log(`  ✓ Forked graph: ${forkedGraph.id}`)

  // Diverge: add different data to the fork
  await forkedGraph.addObject({
    type: 'decision',
    data: { action: 'deny', reason: 'Contradicting evidence detected' },
  })
  console.log('  + Added denial decision to fork (source graph unchanged)')

  // Verify independence
  const sourceDecisions = await graph.queryObjects({ type: 'decision' })
  const forkDecisions = await forkedGraph.queryObjects({ type: 'decision' })
  console.log(`  Source graph decisions: ${sourceDecisions.length}`)
  console.log(`  Fork graph decisions: ${forkDecisions.length}`)

  // ── Step 6: Pattern Matching ───────────────────────────────────────

  console.log('\n── 6. Pattern Matching ─────────────────────────')

  // Pattern was already checked via the behavior, but let's query directly
  const { parsePattern, matchPattern } = await import('@operad/core')
  const parsed = parsePattern('(a:claim)-[:contradicts]->(b:claim)')
  const matches = await matchPattern(parsed, graph)
  console.log(`  Pattern: (a:claim)-[:contradicts]->(b:claim)`)
  console.log(`  Matches: ${matches.length}`)
  for (const m of matches) {
    console.log(`    ${(m.a as any).data.title} ←→ ${(m.b as any).data.title}`)
  }

  // ── Summary ────────────────────────────────────────────────────────

  console.log('\n── Summary ─────────────────────────────────────')

  const finalEvents = await storage.queryEvents('claim-investigation', {})
  const finalObjects = await graph.queryObjects()
  const finalRelations = await graph.queryRelations()

  console.log(`  Total events: ${finalEvents.length}`)
  console.log(`  Objects: ${finalObjects.length} (${finalObjects.map(o => o.type).join(', ')})`)
  console.log(`  Relations: ${finalRelations.length}`)

  // Show actor distribution
  const actorCounts = new Map<string, number>()
  for (const e of finalEvents) {
    const actor = e.actor ?? 'unknown'
    actorCounts.set(actor, (actorCounts.get(actor) ?? 0) + 1)
  }
  console.log('  Events by actor:')
  for (const [actor, count] of actorCounts) {
    console.log(`    ${actor}: ${count}`)
  }

  // Check for LLM events
  const llmRequested = finalEvents.filter(e => e.type === 'llm.requested')
  const llmResponded = finalEvents.filter(e => e.type === 'llm.responded')
  console.log(`  LLM calls: ${llmRequested.length} requested, ${llmResponded.length} responded`)

  // Check for patch events
  const patchEvents = finalEvents.filter(e => e.type.startsWith('patch.'))
  console.log(`  Patch events: ${patchEvents.map(e => e.type).join(', ')}`)

  console.log('\n' + '─'.repeat(55))
  console.log('◆ All 7 primitives exercised. Every action is event-sourced.')
  console.log('  Actor provenance, relation behaviors, scoped views,')
  console.log('  forking, governance, pattern matching, and LLM integration.\n')
}

main().catch(console.error)
