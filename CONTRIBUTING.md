# Contributing to Operad

Thanks for your interest in contributing! Operad is an open-source, MIT-licensed project and we welcome contributions of all kinds.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/operadhq/operad.git
cd operad/typescript

# Install dependencies (requires pnpm 9+)
pnpm install

# Build all packages
pnpm build

# Run tests (69 core + 12 know = 81 total)
pnpm test
```

**Requirements:** Node.js >= 18, pnpm >= 9.15.0

## Project Structure

```
typescript/
├── packages/
│   ├── core/              # Runtime, graph, event log, behaviors, patterns, patches
│   ├── adapter-memory/    # In-memory StorageAdapter (dev/testing)
│   ├── adapter-postgres/  # PostgreSQL StorageAdapter (production)
│   ├── server/            # REST API (Hono) + CLI + Dashboard
│   ├── know/              # Knowledge extraction from documents
│   └── tsconfig/          # Shared TypeScript configs
├── apps/
│   ├── example/           # Demo applications (6 scenarios)
│   └── blog/              # operad.dev (Astro)
├── pnpm-workspace.yaml
└── turbo.json             # Build orchestration
```

## Architecture

**Core** defines the primitives: Graph (objects + relations), EventLog (immutable events with causal chains), Behaviors (reactive subscriptions), Decisions (recorded choices), Health (staleness tracking), Patterns (Cypher-subset queries), and Patches (governance gates).

**StorageAdapter** is the abstraction boundary. All persistence goes through this interface. Core never touches a database directly.

**Server** wraps core in a Hono REST API and provides the `operad` CLI with 15+ subcommands including ASCII graph visualization.

## How to Add a New Adapter

Implement the `StorageAdapter` interface from `@operad/core`:

```typescript
import type { StorageAdapter } from '@operad/core'

export class SQLiteAdapter implements StorageAdapter {
  async addObject(graphId, obj, eventId) { /* ... */ }
  async getObject(id) { /* ... */ }
  async patchObject(id, data, eventId) { /* ... */ }
  async removeObject(id) { /* ... */ }
  async queryObjects(graphId, filter) { /* ... */ }
  async addRelation(graphId, rel, eventId) { /* ... */ }
  async getRelation(id) { /* ... */ }
  async removeRelation(id) { /* ... */ }
  async queryRelations(graphId, filter) { /* ... */ }
  async appendEvent(graphId, event) { /* ... */ }
  async queryEvents(graphId, filter) { /* ... */ }
  async getEventChain(eventId) { /* ... */ }
  async getEventsTriggeredBy(eventId) { /* ... */ }
  async recordDecision(graphId, eventId, decision) { /* ... */ }
  async queryDecisions(graphId, filter) { /* ... */ }
  async updateHealth(objectId, update) { /* ... */ }
  async getStaleObjects(graphId, thresholdDays) { /* ... */ }
  // Optional: copyEventsUpTo (for forking support)
}
```

Use `@operad/adapter-memory` as a reference implementation. Test against the core test suite by swapping the adapter.

## How to Add a Behavior

Behaviors are reactive subscriptions. Three types:

```typescript
import { behavior, relationBehavior, llmBehavior } from '@operad/core'

// Standard behavior — reacts to event types
const myBehavior = behavior({
  name: 'descriptive-name',
  on: ['object.created'],
  where: { 'payload.objectType': 'claim' }, // optional filter
  handler: async (event, graph, ctx) => { /* ... */ },
})

// Relation behavior — fires when related objects change
const relBehavior = relationBehavior({
  name: 'check-deps',
  relationType: 'depends_on',
  on: ['object.patched'],
  handler: async (relation, event, graph, ctx) => { /* ... */ },
})

// LLM behavior — calls an LLM with scoped context
const llmBeh = llmBehavior({
  name: 'analyzer',
  on: ['custom.analyze'],
  model: 'claude-sonnet',
  prompt: (event, view) => `Analyze: ${JSON.stringify(view?.objects())}`,
  onResponse: async (text, event, graph, ctx) => { /* ... */ },
}, llmProvider)
```

## Code Style

- **TypeScript strict mode** — No `any` unless annotated with `eslint-disable`
- **Zero external deps in core** — Core must stay dependency-free
- **ESM + CJS dual output** — All packages ship both formats via tsup
- **MIT license** — All contributions must be compatible

## Pull Request Process

1. **Fork** the repository
2. **Branch** from `main` (`feature/my-feature` or `fix/my-fix`)
3. **Write code** — follow existing patterns
4. **Test** — `pnpm test` must pass
5. **Build** — `pnpm build` must succeed
6. **PR** — open against `main` with a clear description

## Issue Labels

| Label | Meaning |
|-------|---------|
| `good first issue` | Small, well-scoped tasks for new contributors |
| `help wanted` | Larger tasks where community help is welcome |
| `enhancement` | New feature requests |
| `bug` | Something isn't working as expected |

## Good First Issues

Looking for somewhere to start? These are well-scoped tasks:

- Add `--json` flag to CLI commands for machine-readable output
- Add `operad graph delete <id>` command
- Add `operad graph stats` command (count objects/relations/events)
- SQLite adapter (`@operad/adapter-sqlite`)
- Add `operad watch <graphId>` — live tail of events
- Add `operad export <graphId> --format dot` — Graphviz export

## Questions?

Open a [GitHub Discussion](https://github.com/operadhq/operad/discussions) or file an issue.
