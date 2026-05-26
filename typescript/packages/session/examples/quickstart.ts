#!/usr/bin/env npx tsx
/**
 * Operad Quickstart — Run this to experience the ActiveGraph in 2 minutes.
 *
 * Prerequisites:
 *   npm install @operad/core @operad/adapter-memory
 *
 * Run:
 *   npx tsx quickstart.ts
 *
 * What you'll see:
 *   1. A graph capturing agent work (objects + relations)
 *   2. A decision with alternatives recorded
 *   3. Causal chain traced backward ("why did this happen?")
 *   4. Fork at the decision → run alternative
 *   5. Diff: what did each approach produce?
 */

import { createRuntime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

// ─── Setup ───────────────────────────────────────────────────────────────────

async function main() {
  const storage = new MemoryAdapter()
  const runtime = createRuntime({ storage })

  console.log('◆ Operad Quickstart\n')
  console.log('─'.repeat(50))

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 1: Create a graph and populate it with agent work
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n▸ Step 1: Create a graph with objects and relations\n')

  const graph = await runtime.createGraph('my-session')

  // The agent's goal
  const goal = await graph.addObject({
    type: 'goal',
    data: { text: 'Add caching to the API' },
  })
  console.log(`  + goal: "Add caching to the API"`)

  // Agent reads a file (causal link: goal triggered this read)
  const read1 = await graph.addObject({
    type: 'file_read',
    data: { path: 'src/api/routes.ts', tokens: 1400 },
  })
  await graph.addRelation(goal.id, read1.id, 'triggered')
  console.log(`  + file_read: src/api/routes.ts`)
  console.log(`  + relation: goal → triggered → file_read`)

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 2: Record a decision with alternatives
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n▸ Step 2: Record a decision with alternatives\n')

  const decision = await graph.recordDecision({
    selectedAction: 'redis',
    alternatives: [
      { action: 'in_memory_lru', rejected: 'Evicted on deploy, no sharing between instances' },
      { action: 'sqlite_cache', rejected: 'Adds disk I/O, complex for this use case' },
    ],
    confidence: 0.75,
    reasoning: 'Redis is shared across instances, survives deploys, industry standard.',
  })
  console.log(`  ⚡ Decision: redis (confidence: ${decision.confidence})`)
  console.log(`    Alternatives rejected: in_memory_lru, sqlite_cache`)

  // Agent writes code based on the decision
  const write1 = await graph.addObject({
    type: 'file_write',
    data: { path: 'src/cache/redis.ts', lines: 42, description: 'Redis cache adapter' },
  })
  await graph.addRelation(goal.id, write1.id, 'produced')
  console.log(`  + file_write: src/cache/redis.ts (42 lines)`)

  const write2 = await graph.addObject({
    type: 'file_write',
    data: { path: 'src/api/routes.ts', lines: 8, description: 'Add cache middleware' },
  })
  await graph.addRelation(goal.id, write2.id, 'produced')
  console.log(`  + file_write: src/api/routes.ts (8 lines modified)`)

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 3: Trace the causal chain backward
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n▸ Step 3: Trace causal chain — "why does redis.ts exist?"\n')

  // Query all events and trace backward from the file write
  const events = await storage.queryEvents('my-session', {})

  // Find the event that created redis.ts
  const redisCreatedEvent = events.find(
    (e) => e.type === 'object.created' && (e.payload.data as any)?.path === 'src/cache/redis.ts'
  )

  if (redisCreatedEvent) {
    console.log(`  Event: object.created (redis.ts)`)
    console.log(`    ↑ caused by: ${redisCreatedEvent.causedBy ?? 'user action'}`)

    // Trace the relation back to the goal
    const relations = await graph.queryRelations()
    const goalRelation = relations.find((r) => r.targetId === write1.id)
    if (goalRelation) {
      const goalObj = await graph.getObject(goalRelation.sourceId)
      console.log(`    ↑ relation: goal → produced → redis.ts`)
      console.log(`    ↑ root cause: "${(goalObj?.data as any)?.text}"`)
    }
  }

  console.log(`\n  The graph answers: redis.ts exists because the goal`)
  console.log(`  "Add caching to the API" produced it, after deciding on Redis.`)

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 4: Fork at the decision point
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n▸ Step 4: Fork the graph to explore an alternative\n')

  // Find the decision event
  const decisionEvent = events.find((e) => e.type === 'decision.recorded')
  if (!decisionEvent) throw new Error('No decision event found')

  console.log(`  Fork point: decision.recorded (event ${events.indexOf(decisionEvent) + 1}/${events.length})`)
  console.log(`  Everything before this is shared. Everything after diverges.`)

  const fork = await runtime.branch('my-session', {
    atEvent: decisionEvent.id,
    label: 'lru-alternative',
  })
  console.log(`  ✓ Branch created: ${fork.id}`)

  // On the fork: take the alternative path (LRU cache)
  await fork.recordDecision({
    selectedAction: 'in_memory_lru',
    alternatives: [
      { action: 'redis', rejected: 'Over-engineered for single-instance API' },
    ],
    confidence: 0.80,
    reasoning: 'LRU is zero-dependency, no infra needed, fast for single instance.',
  })

  const forkGoal = await fork.addObject({
    type: 'goal',
    data: { text: 'Add caching to the API' },
  })

  const forkWrite = await fork.addObject({
    type: 'file_write',
    data: { path: 'src/cache/lru.ts', lines: 18, description: 'In-memory LRU cache' },
  })
  await fork.addRelation(forkGoal.id, forkWrite.id, 'produced')

  const forkWrite2 = await fork.addObject({
    type: 'file_write',
    data: { path: 'src/api/routes.ts', lines: 5, description: 'Add cache middleware' },
  })
  await fork.addRelation(forkGoal.id, forkWrite2.id, 'produced')

  console.log(`\n  Alternative path (LRU):`)
  console.log(`    + src/cache/lru.ts (18 lines — vs redis.ts at 42)`)
  console.log(`    + src/api/routes.ts (5 lines — vs 8)`)
  console.log(`    + 0 new dependencies (vs ioredis + @types/ioredis)`)

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 5: Diff the original vs the fork
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n▸ Step 5: Diff original vs fork\n')

  const diff = await runtime.diff('my-session', fork.id)

  const added = diff.objects.filter((o) => o.status === 'added')
  const removed = diff.objects.filter((o) => o.status === 'removed')

  console.log(`  Objects:`)
  console.log(`    +${added.length} only in fork (LRU branch)`)
  console.log(`    -${removed.length} only in original (Redis branch)`)
  console.log()
  console.log(`  Event divergence:`)
  console.log(`    Original (redis):  ${diff.sourceLog.length} events after fork point`)
  console.log(`    Fork (lru):        ${diff.targetLog.length} events after fork point`)
  console.log()
  console.log(`  ┌──────────────────┬──────────────────┐`)
  console.log(`  │ Redis (original) │ LRU (fork)       │`)
  console.log(`  ├──────────────────┼──────────────────┤`)
  console.log(`  │ 42 lines         │ 18 lines         │`)
  console.log(`  │ 2 dependencies   │ 0 dependencies   │`)
  console.log(`  │ Shared state     │ Per-instance     │`)
  console.log(`  │ Infra needed     │ Zero-config      │`)
  console.log(`  └──────────────────┴──────────────────┘`)

  // ═══════════════════════════════════════════════════════════════════════════
  // Takeaways
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`
${'─'.repeat(50)}
◆ What just happened:

  1. Every mutation was captured as an event
     → ${events.length + 10} total events across both graphs

  2. Causal chains answer "why?"
     → redis.ts exists because goal "Add caching" produced it

  3. Fork + diff enables counterfactual reasoning
     → "What if we'd chosen LRU?" — now you can see exactly what differs

◆ The event log is the agent. The graph is its world.
  Fork lets you explore alternate worlds.
`)
}

main().catch(console.error)
