/**
 * Operad Example: Call Session → AI Chat → Browser Task
 *
 * Simulates a full Sozo session: an inbound call triggers intake,
 * AI chat routes the claim, and browser tasks file it on carrier portals.
 *
 * Mirrors ActiveGraph's quickstart pattern:
 *   1. Run → see events stream
 *   2. Print trace (event log)
 *   3. Open visual graph (timeline + tree panel)
 *
 * Run: pnpm demo:session
 */

import { writeFileSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { createRuntime, behavior, renderAsciiGraph } from '@operad/core'
import type { RenderableObject, RenderableRelation } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { renderHtmlGraph } from '@operad/session'

// ─── Behaviors ──────────────────────────────────────────────────────────────

/** When a call ends, extract intake data and route to carrier */
const postCallRouter = behavior({
  name: 'post-call-router',
  on: ['object.created'],
  where: { 'payload.objectType': 'call_transcript' },
  handler: async (event, graph) => {
    const data = event.payload.data as Record<string, unknown>
    const carrier = data.detectedCarrier as string
    if (carrier) {
      console.log(`  🔀 Auto-routing to ${carrier} portal`)
    }
  },
})

/** When a browser task completes, record the outcome */
const taskOutcomeTracker = behavior({
  name: 'task-outcome-tracker',
  on: ['object.created'],
  where: { 'payload.objectType': 'browser_task_result' },
  handler: async (event, graph) => {
    const data = event.payload.data as Record<string, unknown>
    const status = data.status as string
    if (status === 'success') {
      console.log(`  ✅ Browser task completed: ${data.task}`)
    } else {
      console.log(`  🔴 Browser task failed: ${data.task} — ${data.error}`)
    }
  },
})

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n◆ Operad — Call Session Demo')
  console.log('  Simulating: inbound call → intake → carrier portal filing\n')
  console.log('─'.repeat(60))

  const storage = new MemoryAdapter()
  const runtime = createRuntime({
    storage,
    behaviors: [postCallRouter, taskOutcomeTracker],
  })

  const graph = await runtime.createGraph('call-session-demo')

  // ── Step 1: Inbound Call ──────────────────────────────────────────

  console.log('\n── 📞 Inbound Call ─────────────────────────────────')
  console.log('  Caller: Maria Garcia (555-0142)')
  console.log('  Duration: 4m 32s\n')

  const goal1 = await graph.addObject({
    type: 'goal',
    data: { text: 'Handle inbound call from Maria Garcia' },
  })

  const call = await graph.addObject({
    type: 'call_recording',
    data: {
      callerId: '555-0142',
      callerName: 'Maria Garcia',
      direction: 'inbound',
      duration: 272,
      provider: 'vapi',
      status: 'completed',
    },
  })
  await graph.addRelation(goal1.id, call.id, 'triggered')
  console.log(`  + Call recording (${call.data.duration}s, Vapi)`)

  const transcript = await graph.addObject({
    type: 'call_transcript',
    data: {
      text: 'Hi, I need to file a claim. I had a car accident yesterday on Route 9. The other driver ran a red light. My policy is with Progressive, number PA-2026-88321.',
      detectedCarrier: 'Progressive',
      detectedClaimType: 'auto_collision',
      sentiment: 'stressed',
      confidence: 0.94,
    },
  })
  await graph.addRelation(goal1.id, transcript.id, 'produced')
  console.log(`  + Transcript analyzed (carrier: Progressive, type: auto collision)`)

  // ── Step 2: AI Chat — Intake Collection ───────────────────────────

  console.log('\n── 🤖 AI Chat — Intake Collection ─────────────────')

  const goal2 = await graph.addObject({
    type: 'goal',
    data: { text: 'Collect intake data for auto collision claim' },
  })

  const intake = await graph.addObject({
    type: 'intake_form',
    data: {
      customerName: 'Maria Garcia',
      phone: '555-0142',
      policyNumber: 'PA-2026-88321',
      carrier: 'Progressive',
      claimType: 'auto_collision',
      incidentDate: '2026-05-24',
      incidentLocation: 'Route 9, Northbound',
      description: 'Other driver ran red light, T-bone collision on driver side',
      injuries: 'Minor neck pain, going to doctor tomorrow',
      policeReport: true,
      policeReportNumber: 'NPD-2026-4421',
      tcpaConsent: true,
    },
  })
  await graph.addRelation(goal2.id, intake.id, 'produced')
  console.log(`  + Intake form: ${Object.keys(intake.data).length} fields collected`)
  console.log(`    Policy: ${intake.data.policyNumber}`)
  console.log(`    Carrier: ${intake.data.carrier}`)
  console.log(`    Type: ${intake.data.claimType}`)

  // AI decides how to route
  const routingDecision = await graph.recordDecision({
    selectedAction: 'file_via_carrier_portal',
    alternatives: [
      { action: 'call_carrier_hotline', rejected: 'Portal filing creates digital record and is faster' },
      { action: 'email_carrier', rejected: 'Auto claims require immediate FNOL filing' },
    ],
    confidence: 0.96,
    reasoning: 'Progressive auto collision. FNOL required within 24h. Portal procedure available (7 steps, verified Mar 2026). Filing via ForAgentsOnly.com.',
  })
  console.log(`  + Decision: ${routingDecision.selectedAction} (confidence: ${routingDecision.confidence})`)

  // ── Step 3: Browser Task — Carrier Portal Filing ──────────────────

  console.log('\n── 🌐 Browser Task — Progressive Portal ───────────')
  console.log('  Target: ForAgentsOnly.com')
  console.log('  Procedure: Progressive Auto Claim Filing (7 steps)\n')

  const goal3 = await graph.addObject({
    type: 'goal',
    data: { text: 'File FNOL on Progressive portal for Maria Garcia' },
  })

  // Browser task starts
  const browserTask = await graph.addObject({
    type: 'browser_task',
    data: {
      engine: 'minicor',
      target: 'https://foragentsonly.progressive.com',
      procedure: 'Progressive Auto Claim Filing',
      status: 'running',
      steps: [
        'Login with agency credentials',
        'Click Claims in LEFT sidebar',
        'Click "Report New Claim"',
        'Enter policy number PA-2026-88321',
        'Complete accident details wizard (4 pages)',
        'Auto-assign adjuster (claim < $5k threshold TBD)',
        'Download claim receipt PDF',
      ],
    },
  })
  await graph.addRelation(goal3.id, browserTask.id, 'triggered')
  console.log(`  + Browser task started (${(browserTask.data.steps as unknown[]).length} steps, Minicor engine)`)

  // Simulate step-by-step progress
  const stepResults = [
    { step: 'Login', status: 'success', duration: 3200 },
    { step: 'Navigate to Claims', status: 'success', duration: 1800 },
    { step: 'Report New Claim', status: 'success', duration: 900 },
    { step: 'Enter policy number', status: 'success', duration: 2100 },
    { step: 'Complete wizard (4 pages)', status: 'success', duration: 12400 },
    { step: 'Auto-assign adjuster', status: 'success', duration: 1500 },
    { step: 'Download receipt PDF', status: 'success', duration: 2800 },
  ]

  for (const result of stepResults) {
    const emoji = result.status === 'success' ? '✓' : '✗'
    console.log(`    ${emoji} ${result.step} (${(result.duration / 1000).toFixed(1)}s)`)
  }

  // Browser task completes
  const taskResult = await graph.addObject({
    type: 'browser_task_result',
    data: {
      task: 'File FNOL on Progressive portal',
      status: 'success',
      confirmationNumber: 'PRG-2026-FNOL-88321',
      totalDuration: stepResults.reduce((sum, s) => sum + s.duration, 0),
      stepsCompleted: 7,
      stepsFailed: 0,
      receiptPdf: '/tmp/progressive-receipt-PRG-2026-FNOL-88321.pdf',
    },
  })
  await graph.addRelation(goal3.id, taskResult.id, 'produced')
  console.log(`\n  ✅ Claim filed: ${taskResult.data.confirmationNumber}`)
  console.log(`     Total time: ${((taskResult.data.totalDuration as number) / 1000).toFixed(1)}s`)

  // ── Step 4: Post-Filing — Update AMS ──────────────────────────────

  console.log('\n── 📝 Post-Filing — Update AMS ────────────────────')

  const goal4 = await graph.addObject({
    type: 'goal',
    data: { text: 'Update AMS with claim confirmation and attach receipt' },
  })

  const amsUpdate = await graph.addObject({
    type: 'browser_task',
    data: {
      engine: 'minicor',
      target: 'HawkSoft AMS',
      procedure: 'Attach claim to customer record',
      status: 'completed',
    },
  })
  await graph.addRelation(goal4.id, amsUpdate.id, 'triggered')

  const amsResult = await graph.addObject({
    type: 'browser_task_result',
    data: {
      task: 'Update AMS with claim confirmation',
      status: 'success',
      note: 'Claim PRG-2026-FNOL-88321 attached to Maria Garcia record in HawkSoft',
    },
  })
  await graph.addRelation(goal4.id, amsResult.id, 'produced')
  console.log(`  + AMS updated: claim attached to customer record`)

  // ── Step 5: Notify Agent ──────────────────────────────────────────

  console.log('\n── 📨 Notification ─────────────────────────────────')

  const goal5 = await graph.addObject({
    type: 'goal',
    data: { text: 'Notify assigned agent about new claim' },
  })

  const notification = await graph.addObject({
    type: 'notification',
    data: {
      channel: 'email',
      to: 'sarah@acmeinsurance.com',
      subject: 'New auto claim filed: Maria Garcia (PRG-2026-FNOL-88321)',
      body: 'FNOL filed on Progressive portal. Receipt attached. Customer reports minor neck pain — follow up recommended.',
      sent: true,
    },
  })
  await graph.addRelation(goal5.id, notification.id, 'produced')
  console.log(`  + Email sent to sarah@acmeinsurance.com`)

  // ── Trace ─────────────────────────────────────────────────────────

  console.log('\n── Event Trace ─────────────────────────────────────')

  const events = await storage.queryEvents(graph.id, {})
  console.log(`  ${events.length} events in session\n`)

  // Print condensed trace like ActiveGraph
  for (const event of events.slice(0, 20)) {
    const ts = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false })
    const actor = event.actor ?? 'runtime'
    console.log(`  [${ts}] ${event.type.padEnd(20)} ${actor}`)
  }
  if (events.length > 20) {
    console.log(`  ... and ${events.length - 20} more events`)
  }

  // ── ASCII Graph ───────────────────────────────────────────────────

  console.log('\n── Graph Summary ───────────────────────────────────')

  const objects = await storage.queryObjects(graph.id, {})
  const relations = await storage.queryRelations(graph.id, {})

  const byType: Record<string, number> = {}
  for (const obj of objects) {
    byType[obj.type] = (byType[obj.type] ?? 0) + 1
  }

  console.log(`  ${objects.length} objects, ${relations.length} relations\n`)
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${count.toString().padStart(3)} ${type}`)
  }

  // ── Open Visual Graph ─────────────────────────────────────────────

  console.log('\n── Opening Visual Graph ────────────────────────────')

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
    title: 'Call Session: Maria Garcia — Auto Collision FNOL',
  })

  const outputPath = join(tmpdir(), 'operad-call-session-demo.html')
  writeFileSync(outputPath, html, 'utf-8')
  console.log(`  Wrote ${outputPath}`)

  // Auto-open in browser
  try {
    const cmd = platform() === 'darwin' ? 'open' : 'xdg-open'
    execSync(`${cmd} "${outputPath}"`, { stdio: 'ignore' })
    console.log('  Opened in browser\n')
  } catch {
    console.log(`  Open manually: ${outputPath}\n`)
  }

  console.log('─'.repeat(60))
  console.log('◆ Full session: call → intake → carrier portal → AMS → notify')
  console.log('  Every step is event-sourced. Every decision has an audit trail.')
  console.log('  Click goals in the left panel to explore the dependency tree.\n')
}

main().catch(console.error)
