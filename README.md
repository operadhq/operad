# Operad

**Event-sourced graph runtime for AI agents.**

Every mutation is an event. Every event has a cause. Every decision is recorded.

```bash
npx @operad/server demo primitives
```

```
◆ Operad — 7 New Primitives Demo

── 1. Actor Field ──────────────────────────────
  ✓ Created graph (actor: "user")
  + Claim 1: Water damage - basement
  + Claim 2: Water damage - kitchen

── Graph Visualization ─────────────────────────

  ╭─ ● claim ───────────────────────────────────────────╮
  │  claim-001                                           │
  │  title: "Water damage - basement"                    │
  │  amount: 35000                                       │
  │  status: "open"                                      │
  ├──────────────────────────────────────────────────────┤
  │  ├──▶ depends_on ── evidence:evidence-001             │
  │  └──▶ contradicts ── claim:claim-002                  │
  ╰──────────────────────────────────────────────────────╯
       │
       ▼
  ╭─ ● evidence ────────────────────────────────────────╮
  │  evidence-001                                        │
  │  title: "Plumber report"                             │
  │  confidence: 0.95                                    │
  │  verified: true                                      │
  ╰──────────────────────────────────────────────────────╯

◆ All 7 primitives exercised. Every action is event-sourced.
```

---

## Quick Start

**Try it (10 seconds):**
```bash
npx @operad/server demo primitives
```

**Build your own agent (5 minutes):**
```bash
npx @operad/server init my-agent
cd my-agent && npm install
npx tsx src/agent.ts
```

**Go to production (30 minutes):**
```bash
npm install @operad/core @operad/adapter-postgres
```

```typescript
import { createRuntime } from '@operad/core'
import { PostgresAdapter } from '@operad/adapter-postgres'

const runtime = createRuntime({
  storage: new PostgresAdapter({ connectionString: process.env.DATABASE_URL! }),
})
```

---

## Why

AI agents forget what they did, can't explain why, and don't self-correct.

| Problem | How Operad solves it |
|---------|---------------------|
| **Agents forget** | Every mutation is an immutable event. The graph persists across sessions. |
| **Can't explain decisions** | Causal chains trace any state back to its origin. Decision records capture alternatives and reasoning. |
| **Don't self-correct** | Behaviors react to events — including failures. Health tracking flags stale data. |

We built Operad while developing AI voice agents for insurance agencies. Our agents needed audit trails, cross-session memory, and regulatory compliance. No TypeScript library did all of this.

