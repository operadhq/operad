[![CI](https://github.com/operadhq/operad/actions/workflows/ci.yml/badge.svg)](https://github.com/operadhq/operad/actions/workflows/ci.yml)

# Operad — Event-Sourced Graph Runtime for AI Agents

Every mutation is an event. Every event has a cause. Every decision is recorded.

Operad is the runtime agents **think with** — not infrastructure they run on (Temporal), and not dashboards they emit into (LangSmith). The event graph is the agent's working memory.

## Packages

| Package | Description |
|---------|-------------|
| `@operad/core` | Runtime engine: event loop, behaviors, causal chains, projections |
| `@operad/session` | JSONL importer — commit Claude Code sessions into the event graph |
| `@operad/adapter-memory` | In-memory storage adapter (dev/testing) |
| `@operad/adapter-sqlite` | SQLite storage adapter (lightweight production) |
| `@operad/adapter-postgres` | PostgreSQL storage adapter (full production) |
| `@operad/server` | HTTP server with graph inspection and demo commands |

## Quick Start

```bash
# Install
npm install @operad/session @operad/adapter-sqlite

# Commit a Claude Code session into the event graph
npx operad-session commit ~/.claude/projects/your-project/session.jsonl

# See what happened
npx operad-session log --graph <id>
npx operad-session blame --graph <id>
npx operad-session stash --graph <id>
```

### Programmatic API

```typescript
import { commit } from '@operad/session'
import { readFileSync } from 'node:fs'

const jsonlText = readFileSync('session.jsonl', 'utf-8')
const log = await commit(jsonlText)

console.log(`${log.goals} goals, $${log.blame.totalCost.toFixed(2)} spent`)
console.log(`${log.stash.redundantReads} redundant reads (~$${log.stash.potentialSavings.toFixed(2)} wasted)`)
```

### With persistent storage

```typescript
import { commit } from '@operad/session'
import { SqliteAdapter } from '@operad/adapter-sqlite'
import { createRuntime } from '@operad/core'

const storage = new SqliteAdapter('./operad.db')
const runtime = createRuntime({ storage })

const log = await commit(jsonlText, { storage, runtime, graphId: 'my-session' })
storage.close()
```

## The Git Vocabulary

Operad uses git-shaped semantics for agent cognition. These are real operations, not metaphors.

| Git | Operad | What it does |
|-----|--------|-------------|
| `git commit` | `operad-session commit` | Import a session as an immutable event graph |
| `git log` | `operad-session log` | Show the event timeline with causal links |
| `git blame` | `operad-session blame` | Cost attribution per goal/tool call |
| `git stash` | `operad-session stash` | Detect redundant/wasted work |
| `git revert` | `operad-session revert <id>` | Undo a decision via compensation events |
| `git branch` | `runtime.branch()` | Fork the graph at any decision point |
| `git checkout` | `runtime.checkout()` | Time-travel to a specific event |
| `git diff` | `operad-session diff` | Compare two session graphs structurally |
| — | `operad-session explore <id> -n 3` | Fork N alternatives, score, commit best |

## Fork + Run — Compare Agent Approaches

Fork a session at any decision point and run Claude with alternative instructions:

```bash
operad-session fork --graph session_123 --at-event evt_5 \
  --run "Use session cookies instead of JWT" \
  --model claude-sonnet-4 --max-budget 3.00
```

This spawns a real Claude CLI session on the forked branch, captures the JSONL, commits it to the fork graph, and auto-diffs the results. The workflow composes with `explore()` for plan-level speculation:

1. **Think** — `explore()` forks N branches in the graph, scores plans (cheap)
2. **Execute** — `fork --run` executes the best plan with real Claude sessions
3. **Compare** — `diff` shows what each approach produced

See [`@operad/session` README](./packages/session/README.md) and [`docs/PHILOSOPHY.md`](../docs/PHILOSOPHY.md).

## Demos

```bash
cd apps/example
pnpm demo:quickstart       # Core primitives in 2 minutes
pnpm demo:transactional    # Effect categories, governance, parallel speculation
pnpm demo:fork             # Fork + diff for what-if analysis
pnpm demo:primitives       # All 7 primitives
```

## Core Concepts

### Event Sourcing

State is never mutated directly. Every change is an immutable event appended to the log. Current state is a projection (fold) of all events.

### Causal Chains

Every event has a `causedBy` field pointing to its parent event. This creates a provenance graph — you can trace any state back to its origin.

### Behaviors

Reactive handlers that subscribe to event types. When a matching event is emitted, the behavior fires and can emit new events. Behaviors compose into self-correcting systems.

### Blame

Cost attribution that maps token usage back to goals. Know exactly which task consumed how many tokens and dollars.

### Stash (Waste Detection)

Identifies redundant work: files read multiple times without changes, tokens re-spent on cached content. Shows where money can be saved.

### Explore

Fork the graph at any decision point, generate N alternative continuations, score them, and commit the winner. All branches remain for audit.

### Side-Effect Isolation (Atomix-inspired)

Tools are categorized by reversibility:
- **Pure** (Read, Grep, Glob) — no side effects, always safe to replay
- **Bufferable** (Edit, Write) — structurally invertible, auto-reversed on revert
- **Externalized** (Bash, API calls) — require explicit reversal handlers

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  @operad/session                 │
│   JSONL Parser → Event Emitter → Projector      │
│   + blame (cost) + stash (waste) + CLI          │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│                   @operad/core                   │
│   Runtime → Event Loop → Behaviors → Graph      │
│   + revert + explore + effects + health          │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│              Storage Adapters                    │
│   adapter-memory | adapter-sqlite | adapter-pg  │
└─────────────────────────────────────────────────┘
```

## Research Foundations

| Paper | Primitive | arXiv |
|-------|-----------|-------|
| **ESAA** — Event Sourcing as Agent Architecture | Event sourcing as native agent design | [2602.23193](https://arxiv.org/abs/2602.23193) |
| **AgentGit** — Version Control for Agent Execution | Git semantics for agent traces | [2511.00628](https://arxiv.org/abs/2511.00628) |
| **Atomix** — Transactional Tool Calls | Compensate-on-abort, parallel speculation | [2602.14849](https://arxiv.org/abs/2602.14849) |
| **Fork, Explore, Commit** — OS Primitives for Agents | Fork/explore/commit for cognition | [2602.08199](https://arxiv.org/abs/2602.08199) |
| **SagaLLM** — Saga Pattern for Multi-Agent | Compensation in multi-step agent workflows | [2503.11951](https://arxiv.org/abs/2503.11951) |
| **ParallelMuse** — Parallel Thinking for Deep Research | Branch at uncertainty, explore N paths | [2510.24698](https://arxiv.org/abs/2510.24698) |

Each validates one primitive in isolation. Operad unifies them into a single TypeScript runtime.

## Development

```bash
# Clone and install
git clone https://github.com/operadhq/operad.git
cd operad/typescript
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm -r test

# Test a real session
npx operad-session commit ~/.claude/projects/your-project/session.jsonl
```

## License

MIT
