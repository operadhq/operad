# Operad

**Event-sourced graph runtime for AI agents.**

Every mutation is an event. Every event has a cause. Every decision is recorded.

### Try it now

```bash
npx @operad/session demo coding --html
```

Opens an interactive timeline viewer in your browser — swim lanes, causal chains, and waterfall phases for a coding agent session.

**More demos:**

```bash
npx @operad/session demo hedge-fund --html         # Biotech screening, position sizing
npx @operad/session demo insurance --html           # Claims processing, fraud detection
npx @operad/session demo financial-analyst --html   # Revenue analysis, forecasting
npx @operad/session demo customer-support --html    # Debugging, post-mortems
npx @operad/session demo research-agent --html      # Literature survey, benchmarks
npx @operad/session demo primitives --html          # All 7 runtime primitives
```

---

## Quick Start

### A. You use a coding agent (Claude Code, Codex, OpenCode)

```bash
npm install @operad/session
```

Done. Every session is logged. See [Session](#session--see-what-your-ai-coding-agent-did) below.

### B. You're building an AI agent (finance, insurance, healthcare, etc.)

```bash
npm install @operad/core @operad/adapter-sqlite
```

```typescript
import { createRuntime } from '@operad/core'
import { SqliteAdapter } from '@operad/adapter-sqlite'

const runtime = createRuntime({ storage: new SqliteAdapter('./agent.db') })
const graph = await runtime.createGraph('portfolio-review')

// Your agent builds a knowledge graph as it works
const position = await graph.addObject({
  type: 'position',
  data: { ticker: 'AAPL', shares: 150, avgCost: 178.50 },
})

const signal = await graph.addObject({
  type: 'signal',
  data: { source: 'earnings_call', sentiment: 'bearish', confidence: 0.82 },
})

await graph.addRelation(signal.id, position.id, 'affects')

// Agent records its decision with full reasoning
await graph.recordDecision({
  selectedAction: 'reduce_position',
  alternatives: [
    { action: 'hold', rejected: 'bearish signal above confidence threshold' },
    { action: 'exit_fully', rejected: 'position still within risk tolerance' },
  ],
  confidence: 0.78,
  reasoning: 'Earnings miss + guidance cut. Reduce by 30% to manage downside.',
})

// Trace any decision back to its cause
const chain = await graph.traceBackward(position.createdByEventId)
// → object.created → graph.created (full audit trail)
```

Every mutation is an event. Every decision is recorded with alternatives and reasoning. Regulators, compliance teams, and future-you can trace any action back to its root cause.

```bash
# Inspect what the agent did
npx operad graph inspect portfolio-review

# See all decisions and their reasoning
npx operad graph events portfolio-review
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
operad demo primitives              # Interactive walkthrough of all 7 primitives
operad demo                         # List available demos
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

## Session — See What Your AI Coding Agent Did

```bash
npm install @operad/session
```

Auto-configures for Claude Code, Codex, and OpenCode. After your session:

```bash
operad-session graph --graph <session-id>
```

```
╔══════════════════════════════════════════════════════════════════════╗
║  OPERAD EVENT GRAPH — session_a3f7c2d1                             ║
║  309 events │ 4 goals │ 87 tools │ $12.40 cost                    ║
╚══════════════════════════════════════════════════════════════════════╝

  ★ Goal #1: Fix the authentication bug in login flow
  │
  ├── ⚙ Tools: Read×5, Edit×1, Grep×2, Bash×1
  ├── Events: 24
  │
  ★ Goal #2: Refactor auth to use JWT instead of sessions
  │
  ├── ⚙ Tools: Read×12, Edit×6, Write×2, Bash×4
  ├── $ Cost: $8.20
  ├── Events: 63
  │
  ╰── ◉ Graph complete: 309 events
```

Every file read, every edit, every decision — the full trace of how your agent got there.

```bash
operad-session log --graph <id>        # Event trace
operad-session blame --graph <id>      # Cost per goal
operad-session stash --graph <id>      # Wasted work
operad-session fork --graph <id> \     # Try a different approach
  --at-event <evt> --run "Use cookies instead of JWT"
operad-session diff <id-a> <id-b>      # Compare two approaches
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
| [`@operad/session`](./typescript/packages/session) | Auto-tracking for coding agents (Claude, Codex, OpenCode) + git-like CLI (fork, diff, blame) |
| [`@operad/adapter-memory`](./typescript/packages/adapter-memory) | In-memory storage (dev/testing) |
| [`@operad/adapter-sqlite`](./typescript/packages/adapter-sqlite) | SQLite storage (lightweight production) |
| [`@operad/adapter-postgres`](./typescript/packages/adapter-postgres) | PostgreSQL storage (production) |
| [`@operad/server`](./typescript/packages/server) | REST API + CLI + Dashboard |
| [`@operad/know`](./typescript/packages/know) | Knowledge extraction from documents |

---

## Demos

### Session demos (interactive timeline viewer)

```bash
operad-session demo coding --html            # Coding agent — JWT auth with thinking + tool use
operad-session demo financial-analyst --html  # SaaS revenue analysis and forecasting
operad-session demo insurance --html          # Claims processing with fraud detection
operad-session demo customer-support --html   # Debugging permissions, fixing code
operad-session demo hedge-fund --html         # Biotech screening and position sizing
operad-session demo research-agent --html     # RAG literature survey and benchmarks
operad-session demo primitives --html         # All 7 runtime primitives
```

Each opens an interactive HTML viewer with three timeline modes:
- **Swim Lanes** — events by actor with causal arrows crossing lanes
- **Causal Chain** — tree view (like `git log --graph` for agent cognition)
- **Waterfall** — phase gantt per goal (Thinking → Research → Implement → Verify)

### Runtime demos

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
- **Knowledge management** — Graphs that detect and flag stale data

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
