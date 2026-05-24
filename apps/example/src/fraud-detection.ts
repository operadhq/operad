/**
 * Operad Example: Fraud Detection Agent
 *
 * Inspired by: "We deployed AI agents to detect fraud at one of the
 * largest banks in the US. Claude is a 10x fraud analyst — while still
 * making mistakes every entry-level analyst knows to avoid."
 *
 * This demo shows how Operad solves the 3 core problems:
 *   1. No institutional memory → Graph baselines
 *   2. No case coordination → Shared graph state
 *   3. No decision accountability → Decision records + compliance behaviors
 *
 * Run: pnpm demo:fraud
 */

import { createRuntime, behavior } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Compliance Behavior ──────────────────────────────────────────────────────

/** Automatically flag decisions that reference protected characteristics */
const complianceAudit = behavior({
  name: 'compliance-audit',
  on: ['decision.recorded'],
  handler: async (event, graph, ctx) => {
    const reasoning = (event.payload.reasoning as string) || ''
    const protectedTerms = ['national origin', 'race', 'gender', 'ethnicity', 'religion', 'age', 'disability']
    const violation = protectedTerms.find((term) => reasoning.toLowerCase().includes(term))

    if (violation) {
      await graph.addObject({
        type: 'compliance_flag',
        data: {
          decisionEventId: event.id,
          violation: `Decision reasoning references protected characteristic: "${violation}"`,
          severity: 'critical',
          requiresReview: true,
        },
      })
      console.log(`  🚨 COMPLIANCE FLAG: Reasoning references "${violation}" — flagged for review`)
    } else {
      console.log(`  ✅ Compliance check passed`)
    }
  },
})

