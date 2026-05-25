# @operad/core

Event-sourced graph runtime for AI agents. Every mutation is an event. Every event has a cause. Every decision is recorded.

## Why

AI agents forget what they did, can't explain why, and don't self-correct. Operad fixes this with an event-sourced graph where every action produces an immutable event with causal chains, every decision records alternatives and confidence, and staleness detection keeps knowledge fresh.

## Quick Start

```bash
npm install @operad/core @operad/adapter-memory
```

```typescript
import { createRuntime, behavior } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

const runtime = createRuntime({
  storage: new MemoryAdapter(),
  behaviors: [
    behavior({
      name: 'log-claims',
      on: ['object.created'],
      handler: async (event, graph) => {
        console.log('New object:', event.payload)
      },
    }),
  ],
})

const graph = await runtime.createGraph('my-agent')
await graph.addObject({ type: 'claim', data: { amount: 5000 } })
```

## Try the demo

```bash
npx @operad/server demo primitives
```

## Core Primitives

| Primitive | What it does |
|-----------|-------------|
| **Graph** | Objects (nodes) + relations (edges) with typed data |
| **Event Log** | Immutable, append-only with causal chains (`causedBy`) |
| **Behaviors** | Reactive subscriptions — fire when events match |
| **Decisions** | Recorded choices with alternatives and confidence scores |
| **Health** | Staleness tracking — know when knowledge is stale |
| **Patterns** | Cypher-subset queries — find structures in the graph |
| **Patches** | Governance gates — propose changes, require human approval |

## Storage Adapters

- [`@operad/adapter-memory`](https://www.npmjs.com/package/@operad/adapter-memory) — In-memory (dev/test)
- [`@operad/adapter-postgres`](https://www.npmjs.com/package/@operad/adapter-postgres) — PostgreSQL (production)

## Links

- [GitHub](https://github.com/operadhq/operad)
- [Blog](https://operad.dev)
- [Getting Started](https://operad.dev/blog/getting-started)

## License

MIT
