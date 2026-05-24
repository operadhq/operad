/**
 * Operad Example: Agent Onboarding — Procedural Knowledge
 *
 * When a new AI agent joins an insurance agency, it needs to learn
 * the agency's procedures, rules, and institutional knowledge.
 *
 * This demo shows how Operad models procedural knowledge:
 *   1. SOPs as graph objects with steps linked by relations
 *   2. Agency rules with provenance (who taught it, when)
 *   3. The agent following a procedure and recording decisions
 *   4. Staleness detection — flagging outdated procedures
 *
 * Run: pnpm demo:onboarding
 */

import { createRuntime, behavior } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Behaviors ──────────────────────────────────────────────────────────────

/** When a new procedure step is created, check if it references outdated rules */
const validateProcedure = behavior({
  name: 'validate-procedure-step',
  on: ['object.created'],
  where: { 'payload.objectType': 'procedure_step' },
  handler: async (event, graph) => {
    const data = event.payload.data as Record<string, unknown>
    const ruleRef = data.requiresRule as string | undefined

    if (ruleRef) {
      const rules = await graph.queryObjects({ type: 'rule', dataMatch: { ruleId: ruleRef } })
      if (rules.length === 0) {
        await graph.addObject({
          type: 'onboarding_warning',
          data: {
            message: `Procedure step references rule "${ruleRef}" which doesn't exist yet`,
            stepName: data.name,
            severity: 'warning',
          },
        })
        console.log(`  ⚠️  Step "${data.name}" references unknown rule: ${ruleRef}`)
      }
    }
  },
})

