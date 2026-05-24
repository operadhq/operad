/**
 * Operad Example: Insurance Voice Agent
 *
 * Simulates an AI voice agent processing a water damage claim.
 * Shows all 5 primitives: graph, events, behaviors, decisions, health.
 *
 * Run: pnpm demo
 */

import { createRuntime, behavior } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Behaviors ────────────────────────────────────────────────────────────────

/** Auto-tag high-value claims for priority review */
const tagHighValue = behavior({
  name: 'tag-high-value-claims',
  on: ['object.created'],
  where: { 'payload.objectType': 'claim' },
  handler: async (event, graph, ctx) => {
    const data = event.payload.data as Record<string, unknown>
    const amount = data.estimatedAmount as number
    if (amount > 25000) {
      await graph.addObject({
        type: 'tag',
        data: { label: 'high-value', claimId: event.payload.objectType, amount },
      })
      console.log(`  🏷️  Auto-tagged as high-value (>${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`)
    }
  },
})

/** Log every decision for audit visibility */
const auditDecisions = behavior({
  name: 'audit-log',
  on: ['decision.recorded'],
  handler: async (event) => {
    console.log(`  📋 Audit: Decision recorded — "${event.payload.selectedAction}" (confidence: ${event.payload.confidence})`)
  },
})

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n◆ Operad — Insurance Agent Demo\n')
  console.log('─'.repeat(50))

  // 1. Set up runtime with behaviors
  const storage = new MemoryAdapter()
  const runtime = createRuntime({
    storage,
    behaviors: [tagHighValue, auditDecisions],
  })

  const graph = await runtime.createGraph('customer-jane-doe')
  console.log('\n✓ Created graph: customer-jane-doe')

  // 2. Simulate intake call — agent learns about customer
  console.log('\n── Intake Call ──────────────────────────────────')

  const customer = await graph.addObject({
    type: 'customer',
    data: { name: 'Jane Doe', phone: '555-0199', email: 'jane@example.com' },
  })
  console.log(`  + Customer: ${customer.data.name}`)

  const policy = await graph.addObject({
    type: 'policy',
    data: { number: 'HO-3-12345', type: 'homeowners', coverage: 'water_damage', limit: 100000 },
  })
  console.log(`  + Policy: ${policy.data.number} (${policy.data.type})`)

  await graph.addRelation(customer.id, policy.id, 'holds')
  console.log(`  + Relation: customer → holds → policy`)

  // 3. Simulate evidence collection
  console.log('\n── Evidence Collection ──────────────────────────')

  const claim = await graph.addObject({
    type: 'claim',
    data: {
      type: 'water_damage',
      description: 'Burst pipe in basement, flooding 500 sq ft',
      estimatedAmount: 35000,
      filedDate: new Date().toISOString(),
    },
  })
  console.log(`  + Claim: ${claim.data.type} — $${(claim.data.estimatedAmount as number).toLocaleString()}`)

  await graph.addRelation(claim.id, policy.id, 'filed_under')

  const transcript = await graph.addObject({
    type: 'evidence',
    data: {
      source: 'call_transcript',
      text: 'Customer reported burst pipe on Jan 15. Water damage to basement flooring and drywall. Plumber confirmed pipe failure.',
      confidence: 0.95,
    },
  })
  console.log(`  + Evidence: call transcript (confidence: ${transcript.data.confidence})`)

  const photo = await graph.addObject({
    type: 'evidence',
    data: {
      source: 'photo_upload',
      text: 'Photos show water staining on basement walls, warped hardwood flooring',
      confidence: 0.88,
    },
  })
  console.log(`  + Evidence: photo upload (confidence: ${photo.data.confidence})`)

  await graph.addRelation(transcript.id, claim.id, 'supports')
  await graph.addRelation(photo.id, claim.id, 'supports')
  console.log(`  + Relations: evidence → supports → claim`)

  // 4. Agent makes a decision
  console.log('\n── Decision ────────────────────────────────────')

  const decision = await graph.recordDecision({
    selectedAction: 'approve_claim',
    alternatives: [
      { action: 'deny_claim', rejected: 'Both transcript and photos confirm water damage covered under HO-3' },
      { action: 'escalate_to_human', rejected: 'Combined evidence confidence > 0.9, amount within policy limits' },
    ],
    confidence: 0.92,
    reasoning: 'Policy HO-3-12345 covers water damage. Transcript confirms burst pipe incident. Photos corroborate damage. Estimated amount ($35k) is within policy limit ($100k).',
  })
  console.log(`  ✓ Decision: ${decision.selectedAction}`)
  console.log(`    Confidence: ${decision.confidence}`)
  console.log(`    Reasoning: ${decision.reasoning}`)
  console.log(`    Rejected alternatives:`)
  for (const alt of decision.alternatives) {
    console.log(`      ✗ ${alt.action} — ${alt.rejected}`)
  }

  // 5. Trace the causal chain
  console.log('\n── Causal Chain (why was this claim approved?) ─')

  const chain = await graph.traceBackward(claim.createdByEventId)
  for (let i = 0; i < chain.length; i++) {
    const indent = '  ' + '  '.repeat(i)
    console.log(`${indent}← ${chain[i].type} (${chain[i].id})`)
  }

  // 6. Query the graph
  console.log('\n── Graph State ─────────────────────────────────')

  const allObjects = await graph.queryObjects()
  const allRelations = await graph.queryRelations()
  console.log(`  Objects: ${allObjects.length}`)
  console.log(`  Relations: ${allRelations.length}`)

  const evidenceList = await graph.queryObjects({ type: 'evidence' })
  console.log(`  Evidence items: ${evidenceList.length}`)

  const tags = await graph.queryObjects({ type: 'tag' })
  console.log(`  Tags: ${tags.map((t) => t.data.label).join(', ') || 'none'}`)

  // 7. Check health / staleness
  console.log('\n── Health Check ─────────────────────────────────')
  const stale = await graph.getStaleObjects({ thresholdDays: 30 })
  console.log(`  Stale objects (>30 days): ${stale.length}`)
  console.log(`  (All objects are fresh — just created)`)

  console.log('\n' + '─'.repeat(50))
  console.log('◆ Demo complete. Every action above was event-sourced.')
  console.log('  Every mutation has a causal chain. Every decision is recorded.\n')
}

main().catch(console.error)
