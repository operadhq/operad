/**
 * Operad Example: Carrier Portal Routing
 *
 * Insurance agencies work with multiple carriers (Hartford, Progressive,
 * Travelers, etc.). After customer intake, the agent must:
 *   1. Determine which carrier handles this policy
 *   2. Route to the correct portal
 *   3. Follow carrier-specific procedures (each portal is different)
 *   4. Track which procedures worked and which are stale
 *
 * This knowledge lives in senior CSRs' heads today. Operad makes it
 * a traceable, auditable, self-correcting knowledge graph.
 *
 * Run: pnpm demo:carrier
 */

import { createRuntime, behavior } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Behaviors ──────────────────────────────────────────────────────────────

/** When intake is complete, auto-route to the correct carrier */
const autoRoute = behavior({
  name: 'auto-route-to-carrier',
  on: ['object.created'],
  where: { 'payload.objectType': 'intake' },
  handler: async (event, graph) => {
    const data = event.payload.data as Record<string, unknown>
    const carrier = data.carrier as string
    const policyType = data.policyType as string

    // Look up the carrier portal
    const portals = await graph.queryObjects({
      type: 'carrier_portal',
      dataMatch: { carrier },
    })

    if (portals.length === 0) {
      await graph.addObject({
        type: 'routing_error',
        data: {
          message: `No portal configured for carrier: ${carrier}`,
          intakeId: event.payload.objectId,
          action: 'escalate_to_human',
        },
      })
      console.log(`  🚨 No portal found for carrier "${carrier}" — escalating to human`)
      return
    }

    const portal = portals[0]

    // Look up the procedure for this carrier + policy type combo
    const procedures = await graph.queryObjects({
      type: 'carrier_procedure',
      dataMatch: { carrier, policyType },
    })

    if (procedures.length > 0) {
      console.log(`  → Auto-routed to ${portal.data.name} (${portal.data.url})`)
      console.log(`  → Found procedure: "${procedures[0].data.name}" (${(procedures[0].data.steps as unknown[]).length} steps)`)
    } else {
      // We know the portal but don't have a procedure for this policy type
      console.log(`  → Portal found: ${portal.data.name}`)
      console.log(`  ⚠️  No procedure for ${carrier} + ${policyType} — agent must improvise`)

      await graph.addObject({
        type: 'knowledge_gap',
        data: {
          carrier,
          policyType,
          message: `No procedure exists for filing ${policyType} claims with ${carrier}`,
          suggestedAction: 'Ask senior CSR to document the process',
        },
      })
    }
  },
})

