# Operad

**Event-sourced graph runtime for AI agents.**

Every mutation is an event. Every event has a cause. Every decision is recorded.
Your agent remembers, explains, and self-corrects.

```
npm install @operad/core @operad/adapter-memory
```

---

## Why Operad exists

AI agents today are stateless. They process a prompt, produce an output, and forget everything. If you ask an agent *why* it made a decision, it can't tell you. If it learns something important mid-conversation, that knowledge dies when the session ends.

This is a real problem. Insurance adjusters need audit trails. Healthcare agents need provenance. Compliance teams need to trace every automated decision back to its source. And developers building multi-step agents need their bots to *remember* what happened three steps ago — and react when something goes wrong.

We built Operad because we were building AI voice agents for insurance agencies and hit this wall ourselves. Our agents needed to:

- Remember facts across conversations (a customer's policy type, their claim history)
- Explain why they approved or denied a claim (full causal chain, not a vague summary)
- React to failures automatically (if a data lookup fails, retry with a different strategy)
- Track what's still accurate and what's gone stale (is this phone number from 6 months ago still valid?)

No TypeScript library did all of this. So we built one.

## Inspiration

Operad is inspired by [ActiveGraph](https://github.com/SynapticSage/ActiveGraph) — a Python library that proves the pattern of event-sourced knowledge graphs for agent state. ActiveGraph showed that treating agent memory as a graph with causal event chains is the right abstraction. Operad brings this pattern to the TypeScript ecosystem, where most production AI agents actually run.

The name comes from mathematics. An **operad** is a structure in category theory for composing operations — small pieces combine into larger, coherent wholes. Agent memory works the same way: events compose into causal chains, facts compose into knowledge graphs, and behaviors compose into reactive systems. Operad (the library) embodies this: objects are created during agent runs, composed through relations, traced during audits, verified for freshness, and flagged when stale.

We also drew from academic work on agent provenance:
- **PROV-AGENT** (IEEE 2025) — formalizing provenance tracking for autonomous agents
- **Oracle Reasoning Provenance** (2026) — causal chain verification for AI decision-making

And from the market: [Mem0](https://mem0.ai) raised $24M proving that agent memory is a real product category. Operad is the open-source, TypeScript-native alternative — no vendor lock-in, no cloud dependency, runs anywhere Node.js runs.

## Core concepts

Operad has 5 primitives. Together they give your agent persistent memory with full provenance.

### 1. Graph — what the agent knows

A graph holds **objects** (nodes) and **relations** (typed edges). Think of it as the agent's working memory.

```typescript
import { createRuntime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

const storage = new MemoryAdapter()
const runtime = createRuntime({ storage })
const graph = await runtime.createGraph('customer-jane')

// Add things the agent knows
const claim = await graph.addObject({
  type: 'claim',
  data: { policy: 'HO-3-12345', type: 'water_damage', status: 'open' }
})

const evidence = await graph.addObject({
  type: 'evidence',
  data: { source: 'call_transcript', text: 'Customer reported burst pipe on Jan 15' }
})

// Connect them
await graph.addRelation(evidence.id, claim.id, 'supports')

// Query later
const openClaims = await graph.queryObjects({ type: 'claim', dataMatch: { status: 'open' } })
```

### 2. Event log — what happened and why

Every mutation in the graph produces an immutable event. Events form **causal chains** through `caused_by` references — you can trace any state back to its origin.

```typescript
// Trace backward: why does this claim exist?
const chain = await graph.traceBackward(claim.createdByEventId)
// → [
//     { type: 'object.created', payload: { objectType: 'claim', ... } },
//     { type: 'graph.created', payload: { graphId: 'customer-jane' } }
//   ]

// Trace forward: what happened because of this event?
const effects = await graph.traceForward(someEventId)
```

This is the audit trail. When a regulator asks "why did the AI approve this claim?", you can show the exact chain of events — not a reconstructed explanation, but the actual execution trace.

### 3. Behaviors — how the agent reacts

Behaviors are functions that subscribe to event types. When a matching event is emitted, the behavior fires. Behaviors can mutate the graph and emit new events, creating reactive chains.

```typescript
import { behavior } from '@operad/core'

const autoTag = behavior({
  name: 'auto-tag-high-value',
  on: ['object.created'],
  where: { 'payload.objectType': 'claim' },
  handler: async (event, graph, ctx) => {
    const claimData = event.payload.data as Record<string, unknown>
    if (claimData.estimatedValue > 50000) {
      await graph.addObject({
        type: 'tag',
        data: { label: 'high-value', claimId: event.payload.objectId }
      })
    }
  }
})

const runtime = createRuntime({
  storage,
  behaviors: [autoTag]
})
```

Behaviors can also react to other behaviors' failures:

```typescript
const retryOnFailure = behavior({
  name: 'retry-on-selector-fail',
  on: ['behavior.failed'],
  where: { 'payload.reason': 'selector_not_found' },
  handler: async (event, graph, ctx) => {
    // A behavior failed because a UI selector wasn't found.
    // Log it and try an alternative approach.
    await graph.addObject({
      type: 'retry_attempt',
      data: { originalBehavior: event.payload.behaviorName, strategy: 'fallback' }
    })
  }
})
```

### 4. Decisions — what was chosen and what was rejected

Agents make choices. Operad records not just what was selected, but what alternatives were considered and why they were rejected. This is critical for explainability.

```typescript
await graph.recordDecision({
  selectedAction: 'approve_claim',
  alternatives: [
    { action: 'escalate_to_human', rejected: 'confidence > 0.9, no escalation needed' },
    { action: 'deny_claim', rejected: 'evidence from transcript supports coverage' }
  ],
  confidence: 0.92,
  reasoning: 'Policy HO-3 covers water damage. Transcript confirms burst pipe incident. Claim amount within policy limits.'
})

// Query past decisions
const highConfidence = await graph.queryDecisions({ minConfidence: 0.9 })
```

### 5. Health — what's still accurate

Facts go stale. A phone number from 6 months ago might be wrong. A policy might have been renewed with different terms. Operad tracks when objects were last verified and flags stale ones.

```typescript
// Find objects not verified in the last 30 days
const stale = await graph.getStaleObjects({ thresholdDays: 30 })
// → [{ type: 'contact_info', data: { phone: '555-0123' }, updatedAt: '2026-01-15' }]

// Your agent can re-verify or flag for human review
```

## Use cases

### AI agents that need memory across sessions

LangChain and Vercel AI SDK give you tool-calling and streaming. But when the session ends, the agent forgets everything. Operad is the persistent memory layer:

```typescript
// Session 1: Agent learns about customer
await graph.addObject({ type: 'preference', data: { channel: 'email', language: 'spanish' } })

// Session 2 (days later): Agent remembers
const prefs = await graph.queryObjects({ type: 'preference' })
// → [{ channel: 'email', language: 'spanish' }]
```

### Regulated industries needing audit trails

Insurance, healthcare, finance, legal — any domain where AI decisions must be explainable to regulators:

```
Q: "Why did the AI approve claim #4521?"

A: Here's the full causal chain:
   1. graph.created — agent started processing claim
   2. object.created — claim data ingested from intake form
   3. object.created — evidence extracted from call transcript
   4. relation.created — evidence linked to claim (type: 'supports')
   5. decision.recorded — selected 'approve' (confidence: 0.92)
      - rejected 'deny' because: evidence supports coverage
      - rejected 'escalate' because: confidence above threshold
```

### Multi-step workflows with self-healing

Agents that run multi-step processes (data extraction, form filling, API calls) need to handle failures gracefully. Behaviors let you build reactive error handling:

```
Event: behavior.failed (reason: "API timeout")
  → Behavior: retry-with-backoff fires
    → Event: custom.retry_scheduled
      → Behavior: execute-retry fires (after delay)
        → Event: behavior.completed
```

Every step is traced. You can see exactly where a workflow failed, what retry strategy kicked in, and whether it eventually succeeded.

### Knowledge graphs that stay fresh

CRMs, documentation systems, inventory trackers — any system where facts have a shelf life. Operad's health tracking surfaces stale data so your agent (or your team) can re-verify it.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Runtime                          │
│                                                     │
│   emit event ──→ match behaviors ──→ fire handlers  │
│       │                                    │        │
│       │              ┌─────────────┐       │        │
│       └──────────────│  Event Log  │←──────┘        │
│                      │ (append-only│                │
│                      │  caused_by) │                │
│                      └─────────────┘                │
│                            │                        │
│              ┌─────────────┼─────────────┐          │
│              ▼             ▼             ▼          │
│         ┌────────┐   ┌──────────┐  ┌────────┐      │
│         │ Graph  │   │Decisions │  │ Health │      │
│         │Objects │   │selected/ │  │stale/  │      │
│         │Relations│  │rejected  │  │verified│      │
│         └────────┘   └──────────┘  └────────┘      │
│                                                     │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────┴────────┐
              │ StorageAdapter  │  (plug in any backend)
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
     ┌────────┐  ┌──────────┐  ┌──────────┐
     │ Memory │  │  SQLite  │  │ Postgres │
     │ (dev)  │  │  (light) │  │  (prod)  │
     └────────┘  └──────────┘  └──────────┘
```

## Storage adapters

Operad is storage-agnostic. The `StorageAdapter` interface abstracts all persistence. Ship with the adapter that fits your use case:

| Adapter | Package | Best for |
|---------|---------|----------|
| In-memory | `@operad/adapter-memory` | Development, testing, short-lived processes |
| SQLite | `@operad/adapter-sqlite` *(coming soon)* | Single-server production, edge functions |
| Postgres | `@operad/adapter-postgres` *(coming soon)* | Multi-server production, cloud deployments |

### Writing a custom adapter

Implement the `StorageAdapter` interface to plug in any backend — Redis, DynamoDB, Turso, whatever you need:

```typescript
import type { StorageAdapter } from '@operad/core'

export class MyCustomAdapter implements StorageAdapter {
  async addObject(graphId, obj, eventId) { /* ... */ }
  async getObject(id) { /* ... */ }
  // ... implement all methods
}
```

## API reference

### `createRuntime(options)`

Creates the event loop that powers everything.

```typescript
const runtime = createRuntime({
  storage: new MemoryAdapter(),
  behaviors: [myBehavior, anotherBehavior]
})
```

### `runtime.createGraph(id)`

Creates a new named graph. Returns a `GraphAPI` instance.

### `runtime.emit(graphId, event)`

Emits a custom event that behaviors can react to.

```typescript
await runtime.emit('my-graph', {
  type: 'custom.user_action',
  payload: { action: 'clicked_approve' }
})
```

### `graph.addObject(input)` / `patchObject` / `removeObject`

CRUD operations on graph objects. Every mutation emits an event automatically.

### `graph.addRelation(sourceId, targetId, type)` / `removeRelation`

Create typed edges between objects.

### `graph.traceBackward(eventId)` / `traceForward(eventId)`

Walk the causal chain in either direction.

### `graph.recordDecision(input)`

Record what was selected, what was rejected, and why.

### `graph.getStaleObjects({ thresholdDays })`

Find objects that haven't been verified recently.

### `behavior(def)`

Create a behavior definition that reacts to events.

```typescript
const myBehavior = behavior({
  name: 'descriptive-name',
  on: ['object.created', 'object.patched'],  // event types to react to
  where: { 'payload.objectType': 'claim' },  // optional filter
  handler: async (event, graph, ctx) => {
    // React to the event
  }
})
```

## Comparison

| Feature | Operad | LangChain Memory | Mem0 | Neo4j |
|---------|--------|-----------------|------|-------|
| TypeScript-native | Yes | Python-first | Python-first | Java |
| Event sourcing | Yes | No | No | No |
| Causal chains | Yes | No | No | No |
| Decision records | Yes | No | No | No |
| Staleness tracking | Yes | No | No | No |
| Reactive behaviors | Yes | No | No | No |
| Storage-agnostic | Yes | Vector DB only | Proprietary | Neo4j only |
| Embeddable | Yes | Yes | Cloud SDK | Separate server |
| Open source | MIT | MIT | Closed | Community/Enterprise |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Packages

| Package | Description |
|---------|-------------|
| [`@operad/core`](./packages/core) | Runtime, graph, event log, behaviors, decisions, health |
| [`@operad/adapter-memory`](./packages/adapter-memory) | In-memory storage adapter for dev/testing |

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## License

[MIT](./LICENSE)
