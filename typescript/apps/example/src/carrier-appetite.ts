/**
 * Operad Example: Carrier Appetite Intelligence
 *
 * Insurance carriers change their appetite constantly:
 *   - "Hartford is aggressive on coastal homeowners this quarter"
 *   - "Progressive pulled back on young drivers in Texas"
 *   - "Travelers has a new BOP program with better rates for restaurants"
 *
 * This knowledge comes from carrier reps, industry newsletters,
 * agency owner experience, and trial-and-error quoting.
 * It changes monthly and is never written down.
 *
 * Operad tracks carrier appetite as living knowledge:
 *   1. Appetite signals from multiple sources (reps, experience, market)
 *   2. Auto-matching intake to best carrier based on current appetite
 *   3. Decision records showing WHY a carrier was recommended
 *   4. Staleness detection when appetite data is outdated
 *
 * Run: pnpm demo:appetite
 */

import { createRuntime, behavior } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Behaviors ──────────────────────────────────────────────────────────────

/** When intake arrives, rank carriers by current appetite match */
const recommendCarrier = behavior({
  name: 'recommend-best-carrier',
  on: ['object.created'],
  where: { 'payload.objectType': 'quote_request' },
  handler: async (event, graph) => {
    const data = event.payload.data as Record<string, unknown>
    const insuranceType = data.insuranceType as string
    const state = data.state as string
    const riskFactors = data.riskFactors as string[]

    // Find all appetite signals for this insurance type
    const appetites = await graph.queryObjects({
      type: 'carrier_appetite',
      dataMatch: { insuranceType },
    })

    if (appetites.length === 0) {
      console.log(`  ⚠️  No appetite data for "${insuranceType}" — quoting blind`)
      return
    }

    // Score each carrier based on appetite match
    const scored = appetites
      .map((a) => {
        let score = a.data.appetiteScore as number // base score 1-10

        // Bonus for state match
        const preferredStates = a.data.preferredStates as string[] | undefined
        if (preferredStates?.includes(state)) score += 2

        // Penalty for excluded risk factors
        const excludedRisks = a.data.excludedRisks as string[] | undefined
        const hasExcluded = excludedRisks?.some((r) => riskFactors.includes(r))
        if (hasExcluded) score -= 5

        // Bonus for active promotions
        if (a.data.hasPromotion) score += 1.5

        return { carrier: a.data.carrier as string, score, appetite: a }
      })
      .sort((a, b) => b.score - a.score)

    console.log(`  📊 Carrier ranking for ${insuranceType} in ${state}:`)
    for (let i = 0; i < scored.length; i++) {
      const s = scored[i]
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
      const promo = s.appetite.data.hasPromotion ? ' ⭐ PROMO' : ''
      console.log(`     ${medal} ${s.carrier}: score ${s.score.toFixed(1)}${promo}`)
    }

    // Record the recommendation decision
    const best = scored[0]
    const alternatives = scored.slice(1).map((s) => ({
      action: `quote_with_${s.carrier.toLowerCase().replace(/\s/g, '_')}`,
      rejected: `Score ${s.score.toFixed(1)} vs ${best.score.toFixed(1)} — ${best.carrier} has stronger appetite this month`,
    }))

    await graph.recordDecision({
      selectedAction: `recommend_${best.carrier.toLowerCase().replace(/\s/g, '_')}`,
      alternatives,
      confidence: Math.min(best.score / 12, 0.99),
      reasoning: `${best.carrier} ranked #1 for ${insuranceType} in ${state}. ` +
        `Appetite score: ${(best.appetite.data.appetiteScore as number)}/10. ` +
        `${best.appetite.data.hasPromotion ? 'Active promotion this month. ' : ''}` +
        `Source: ${best.appetite.data.source}.`,
    })
  },
})