**Inspired by** [ActiveGraph](https://github.com/SynapticSage/ActiveGraph) (Python). Operad brings event-sourced knowledge graphs to the TypeScript ecosystem where most production AI agents actually run.

---

## 7 Primitives

### 1. Graph — what the agent knows

Objects (nodes) + relations (typed edges) = the agent's working memory.

```typescript
const graph = await runtime.createGraph('customer-jane')

const claim = await graph.addObject({
  type: 'claim',
  data: { policy: 'HO-3-12345', type: 'water_damage', status: 'open' },
})

const evidence = await graph.addObject({
  type: 'evidence',
  data: { source: 'call_transcript', text: 'Burst pipe on Jan 15' },
})

await graph.addRelation(evidence.id, claim.id, 'supports')
```

### 2. Event Log — what happened and why

Every mutation produces an immutable event with causal chains.

```typescript
const chain = await graph.traceBackward(claim.createdByEventId)
// → object.created → graph.created (full audit trail)
```

### 3. Behaviors — how the agent reacts

Reactive subscriptions that fire when matching events occur.

```typescript
import { behavior } from '@operad/core'

const autoTag = behavior({
  name: 'auto-tag-high-value',
  on: ['object.created'],
  where: { 'payload.objectType': 'claim' },
  handler: async (event, graph, ctx) => {
    const data = event.payload.data as Record<string, unknown>
    if ((data.amount as number) > 50000) {
      await graph.addObject({ type: 'tag', data: { label: 'high-value' } })
    }
  },
})
```

### 4. Decisions — what was chosen and rejected

Records the full decision context for explainability.

```typescript
await graph.recordDecision({
  selectedAction: 'approve_claim',
  alternatives: [
    { action: 'deny_claim', rejected: 'evidence supports coverage' },
    { action: 'escalate', rejected: 'confidence above threshold' },
  ],
  confidence: 0.92,
  reasoning: 'Policy covers water damage. Transcript confirms incident.',
})
```

### 5. Health — what's still accurate

Staleness tracking flags data that hasn't been verified recently.

```typescript
const stale = await graph.getStaleObjects({ thresholdDays: 30 })
```

### 6. Patches + Policies — governance gates

LLM proposes changes; humans approve or deny. Nothing happens without consent.

```typescript
await ctx.propose({
  type: 'flag',
  data: { reason: 'contradiction_detected' },
  reason: 'LLM found conflicting claims',
})

// Later:
await runtime.approve(patchId, 'admin-user')
```

### 7. Pattern Matching — structural queries

Find structures in the graph using a Cypher-subset syntax.

```typescript
import { parsePattern, matchPattern } from '@operad/core'

const parsed = parsePattern('(a:claim)-[:contradicts]->(b:claim)')
const matches = await matchPattern(parsed, graph)
```

---

## CLI

The `operad` CLI provides full graph inspection without a browser.

```bash
operad demo primitives              # Run the full demo
operad init my-agent                # Scaffold a new project
operad graph inspect my-graph       # ASCII visualization + tables
operad graph events my-graph        # Event timeline
operad match my-graph "(a:claim)-[:supports]->(b:evidence)"
operad patches my-graph             # Pending governance patches
operad approve <patchId>            # Human-in-the-loop approval
operad serve --port 3111            # Start REST API server
```

---

## Comparison

| Feature | Operad | LangChain Memory | Mem0 | Neo4j | LangGraph |
|---------|--------|-----------------|------|-------|-----------|
| TypeScript-native | Yes | Python-first | Python-first | Java | Python-first |
| Event sourcing | Yes | No | No | No | No |
| Causal chains | Yes | No | No | No | Partial |
| Decision records | Yes | No | No | No | No |
| Staleness tracking | Yes | No | No | No | No |
| Reactive behaviors | Yes | No | No | No | Yes |
| Governance (patches) | Yes | No | No | No | No |
| Pattern matching | Yes | No | No | Cypher | No |
| Storage-agnostic | Yes | Vector DB | Proprietary | Neo4j | Checkpointer |
| Open source | MIT | MIT | Closed | Community/Enterprise | MIT |

---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│                       Runtime                          │
│                                                       │
│   emit event ──→ match behaviors ──→ fire handlers    │
│       │                                    │          │
│       │              ┌─────────────┐       │          │
│       └──────────────│  Event Log  │←──────┘          │
│                      │ (immutable, │                  │
│                      │  causedBy)  │                  │
│                      └─────────────┘                  │
│                            │                          │
│              ┌─────────────┼─────────────┐            │
│              ▼             ▼             ▼            │
│         ┌────────┐   ┌──────────┐  ┌────────┐        │
│         │ Graph  │   │Decisions │  │ Health │        │
│         │Objects │   │selected/ │  │stale/  │        │
│         │Relations│  │rejected  │  │verified│        │
│         └────────┘   └──────────┘  └────────┘        │
│                                                       │
└───────────────────────┬───────────────────────────────┘
                        │
               ┌────────┴────────┐
               │ StorageAdapter  │
               └────────┬────────┘
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
      ┌────────┐  ┌──────────┐  ┌──────────┐
      │ Memory │  │  SQLite  │  │ Postgres │
      │ (dev)  │  │  (soon)  │  │  (prod)  │
      └────────┘  └──────────┘  └──────────┘
```

---

## Session — Git for AI Coding Sessions

Import Claude Code (or Codex, OpenCode) sessions into the event graph. Analyze, fork, and compare.

```bash
# Import a session
operad-session commit ~/.claude/projects/myapp/session.jsonl

# See what happened
operad-session log --graph session_123
operad-session blame --graph session_123

# Fork at a decision and try something different
operad-session fork --graph session_123 --at-event evt_5 \
  --run "Use session cookies instead of JWT" \
  --model claude-sonnet-4 --max-budget 3.00

# Compare the two approaches
operad-session diff session_123 session_123_fork
```

The full git vocabulary: `commit`, `log`, `blame`, `stash`, `diff`, `fork`, `revert`, `replay`, `explore`, `view`.

See [`@operad/session` README](./typescript/packages/session/README.md) for details.

---

## Transactional Execution

Operad isn't just a log viewer. Effects are categorized, changes are governed, and speculation is isolated.

| Capability | How it works |
|---|---|
| **Effect categories** | Tools classified as `pure` / `bufferable` / `externalized` |
| **Governance** | `propose()` → pending patch → `approve()` or `deny()` |
| **Parallel speculation** | `explore()` — fork N branches, score, pick winner |
| **Compensation** | `revert()` with Saga-style reversal handlers |
| **Causal tracing** | `traceBackward()` from any event to its root cause |

Inspired by [Atomix](https://arxiv.org/abs/2602.14849). See [`docs/PHILOSOPHY.md`](./docs/PHILOSOPHY.md) for the full design rationale.

---

## Packages

| Package | Description |
|---------|-------------|
| [`@operad/core`](./typescript/packages/core) | Runtime, graph, event log, behaviors, decisions, health, patterns, patches, effects |
| [`@operad/session`](./typescript/packages/session) | JSONL importer + git-like CLI for agent sessions (fork, diff, blame, explore) |
| [`@operad/adapter-memory`](./typescript/packages/adapter-memory) | In-memory storage (dev/testing) |
| [`@operad/adapter-sqlite`](./typescript/packages/adapter-sqlite) | SQLite storage (lightweight production) |
| [`@operad/adapter-postgres`](./typescript/packages/adapter-postgres) | PostgreSQL storage (production) |
| [`@operad/server`](./typescript/packages/server) | REST API + CLI + Dashboard |
| [`@operad/know`](./typescript/packages/know) | Knowledge extraction from documents |

---

## Demos

Run any demo to see the primitives in action:

```bash
cd typescript/apps/example

pnpm demo:quickstart       # Core primitives in 2 minutes (graph, decisions, fork, diff)
pnpm demo:transactional    # Atomix-style: effect categories, governance, parallel speculation
pnpm demo:fork             # Fork at a decision, simulate alternative, diff results
pnpm demo:primitives       # All 7 primitives (actors, relations, views, LLM, patterns, patches)
```

See [`examples/`](./typescript/packages/session/examples/) for use-case workflows:
- [Fork and compare two approaches](./typescript/packages/session/examples/fork-and-compare.sh)
- [Understand your AI spend](./typescript/packages/session/examples/cost-analysis.sh)
- [Explore multiple alternatives](./typescript/packages/session/examples/explore-alternatives.sh)
- [Debug an expensive session](./typescript/packages/session/examples/session-forensics.sh)

---

## Use Cases

- **AI coding agents** — Fork at decisions, compare approaches, track cost per goal
- **Insurance** — Audit trails for claim decisions, cross-session customer memory
- **Healthcare** — Provenance tracking for AI diagnostic recommendations
- **Finance** — Regulatory compliance with full causal chain evidence
- **Multi-step agents** — Self-healing workflows with reactive error handling

---

## Research Foundations

| Paper | Primitive | arXiv |
|-------|-----------|-------|
| **Atomix** — Transactional Tool Calls | Effect categories, compensation, speculation isolation | [2602.14849](https://arxiv.org/abs/2602.14849) |
| **ESAA** — Event Sourcing as Agent Architecture | Event sourcing as native agent design | [2602.23193](https://arxiv.org/abs/2602.23193) |
| **AgentGit** — Version Control for Agent Execution | Git semantics for agent traces | [2511.00628](https://arxiv.org/abs/2511.00628) |
| **Fork, Explore, Commit** — OS Primitives for Agents | Fork/explore/commit for cognition | [2602.08199](https://arxiv.org/abs/2602.08199) |
| **ParallelMuse** — Parallel Thinking for Deep Research | Branch at uncertainty, explore N paths | [2510.24698](https://arxiv.org/abs/2510.24698) |

Each validates one primitive in isolation. Operad unifies them into a single TypeScript runtime.

---

## Development

```bash
cd typescript
pnpm install
pnpm build
pnpm -r test     # 66 session tests + 69 core tests
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, architecture, and how to add adapters/behaviors.

## License

[MIT](./LICENSE)
