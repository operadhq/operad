# @operad/session

See what your AI coding agent actually did.

```bash
npm install @operad/session
```

Hooks auto-configure for Claude Code, Codex, and OpenCode. Start coding — after your session:

```bash
operad-session log --graph <session-id>
```

### Try the interactive demos

```bash
operad-session demo primitives        # Runtime primitives (actor, behaviors, patches, forking)
operad-session demo coding            # Coding agent — JWT auth with thinking + tool use
operad-session demo financial-analyst  # SaaS revenue analysis and forecasting
operad-session demo insurance          # Claims processing with fraud detection
operad-session demo customer-support   # Debugging permissions, fixing code
operad-session demo hedge-fund         # Biotech screening and position sizing
operad-session demo research-agent     # RAG literature survey and benchmarks
```

Add `--html` to open the interactive timeline viewer in your browser:

```bash
operad-session demo coding --html
```

The timeline viewer includes three visualization modes:
- **Swim Lanes** — events by actor (user / agent / thinking) with causal arrows
- **Causal Chain** — tree view showing event causality (like `git log --graph`)
- **Waterfall** — phase gantt per goal (Thinking → Research → Implement → Verify)

> **Cloud viewer coming soon** — share sessions via URL. [**Get notified →**](https://operad.dev/#notify)

```
session_a3f7c2d1 — 142 events (309 total)

  [goal.set]              user     "Fix the authentication bug in login flow"
  [tool_called]           agent    Read → src/auth/login.ts
  [tool_called]           agent    Read → src/auth/middleware.ts
  [tool_called]           agent    Grep → src/auth/
  [tool_called]           agent    Read → src/auth/login.ts        ← redundant
  [tool_called]           agent    Edit → src/auth/login.ts
  [tool_called]           agent    Bash
  [goal.set]              user     "Now refactor auth to use JWT instead of sessions"
  [tool_called]           agent    Read → src/auth/config.ts
  [tool_called]           agent    Write → src/auth/jwt.ts
  [tool_called]           agent    Edit → src/auth/middleware.ts
  [tool_called]           agent    Edit → src/auth/login.ts
  [decision.recorded]     agent    selected: jwt_tokens
  [tool_called]           agent    Bash
  ...

Total: 309 events
```

Every file read, every edit, every decision — with the full trace of how your agent got there.

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
  ★ Goal #2: Now refactor auth to use JWT instead of sessions
  │
  ├── ⚙ Tools: Read×12, Edit×6, Write×2, Bash×4
  ├── $ Cost: $8.20
  ├── Events: 63
  │
  ★ Goal #3: Add tests for the new JWT auth
  │
  ├── ⚙ Tools: Read×8, Write×4, Bash×6
  ├── Events: 41
  │
  ╰── ◉ Graph complete: 309 events

  Tool Distribution:
  ┌────────────────────────────────────────────────┐
  │ Read        ████████████████████████████    34 │
  │ Edit        ████████████████               18 │
  │ Bash        ██████████████                 16 │
  │ Write       ████████                        9 │
  │ Grep        ██████                          7 │
  │ Glob        ███                             3 │
  └────────────────────────────────────────────────┘
```

## Install

```bash
npm install @operad/session
```

On install, hooks are automatically configured for **every local coding agent**:

```
📊 @operad/session — tracking enabled for all local agents:
   ✓ Claude Code    (.claude/settings.json)
   ✓ Codex CLI      (.codex/hooks.json)
   ✓ OpenCode       (.opencode/plugins/operad-hooks.ts)
```

No config. No init command. Just install and code.

## What You Can Do With the Log

```bash
# The event trace — what happened, in order
operad-session log --graph <session-id>

# Structured view — goals, tools, cost per goal
operad-session graph --graph <session-id>

# Cost per goal — where the money went
operad-session blame --graph <session-id>

# Wasted work — redundant reads, re-spent tokens
operad-session stash --graph <session-id>

# Interactive timeline in browser
operad-session view --graph <session-id>

# Fork at a decision and try something different
operad-session fork --graph <session-id> --at-event <event-id> \
  --run "Use session cookies instead of JWT"

# Compare the two approaches
operad-session diff <session-id> <session-id>_fork
```

## Commands

| Command | What it does |
|---------|-------------|
| `demo [name]` | Run a built-in demo (`--list` to see all, `--html` for browser) |
| `commit <path.jsonl>` | Import a JSONL session into the graph |
| `inspect --graph <id>` | Show session summary (events, goals, cost) |
| `log --graph <id>` | Event history (like `git log`) |
| `blame --graph <id>` | Cost attribution per goal |
| `diff <graph-a> <graph-b>` | Compare two sessions structurally |
| `fork --graph <id> --at-event <evt>` | Branch at any point |
| `fork ... --run "<instruction>"` | Branch and run Claude with new instructions |
| `replay --graph <id> --to-event <evt>` | Time-travel to any point |
| `stash --graph <id>` | Find wasted work (redundant reads) |
| `revert <event-id> --graph <id>` | Undo everything after a point |
| `explore <event-id> -n 3` | Fork N branches from a point |
| `graph --graph <id>` | ASCII event graph (turn-based view) |
| `view --graph <id>` | Open interactive timeline in browser |
| `export-trace --graph <id>` | Export as JSONL or text |

## Use Cases

### Compare Two Approaches

Fork at a decision point and let Claude try the alternative:

```bash
operad-session fork --graph $ID --at-event $EVT \
  --run "Use Redis instead of in-memory cache" \
  --max-budget 3.00
```

See [examples/fork-and-compare.sh](./examples/fork-and-compare.sh)

### Understand Your AI Spend

```bash
operad-session blame --graph $ID     # Which goal cost the most?
operad-session stash --graph $ID     # What work was wasted?
```

See [examples/cost-analysis.sh](./examples/cost-analysis.sh)

### Explore Multiple Alternatives

```bash
# Fork 3 different approaches from the same point
operad-session fork --graph $ID --at-event $EVT --run "Approach A" --label a
operad-session fork --graph $ID --at-event $EVT --run "Approach B" --label b
operad-session fork --graph $ID --at-event $EVT --run "Approach C" --label c

# Compare all three
operad-session diff $ID ${ID}_a
operad-session diff $ID ${ID}_b
operad-session diff $ID ${ID}_c
```

See [examples/explore-alternatives.sh](./examples/explore-alternatives.sh)

### Debug an Expensive Session

```bash
operad-session stash --graph $ID      # Find redundant work
operad-session graph --graph $ID      # Visualize the flow
operad-session revert $EVT --graph $ID  # Undo the damage
operad-session fork --graph $ID --at-event $EVT --run "Try again, avoid X"
```

See [examples/session-forensics.sh](./examples/session-forensics.sh)

## Fork + Run Options

```
fork --graph <id> --at-event <evt>
  --run "<instruction>"        Run Claude with these instructions on the fork
  --model <model>              Model to use (default: claude-sonnet-4)
  --max-budget <dollars>       Budget cap in USD (default: 5.00)
  --label <name>               Name the fork branch
  --no-diff                    Skip auto-diff after completion
  --json                       Machine-readable output
```

## Programmatic Usage

```typescript
import { commit, extractForkContext } from '@operad/session'

// Import a session
const log = await commit(jsonlText, { storage, runtime, graphId })

// Extract context for a fork
const events = await storage.queryEvents(graphId, {})
const { systemPrompt, workingDir } = extractForkContext(events, forkEventId)
```

## How It Works

```
JSONL file → parse → events → project → graph
                                  ↓
                        blame (cost per goal)
                        stash (wasted work)
                        fork  (branch at any point)
                        diff  (compare timelines)
```

The event log is the agent. The graph is its world. See [docs/PHILOSOPHY.md](../../docs/PHILOSOPHY.md).

## Storage

All data persists to `~/.operad/session.db` (SQLite). No server required.

## Supported Agents

All configured automatically on install — no setup needed.

| Agent | Hook Config | Session Format |
|-------|------------|----------------|
| **Claude Code** | `.claude/settings.json` | JSONL (auto-detected) |
| **Codex CLI** | `.codex/hooks.json` | JSONL (auto-detected) |
| **OpenCode** | `.opencode/plugins/operad-hooks.ts` | JSONL (auto-detected) |

To reconfigure or add hooks manually: `operad-session init` or `operad-session init --harness codex`