/** Track when an agent completes onboarding for a procedure */
const trackCompletion = behavior({
  name: 'track-onboarding-completion',
  on: ['decision.recorded'],
  handler: async (event, graph) => {
    const action = event.payload.selectedAction as string
    if (action.startsWith('complete_step:')) {
      const stepName = action.replace('complete_step:', '')
      console.log(`  📋 Agent completed procedure step: "${stepName}"`)
    }
  },
})

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n◆ Operad — Agent Onboarding Demo\n')
  console.log('─'.repeat(55))
  console.log('  Scenario: Teaching a new agent the procedures for')
  console.log('  "Acme Insurance Agency" — their specific workflows,')
  console.log('  rules, and institutional knowledge.\n')

  const storage = new MemoryAdapter()
  const runtime = createRuntime({
    storage,
    behaviors: [validateProcedure, trackCompletion],
  })

  const graph = await runtime.createGraph('acme-insurance-onboarding')

  // ── Phase 1: Load Agency SOPs ──────────────────────────────────────

  console.log('── Phase 1: Load Agency SOPs ───────────────────')
  console.log('  Source: Acme Insurance Agency operations manual\n')

  // Create the SOP document as a root object
  const sop = await graph.addObject({
    type: 'sop_document',
    data: {
      title: 'Claims Intake Procedure',
      version: '3.2',
      lastReviewed: '2026-03-15',
      source: 'operations_manual_v3.pdf',
      department: 'claims',
    },
  })
  console.log(`  + SOP: "${sop.data.title}" (v${sop.data.version})`)

  // Create procedure steps — each is an object, linked in sequence
  const step1 = await graph.addObject({
    type: 'procedure_step',
    data: {
      name: 'Verify caller identity',
      order: 1,
      instructions: 'Ask for policy number and date of birth. Verify against records.',
      requiresRule: 'RULE-AUTH-01',
      estimatedDuration: '2 minutes',
    },
  })

  const step2 = await graph.addObject({
    type: 'procedure_step',
    data: {
      name: 'Collect incident details',
      order: 2,
      instructions: 'Record: date of loss, type of damage, location, description of what happened.',
      requiresRule: null,
      estimatedDuration: '5 minutes',
    },
  })

  const step3 = await graph.addObject({
    type: 'procedure_step',
    data: {
      name: 'Check coverage applicability',
      order: 3,
      instructions: 'Pull policy details. Verify the reported damage type is covered under the active policy.',
      requiresRule: 'RULE-COV-01',
      estimatedDuration: '3 minutes',
    },
  })

  const step4 = await graph.addObject({
    type: 'procedure_step',
    data: {
      name: 'Route or approve',
      order: 4,
      instructions: 'If claim < $10k and coverage confirmed, approve. Otherwise escalate to senior adjuster.',
      requiresRule: 'RULE-APPROVE-01',
      estimatedDuration: '1 minute',
    },
  })

  // Link steps to the SOP and to each other
  await graph.addRelation(step1.id, sop.id, 'belongs_to')
  await graph.addRelation(step2.id, sop.id, 'belongs_to')
  await graph.addRelation(step3.id, sop.id, 'belongs_to')
  await graph.addRelation(step4.id, sop.id, 'belongs_to')
  await graph.addRelation(step1.id, step2.id, 'followed_by')
  await graph.addRelation(step2.id, step3.id, 'followed_by')
  await graph.addRelation(step3.id, step4.id, 'followed_by')

  console.log('  + 4 procedure steps loaded and linked\n')

  // ── Phase 2: Load Agency Rules ─────────────────────────────────────

  console.log('── Phase 2: Load Agency Rules ──────────────────')
  console.log('  Source: Acme compliance handbook + tribal knowledge\n')

  await graph.addObject({
    type: 'rule',
    data: {
      ruleId: 'RULE-AUTH-01',
      name: 'Caller Authentication',
      description: 'Must verify policy number AND date of birth before discussing any claim details.',
      source: 'compliance_handbook_2026.pdf',
      mandatory: true,
    },
  })
  console.log('  + RULE-AUTH-01: Caller Authentication (mandatory)')

  await graph.addObject({
    type: 'rule',
    data: {
      ruleId: 'RULE-COV-01',
      name: 'Coverage Verification',
      description: 'Always check policy active status and coverage type before proceeding. HO-3 covers water damage. HO-1 does NOT.',
      source: 'compliance_handbook_2026.pdf',
      mandatory: true,
    },
  })
  console.log('  + RULE-COV-01: Coverage Verification (mandatory)')

  await graph.addObject({
    type: 'rule',
    data: {
      ruleId: 'RULE-APPROVE-01',
      name: 'Approval Threshold',
      description: 'Agent can approve claims under $10,000 if coverage is confirmed. Claims $10k+ require senior adjuster review.',
      source: 'agency_owner_verbal',
      mandatory: true,
    },
  })
  console.log('  + RULE-APPROVE-01: Approval Threshold ($10k, from agency owner)')

  // Institutional knowledge — not from a manual, from experience
  await graph.addObject({
    type: 'baseline',
    data: {
      pattern: 'water_damage_claims',
      note: 'We see a spike in water damage claims every January (frozen pipes). These are almost always legitimate — do NOT over-scrutinize.',
      source: 'senior_adjuster_mike',
      learnedFrom: 'experience',
    },
  })
  console.log('  + Baseline: January water damage spike (from Senior Adjuster Mike)\n')

  // ── Phase 3: Agent Follows a Procedure ─────────────────────────────

  console.log('── Phase 3: Agent Follows a Procedure ──────────')
  console.log('  Simulating: A new agent handles its first claim call\n')

  // Agent looks up the procedure
  const steps = await graph.queryObjects({ type: 'procedure_step' })
  const sortedSteps = steps.sort(
    (a, b) => (a.data.order as number) - (b.data.order as number)
  )

  console.log(`  Found ${sortedSteps.length} steps in Claims Intake Procedure:\n`)

  // Step 1: Verify identity
  const authRules = await graph.queryObjects({
    type: 'rule',
    dataMatch: { ruleId: 'RULE-AUTH-01' },
  })
  console.log(`  Step 1: ${sortedSteps[0].data.name}`)
  console.log(`    Rule: ${authRules[0].data.name} — "${authRules[0].data.description}"`)

  await graph.recordDecision({
    selectedAction: 'complete_step:Verify caller identity',
    alternatives: [
      { action: 'skip_verification', rejected: 'RULE-AUTH-01 is mandatory — cannot skip' },
    ],
    confidence: 1.0,
    reasoning: 'Customer provided policy HO-3-98765 and DOB 1985-04-12. Verified against records.',
  })

  // Step 2: Collect details
  console.log(`\n  Step 2: ${sortedSteps[1].data.name}`)
  const incident = await graph.addObject({
    type: 'incident_report',
    data: {
      dateOfLoss: '2026-05-20',
      damageType: 'water_damage',
      location: '123 Oak St, Austin TX',
      description: 'Burst pipe in kitchen. Water damage to flooring and lower cabinets.',
    },
  })
  await graph.addRelation(incident.id, sop.id, 'processed_under')
  console.log('    Collected: water damage, burst pipe, 123 Oak St')

  await graph.recordDecision({
    selectedAction: 'complete_step:Collect incident details',
    alternatives: [],
    confidence: 0.95,
    reasoning: 'All required fields captured: date, type, location, description.',
  })

  // Step 3: Check coverage — agent uses rules AND baselines
  console.log(`\n  Step 3: ${sortedSteps[2].data.name}`)
  const coverageRules = await graph.queryObjects({
    type: 'rule',
    dataMatch: { ruleId: 'RULE-COV-01' },
  })
  const baselines = await graph.queryObjects({
    type: 'baseline',
    dataMatch: { pattern: 'water_damage_claims' },
  })

  console.log(`    Rule: ${coverageRules[0].data.description}`)
  console.log(`    Baseline: "${baselines[0].data.note}"`)

  await graph.recordDecision({
    selectedAction: 'complete_step:Check coverage applicability',
    alternatives: [
      { action: 'flag_as_suspicious', rejected: 'January baseline: water damage claims are typically legitimate' },
    ],
    confidence: 0.93,
    reasoning: 'Policy HO-3 covers water damage. Date is May (not January spike but still legitimate). Claim appears straightforward.',
  })

  // Step 4: Route or approve
  console.log(`\n  Step 4: ${sortedSteps[3].data.name}`)
  const approvalRules = await graph.queryObjects({
    type: 'rule',
    dataMatch: { ruleId: 'RULE-APPROVE-01' },
  })
  console.log(`    Rule: ${approvalRules[0].data.description}`)

  const claimAmount = 7500
  console.log(`    Claim amount: $${claimAmount.toLocaleString()}`)

  await graph.recordDecision({
    selectedAction: claimAmount < 10000 ? 'approve_claim' : 'escalate_to_senior',
    alternatives: [
      { action: 'escalate_to_senior', rejected: `Claim $${claimAmount.toLocaleString()} is under $10k threshold per RULE-APPROVE-01` },
    ],
    confidence: 0.96,
    reasoning: `Claim is $${claimAmount.toLocaleString()}, under $10k threshold. Coverage confirmed (HO-3, water damage). Approving per RULE-APPROVE-01.`,
  })

  // ── Phase 4: Audit Trail ───────────────────────────────────────────

  console.log('\n── Phase 4: Full Audit Trail ────────────────────')
  console.log('  "Why did the agent approve this claim?"\n')

  const decisions = await graph.queryDecisions()
  for (const dec of decisions) {
    console.log(`  Decision: ${dec.selectedAction}`)
    console.log(`    Confidence: ${dec.confidence}`)
    console.log(`    Reasoning: ${dec.reasoning}`)
    if (dec.alternatives.length > 0) {
      for (const alt of dec.alternatives) {
        console.log(`    Rejected: "${alt.action}" — ${alt.rejected}`)
      }
    }
    console.log()
  }

  // ── Phase 5: Staleness Check ───────────────────────────────────────

  console.log('── Phase 5: Staleness Check ────────────────────')
  console.log('  Which procedures and rules need review?\n')

  // In a real system, these would be days old. Simulate by checking.
  const allRules = await graph.queryObjects({ type: 'rule' })
  for (const rule of allRules) {
    const source = rule.data.source as string
    if (source === 'agency_owner_verbal') {
      console.log(`  ⚠️  "${rule.data.name}" was learned verbally — no document source.`)
      console.log(`     Consider formalizing in writing for compliance.\n`)
    }
  }

  const sopDoc = await graph.queryObjects({ type: 'sop_document' })
  const lastReviewed = sopDoc[0].data.lastReviewed as string
  const daysSince = Math.floor(
    (Date.now() - new Date(lastReviewed).getTime()) / (1000 * 60 * 60 * 24)
  )
  console.log(`  SOP "${sopDoc[0].data.title}" last reviewed: ${lastReviewed} (${daysSince} days ago)`)
  if (daysSince > 60) {
    console.log('  ⚠️  Over 60 days — schedule a review.\n')
  } else {
    console.log('  ✅ Within 60-day review window.\n')
  }

  // ── Summary ────────────────────────────────────────────────────────

  console.log('─'.repeat(55))
  console.log('◆ The agent learned procedures, rules, and institutional')
  console.log('  knowledge — all with full provenance. Every decision')
  console.log('  traces back to the SOP step, rule, or baseline that')
  console.log('  informed it. Stale knowledge is flagged for review.')
  console.log('\n  This is agent onboarding with Operad.\n')
}

main().catch(console.error)