/** Detect duplicate investigations on the same transaction */
const deduplicateInvestigations = behavior({
  name: 'deduplicate-investigations',
  on: ['object.created'],
  where: { 'payload.objectType': 'investigation' },
  handler: async (event, graph) => {
    const data = event.payload.data as Record<string, unknown>
    const txId = data.transactionId as string

    const existing = await graph.queryObjects({
      type: 'investigation',
      dataMatch: { transactionId: txId },
    })

    if (existing.length > 1) {
      console.log(`  ⚠️  Duplicate investigation detected for tx ${txId} — ${existing.length} agents investigating`)
      await graph.addObject({
        type: 'coordination_alert',
        data: {
          transactionId: txId,
          message: `${existing.length} concurrent investigations — consider merging`,
          investigationIds: existing.map((i) => i.id),
        },
      })
    }
  },
})

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n◆ Operad — Fraud Detection Demo\n')
  console.log('─'.repeat(55))

  const storage = new MemoryAdapter()
  const runtime = createRuntime({
    storage,
    behaviors: [complianceAudit, deduplicateInvestigations],
  })

  const graph = await runtime.createGraph('bank-fraud-unit')
  console.log('\n✓ Created graph: bank-fraud-unit')

  // ── Problem 1: Institutional Memory ─────────────────────────────────

  console.log('\n── Problem 1: Institutional Memory ─────────────')
  console.log('  Without Operad: Agent flags every large wire as fraud')
  console.log('  With Operad: Agent checks organizational baselines first\n')

  // Store institutional knowledge — what's NORMAL for this bank
  await graph.addObject({
    type: 'baseline',
    data: {
      pattern: 'international_wire',
      segment: 'corporate',
      normalRange: { min: 50000, max: 500000 },
      frequency: 'weekly',
      note: 'Corporate clients regularly wire internationally — not inherently suspicious',
    },
  })
  console.log('  + Baseline: corporate international wires ($50k-$500k weekly = normal)')

  await graph.addObject({
    type: 'baseline',
    data: {
      pattern: 'cash_deposit',
      segment: 'retail',
      normalRange: { min: 0, max: 5000 },
      frequency: 'monthly',
      note: 'Retail deposits above $5k monthly are unusual and worth reviewing',
    },
  })
  console.log('  + Baseline: retail cash deposits (>$5k monthly = review)')

  // Agent checks baseline before flagging
  const suspiciousTx = { type: 'international_wire', amount: 120000, segment: 'corporate' }
  const baselines = await graph.queryObjects({
    type: 'baseline',
    dataMatch: { pattern: suspiciousTx.type, segment: suspiciousTx.segment },
  })

  if (baselines.length > 0) {
    const range = baselines[0].data.normalRange as { min: number; max: number }
    if (suspiciousTx.amount >= range.min && suspiciousTx.amount <= range.max) {
      console.log(`  → $${suspiciousTx.amount.toLocaleString()} corporate wire: WITHIN normal range, not flagged`)
    }
  }

  // ── Problem 2: Case Coordination ────────────────────────────────────

  console.log('\n── Problem 2: Case Coordination ────────────────')
  console.log('  Without Operad: Two agents investigate the same case independently')
  console.log('  With Operad: Shared graph prevents duplicate work\n')

  // Agent A starts investigating
  await graph.addObject({
    type: 'investigation',
    data: { transactionId: 'tx_suspicious_789', assignedTo: 'agent-a', status: 'active' },
  })
  console.log('  + Agent A: opened investigation on tx_suspicious_789')

  // Agent B tries to investigate the same transaction
  const existing = await graph.queryObjects({
    type: 'investigation',
    dataMatch: { transactionId: 'tx_suspicious_789' },
  })

  if (existing.length > 0) {
    console.log(`  → Agent B: found existing investigation by ${existing[0].data.assignedTo}, adding evidence instead`)

    // Agent B adds evidence to existing investigation
    const evidence = await graph.addObject({
      type: 'evidence',
      data: {
        source: 'account_history',
        finding: 'Recipient account opened 3 days before transfer',
        foundBy: 'agent-b',
      },
    })
    await graph.addRelation(evidence.id, existing[0].id, 'relates_to')
    console.log('  + Agent B: added evidence to Agent A\'s investigation')
  }

  // ── Problem 3: Decision Accountability ──────────────────────────────

  console.log('\n── Problem 3: Decision Accountability ──────────')
  console.log('  Without Operad: No record of WHY agent flagged a transaction')
  console.log('  With Operad: Every decision recorded with full reasoning\n')

  // Good decision — passes compliance
  console.log('  Decision 1: Flag based on transaction patterns')
  await graph.recordDecision({
    selectedAction: 'flag_for_review',
    alternatives: [
      { action: 'mark_as_legitimate', rejected: 'New recipient + velocity spike warrants review' },
    ],
    confidence: 0.78,
    reasoning: 'Transaction flagged due to: (1) recipient account opened 3 days prior, (2) 4x velocity increase in outbound transfers this week, (3) amount exceeds historical pattern for this customer segment.',
  })

  // Bad decision — references protected characteristics, should be caught
  console.log('\n  Decision 2: Flag based on protected characteristics (BAD)')
  await graph.recordDecision({
    selectedAction: 'flag_for_review',
    alternatives: [
      { action: 'mark_as_legitimate', rejected: 'Pattern matches high-risk profile' },
    ],
    confidence: 0.65,
    reasoning: 'Flagged because sender national origin is associated with higher fraud rates in training data. Wire destination matches known corridor.',
  })

  // ── Summary ─────────────────────────────────────────────────────────

  console.log('\n── Summary ─────────────────────────────────────')

  const flags = await graph.queryObjects({ type: 'compliance_flag' })
  const investigations = await graph.queryObjects({ type: 'investigation' })
  const baselineCount = (await graph.queryObjects({ type: 'baseline' })).length
  const decisions = await graph.queryDecisions()

  console.log(`  Baselines stored: ${baselineCount}`)
  console.log(`  Active investigations: ${investigations.length}`)
  console.log(`  Decisions recorded: ${decisions.length}`)
  console.log(`  Compliance flags: ${flags.length}`)

  if (flags.length > 0) {
    console.log(`\n  ⚠️  ${flags.length} decision(s) flagged for compliance review:`)
    for (const flag of flags) {
      console.log(`     → ${flag.data.violation}`)
    }
  }

  console.log('\n' + '─'.repeat(55))
  console.log('◆ Every action above has a causal chain.')
  console.log('  Every decision is auditable. Compliance violations are caught.')
  console.log('  This is what agent infrastructure looks like.\n')
}

main().catch(console.error)