/** Flag when appetite data is getting old */
const appetiteStalenessCheck = behavior({
  name: 'appetite-staleness-alert',
  on: ['object.created'],
  where: { 'payload.objectType': 'quote_request' },
  handler: async (event, graph) => {
    const appetites = await graph.queryObjects({ type: 'carrier_appetite' })
    const now = new Date()
    const stale = appetites.filter((a) => {
      const asOf = new Date(a.data.asOfDate as string)
      const daysSince = (now.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24)
      return daysSince > 30
    })

    if (stale.length > 0) {
      for (const s of stale) {
        console.log(`  ⏰ Stale appetite: ${s.data.carrier} ${s.data.insuranceType} — last updated ${s.data.asOfDate}`)
      }
    }
  },
})

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n◆ Operad — Carrier Appetite Intelligence\n')
  console.log('─'.repeat(60))
  console.log('  "Which carrier should I quote this month?"')
  console.log('  The answer changes constantly. Operad tracks it.\n')

  const storage = new MemoryAdapter()
  const runtime = createRuntime({
    storage,
    behaviors: [recommendCarrier, appetiteStalenessCheck],
  })

  const graph = await runtime.createGraph('acme-agency-appetite')

  // ── Load Current Appetite Signals ──────────────────────────────────

  console.log('── Loading Carrier Appetite Data ───────────────────')
  console.log('  Sources: carrier rep calls, newsletters, quoting experience\n')

  // Hartford — strong on homeowners this month
  await graph.addObject({
    type: 'carrier_appetite',
    data: {
      carrier: 'Hartford',
      insuranceType: 'homeowners',
      appetiteScore: 9,
      preferredStates: ['TX', 'FL', 'CA', 'AZ'],
      excludedRisks: ['flood_zone_A', 'prior_claims_3plus'],
      hasPromotion: true,
      promotionDetails: '15% new business discount on HO-3 through June 2026',
      source: 'carrier_rep_call_may_2026',
      asOfDate: '2026-05-15',
      notes: 'Hartford rep said they need to hit Q2 premium targets. Very aggressive pricing right now.',
    },
  })
  console.log('  + Hartford / Homeowners: 9/10 appetite 🔥')
  console.log('    Source: carrier rep call (May 15)')
  console.log('    Promo: 15% new business discount through June\n')

  // Progressive — pulled back on homeowners, strong on auto
  await graph.addObject({
    type: 'carrier_appetite',
    data: {
      carrier: 'Progressive',
      insuranceType: 'homeowners',
      appetiteScore: 4,
      preferredStates: ['OH', 'MI', 'PA'],
      excludedRisks: ['coastal', 'wildfire_zone', 'roof_age_20plus'],
      hasPromotion: false,
      source: 'quoting_experience_may_2026',
      asOfDate: '2026-05-10',
      notes: 'Getting non-renewed on coastal risks. Quotes coming back 30% higher than Hartford.',
    },
  })
  console.log('  + Progressive / Homeowners: 4/10 appetite')
  console.log('    Pulling back on coastal, quotes 30% higher\n')

  await graph.addObject({
    type: 'carrier_appetite',
    data: {
      carrier: 'Progressive',
      insuranceType: 'auto',
      appetiteScore: 8,
      preferredStates: ['TX', 'FL', 'CA', 'GA', 'NC'],
      excludedRisks: ['dui_history', 'sr22'],
      hasPromotion: true,
      promotionDetails: 'Bundle discount: auto + renters = 20% off both',
      source: 'progressive_agent_newsletter_may_2026',
      asOfDate: '2026-05-01',
      notes: 'Pushing hard on auto bundles. Name Your Price still converting well.',
    },
  })
  console.log('  + Progressive / Auto: 8/10 appetite')
  console.log('    Promo: 20% bundle discount (auto + renters)\n')

  // Travelers — steady on homeowners, strong on commercial
  await graph.addObject({
    type: 'carrier_appetite',
    data: {
      carrier: 'Travelers',
      insuranceType: 'homeowners',
      appetiteScore: 7,
      preferredStates: ['TX', 'CO', 'NC', 'VA'],
      excludedRisks: ['trampoline', 'exotic_pets', 'home_business'],
      hasPromotion: false,
      source: 'agency_owner_experience',
      asOfDate: '2026-05-20',
      notes: 'Steady appetite. Not the cheapest but fastest claims turnaround. Good for clients who value service.',
    },
  })
  console.log('  + Travelers / Homeowners: 7/10 appetite')
  console.log('    Steady — good claims service, not cheapest\n')

  await graph.addObject({
    type: 'carrier_appetite',
    data: {
      carrier: 'Travelers',
      insuranceType: 'BOP',
      appetiteScore: 9,
      preferredStates: ['TX', 'FL', 'CA', 'NY', 'IL'],
      excludedRisks: ['cannabis', 'firearms_retail'],
      hasPromotion: true,
      promotionDetails: 'New restaurant BOP program — 25% below market for qualifying risks',
      source: 'travelers_commercial_webinar_may_2026',
      asOfDate: '2026-05-18',
      notes: 'Brand new program targeting restaurants and retail. Very competitive.',
    },
  })
  console.log('  + Travelers / BOP: 9/10 appetite 🔥')
  console.log('    New restaurant program — 25% below market\n')

  // Old data — should trigger staleness warning
  await graph.addObject({
    type: 'carrier_appetite',
    data: {
      carrier: 'Nationwide',
      insuranceType: 'homeowners',
      appetiteScore: 6,
      preferredStates: ['OH', 'PA', 'IN', 'KY'],
      excludedRisks: ['coastal'],
      hasPromotion: false,
      source: 'carrier_rep_call_march_2026',
      asOfDate: '2026-03-10',
      notes: 'Was moderately interested in March. Need to check if this is still current.',
    },
  })
  console.log('  + Nationwide / Homeowners: 6/10 appetite')
  console.log('    ⚠️  Data from March — may be outdated\n')

  // ── Simulate Quote Requests ────────────────────────────────────────

  console.log('── Quote Request 1: TX Homeowners ──────────────────\n')
  await graph.addObject({
    type: 'quote_request',
    data: {
      customerName: 'Maria Garcia',
      insuranceType: 'homeowners',
      state: 'TX',
      propertyValue: 350000,
      riskFactors: ['pool', 'new_construction'],
    },
  })

  console.log('\n── Quote Request 2: FL Homeowners (Coastal) ────────\n')
  await graph.addObject({
    type: 'quote_request',
    data: {
      customerName: 'James Wilson',
      insuranceType: 'homeowners',
      state: 'FL',
      propertyValue: 520000,
      riskFactors: ['coastal', 'pool'],
    },
  })

  console.log('\n── Quote Request 3: TX Auto ────────────────────────\n')
  await graph.addObject({
    type: 'quote_request',
    data: {
      customerName: 'Sarah Chen',
      insuranceType: 'auto',
      state: 'TX',
      vehicleYear: 2024,
      riskFactors: ['new_driver'],
    },
  })

  console.log('\n── Quote Request 4: TX Restaurant BOP ─────────────\n')
  await graph.addObject({
    type: 'quote_request',
    data: {
      customerName: 'Thai Kitchen LLC',
      insuranceType: 'BOP',
      state: 'TX',
      businessType: 'restaurant',
      riskFactors: ['cooking_operations'],
    },
  })

  // ── Decision Audit ─────────────────────────────────────────────────

  console.log('\n── Decision Audit: Why These Carriers? ─────────────\n')

  const decisions = await graph.queryDecisions()
  for (const dec of decisions) {
    console.log(`  ✦ ${dec.selectedAction}`)
    console.log(`    Confidence: ${dec.confidence.toFixed(2)}`)
    console.log(`    Why: ${dec.reasoning}`)
    for (const alt of dec.alternatives) {
      console.log(`    Passed on: ${alt.action} — ${alt.rejected}`)
    }
    console.log()
  }

  // ── Appetite Summary ───────────────────────────────────────────────

  console.log('── This Month\'s Appetite Summary ───────────────────\n')

  const appetites = await graph.queryObjects({ type: 'carrier_appetite' })
  const byType = new Map<string, typeof appetites>()
  for (const a of appetites) {
    const type = a.data.insuranceType as string
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type)!.push(a)
  }

  for (const [type, carriers] of byType) {
    const sorted = carriers.sort((a, b) => (b.data.appetiteScore as number) - (a.data.appetiteScore as number))
    console.log(`  ${type.toUpperCase()}:`)
    for (const c of sorted) {
      const score = c.data.appetiteScore as number
      const bar = '█'.repeat(score) + '░'.repeat(10 - score)
      const promo = c.data.hasPromotion ? ' ⭐' : ''
      console.log(`    ${bar} ${score}/10 ${c.data.carrier}${promo}`)
    }
    console.log()
  }

  console.log('─'.repeat(60))
  console.log('◆ Carrier appetite is the most valuable — and most')
  console.log('  perishable — knowledge in an insurance agency.')
  console.log('  It changes monthly, comes from 5 different sources,')
  console.log('  and lives entirely in experienced agents\' heads.\n')
  console.log('  Now it lives in a graph. Traceable. Auditable. Fresh.\n')
}

main().catch(console.error)