/** Track procedure success/failure for health scoring */
const trackProcedureOutcome = behavior({
  name: 'track-procedure-outcome',
  on: ['decision.recorded'],
  handler: async (event, graph) => {
    const action = event.payload.selectedAction as string
    if (action === 'procedure_succeeded' || action === 'procedure_failed') {
      const reasoning = event.payload.reasoning as string
      if (action === 'procedure_failed') {
        console.log(`  🔴 Procedure failed — "${reasoning}"`)
        console.log(`     This procedure may need updating.`)
      }
    }
  },
})

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n◆ Operad — Carrier Portal Routing Demo\n')
  console.log('─'.repeat(60))
  console.log('  Scenario: Agency works with 3 carriers. Each has a')
  console.log('  different portal with different procedures. Agent must')
  console.log('  route intake to the right portal and follow the right steps.\n')

  const storage = new MemoryAdapter()
  const runtime = createRuntime({
    storage,
    behaviors: [autoRoute, trackProcedureOutcome],
  })

  const graph = await runtime.createGraph('acme-agency-carriers')

  // ── Load Carrier Portals ───────────────────────────────────────────

  console.log('── Loading Carrier Portals ─────────────────────────')
  console.log('  Source: Agency admin setup + CSR tribal knowledge\n')

  await graph.addObject({
    type: 'carrier_portal',
    data: {
      carrier: 'Hartford',
      name: 'Hartford Agent Portal',
      url: 'https://agentportal.thehartford.com',
      loginMethod: 'SSO',
      notes: 'Slow during month-end. Submit claims before the 28th.',
      learnedFrom: 'senior_csr_sarah',
    },
  })
  console.log('  + Hartford Agent Portal (SSO login)')

  await graph.addObject({
    type: 'carrier_portal',
    data: {
      carrier: 'Progressive',
      name: 'ForAgentsOnly.com',
      url: 'https://foragentsonly.progressive.com',
      loginMethod: 'username_password',
      notes: 'New UI rolled out March 2026. Claims tab moved to left sidebar.',
      learnedFrom: 'csr_training_march_2026',
    },
  })
  console.log('  + Progressive ForAgentsOnly (username/password)')

  await graph.addObject({
    type: 'carrier_portal',
    data: {
      carrier: 'Travelers',
      name: 'Travelers MyTravelers',
      url: 'https://mytravelers.travelers.com',
      loginMethod: 'SSO',
      notes: 'Requires 2FA every session. Keep auth app handy.',
      learnedFrom: 'it_admin_setup',
    },
  })
  console.log('  + Travelers MyTravelers (SSO + 2FA)\n')

  // ── Load Carrier-Specific Procedures ───────────────────────────────

  console.log('── Loading Carrier Procedures ──────────────────────')
  console.log('  Each carrier has different steps for filing claims.\n')

  await graph.addObject({
    type: 'carrier_procedure',
    data: {
      carrier: 'Hartford',
      policyType: 'HO-3',
      name: 'Hartford HO-3 Claim Filing',
      lastVerified: '2026-04-10',
      verifiedBy: 'senior_csr_sarah',
      steps: [
        { order: 1, action: 'Login via SSO', notes: null },
        { order: 2, action: 'Navigate to Claims → New Claim', notes: 'Top nav bar, not sidebar' },
        { order: 3, action: 'Select policy from dropdown', notes: 'Search by policy number, NOT insured name' },
        { order: 4, action: 'Fill incident details form', notes: 'Date format: MM/DD/YYYY. Description max 500 chars.' },
        { order: 5, action: 'Upload supporting docs', notes: 'PDFs only. Max 10MB per file. Photos must be converted.' },
        { order: 6, action: 'Submit and note confirmation number', notes: 'Starts with HC-. Save this immediately.' },
      ],
    },
  })
  console.log('  + Hartford HO-3: 6 steps (verified Apr 10 by Sarah)')

  await graph.addObject({
    type: 'carrier_procedure',
    data: {
      carrier: 'Progressive',
      policyType: 'auto',
      name: 'Progressive Auto Claim Filing',
      lastVerified: '2026-03-20',
      verifiedBy: 'csr_training_march_2026',
      steps: [
        { order: 1, action: 'Login with agency credentials', notes: null },
        { order: 2, action: 'Click Claims in LEFT sidebar', notes: 'Changed from top nav in March 2026 UI update' },
        { order: 3, action: 'Click "Report New Claim"', notes: 'Blue button, easy to miss — it\'s below the search bar' },
        { order: 4, action: 'Enter VIN or policy number', notes: 'VIN is faster — auto-populates vehicle info' },
        { order: 5, action: 'Complete accident details wizard', notes: '4-page wizard. Can\'t go back after page 3 — get it right.' },
        { order: 6, action: 'Assign adjuster or let system auto-assign', notes: 'Auto-assign is fine for claims under $5k' },
        { order: 7, action: 'Download claim receipt PDF', notes: 'Only available for 24 hours after submission!' },
      ],
    },
  })
  console.log('  + Progressive Auto: 7 steps (verified Mar 20)')

  await graph.addObject({
    type: 'carrier_procedure',
    data: {
      carrier: 'Travelers',
      policyType: 'BOP',
      name: 'Travelers BOP Claim Filing',
      lastVerified: '2025-11-15',
      verifiedBy: 'senior_csr_mike',
      steps: [
        { order: 1, action: 'Login via SSO + complete 2FA', notes: 'Auth code expires in 30 seconds' },
        { order: 2, action: 'Navigate to Commercial → Claims', notes: null },
        { order: 3, action: 'Search policy by account number', notes: 'NOT policy number — use account number from BOP dec page' },
        { order: 4, action: 'Select "File New Claim" from actions menu', notes: 'Three-dot menu on the right side of the policy row' },
        { order: 5, action: 'Complete claim form (3 sections)', notes: 'Section 2 asks for "reserve estimate" — put $0 if unknown' },
        { order: 6, action: 'Submit and wait for claim number email', notes: 'Takes 2-4 hours. Don\'t resubmit thinking it failed.' },
      ],
    },
  })
  console.log('  + Travelers BOP: 6 steps (verified Nov 2025 ⚠️ )\n')

  // ── Simulate 3 Customer Intakes ────────────────────────────────────

  console.log('── Simulating Customer Intakes ─────────────────────\n')

  // Intake 1: Hartford HO-3 — has a procedure
  console.log('  📞 Intake 1: Water damage claim, Hartford HO-3')
  const intake1 = await graph.addObject({
    type: 'intake',
    data: {
      customerName: 'Jane Smith',
      policyNumber: 'HO3-2026-78901',
      carrier: 'Hartford',
      policyType: 'HO-3',
      claimType: 'water_damage',
      description: 'Burst pipe in basement. Flooding damaged finished basement.',
    },
  })

  // Agent follows the procedure — record the decision
  await graph.recordDecision({
    selectedAction: 'route_to_carrier_portal',
    alternatives: [
      { action: 'call_carrier_directly', rejected: 'Portal filing is faster and creates digital record' },
    ],
    confidence: 0.98,
    reasoning: 'Hartford HO-3 procedure found (6 steps, verified Apr 10). Routing to Hartford Agent Portal via SSO.',
  })

  // Intake 2: Progressive auto — has a procedure
  console.log('\n  📞 Intake 2: Auto accident claim, Progressive')
  await graph.addObject({
    type: 'intake',
    data: {
      customerName: 'Bob Johnson',
      policyNumber: 'PA-2026-34567',
      carrier: 'Progressive',
      policyType: 'auto',
      claimType: 'collision',
      description: 'Rear-ended at a stoplight. Bumper and trunk damage.',
    },
  })

  await graph.recordDecision({
    selectedAction: 'route_to_carrier_portal',
    alternatives: [
      { action: 'use_progressive_phone_system', rejected: 'Phone wait times averaging 45min this week' },
    ],
    confidence: 0.95,
    reasoning: 'Progressive auto procedure found (7 steps, verified Mar 20). NOTE: Claims tab moved to left sidebar in March UI update.',
  })

  // Intake 3: Hartford commercial — NO procedure exists
  console.log('\n  📞 Intake 3: Commercial property claim, Hartford')
  await graph.addObject({
    type: 'intake',
    data: {
      customerName: 'Acme Corp',
      policyNumber: 'CP-2026-99001',
      carrier: 'Hartford',
      policyType: 'commercial_property',
      claimType: 'fire_damage',
      description: 'Electrical fire in warehouse. Significant inventory loss.',
    },
  })

  // Simulate: agent improvises but the portal UI changed
  console.log('\n  Agent attempting to file via Hartford portal...')
  await graph.recordDecision({
    selectedAction: 'procedure_failed',
    alternatives: [
      { action: 'procedure_succeeded', rejected: 'Commercial claims form not found at expected location' },
    ],
    confidence: 0.3,
    reasoning: 'Hartford portal redesigned commercial section. "File Claim" button moved to a new "Commercial Hub" area. Need updated procedure.',
  })

  // Agent learns from the failure and records new knowledge
  const newProcedure = await graph.addObject({
    type: 'carrier_procedure',
    data: {
      carrier: 'Hartford',
      policyType: 'commercial_property',
      name: 'Hartford Commercial Property Claim Filing (NEW)',
      lastVerified: new Date().toISOString().split('T')[0],
      verifiedBy: 'ai_agent_self_discovered',
      steps: [
        { order: 1, action: 'Login via SSO', notes: null },
        { order: 2, action: 'Navigate to Commercial Hub (new section)', notes: 'NOT the regular Claims menu — separate section added Q2 2026' },
        { order: 3, action: 'Click "Report Commercial Claim"', notes: 'Orange button in the center of the Commercial Hub dashboard' },
        { order: 4, action: 'Enter policy number and select peril type', notes: 'Peril types: fire, water, wind, theft, liability, other' },
        { order: 5, action: 'Complete commercial claim wizard', notes: 'Requires reserve estimate — call underwriter if unsure' },
        { order: 6, action: 'Submit and save confirmation', notes: 'Format: HCC-XXXXXX' },
      ],
      discoveredVia: 'agent_exploration_after_failure',
    },
  })
  console.log('\n  ✅ Agent self-discovered new procedure and recorded it')
  console.log(`     "${newProcedure.data.name}" — 6 steps`)

  // ── Staleness Report ───────────────────────────────────────────────

  console.log('\n── Staleness Report ────────────────────────────────')
  console.log('  Which carrier procedures need re-verification?\n')

  const allProcedures = await graph.queryObjects({ type: 'carrier_procedure' })
  const now = new Date()

  for (const proc of allProcedures) {
    const lastVerified = new Date(proc.data.lastVerified as string)
    const daysSince = Math.floor((now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24))
    const status = daysSince > 60 ? '🔴 STALE' : daysSince > 30 ? '🟡 AGING' : '🟢 FRESH'

    console.log(`  ${status} ${proc.data.name}`)
    console.log(`         Last verified: ${proc.data.lastVerified} (${daysSince} days ago)`)
    console.log(`         Verified by: ${proc.data.verifiedBy}`)

    if (proc.data.discoveredVia) {
      console.log(`         ⚡ Self-discovered by agent (needs human verification)`)
    }
    console.log()
  }

  // ── Knowledge Gaps ─────────────────────────────────────────────────

  console.log('── Knowledge Gaps ──────────────────────────────────')

  const gaps = await graph.queryObjects({ type: 'knowledge_gap' })
  const errors = await graph.queryObjects({ type: 'routing_error' })

  if (gaps.length === 0 && errors.length === 0) {
    console.log('  ✅ No gaps detected.\n')
  } else {
    for (const gap of gaps) {
      console.log(`  📝 ${gap.data.carrier}/${gap.data.policyType}: ${gap.data.message}`)
      console.log(`     → ${gap.data.suggestedAction}\n`)
    }
  }

  // ── Audit: Decision History ────────────────────────────────────────

  console.log('── Decision Audit Trail ────────────────────────────')
  console.log('  Every routing decision is recorded with full reasoning.\n')

  const decisions = await graph.queryDecisions()
  for (const dec of decisions) {
    const emoji = dec.confidence > 0.9 ? '✅' : dec.confidence > 0.5 ? '🟡' : '🔴'
    console.log(`  ${emoji} ${dec.selectedAction} (confidence: ${dec.confidence})`)
    console.log(`     ${dec.reasoning}`)
    console.log()
  }

  console.log('─'.repeat(60))
  console.log('◆ Carrier routing as procedural knowledge:')
  console.log('  • Each portal has documented procedures with step-by-step notes')
  console.log('  • Agents auto-route intakes to the right portal')
  console.log('  • Failed procedures are caught and new ones self-discovered')
  console.log('  • Stale procedures are flagged for re-verification')
  console.log('  • Every decision has an audit trail\n')
  console.log('  This is the knowledge that lives in senior CSRs\' heads.')
  console.log('  Now it lives in a graph — traceable, auditable, and fresh.\n')
}

main().catch(console.error)
