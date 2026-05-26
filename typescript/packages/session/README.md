# @operad/session

Git for AI agent sessions. Import, analyze, branch, and compare agent work.

<!-- TODO: Add terminal recording GIF here showing fork --run workflow -->
<!-- asciinema rec demo.cast && svg-term --in demo.cast --out demo.svg -->

## Try It (2 minutes)

```bash
npm install @operad/core @operad/adapter-memory
npx tsx examples/quickstart.ts
```

Creates a graph, records a decision, forks at that decision, runs an alternative, and diffs the two. See [examples/quickstart.ts](./examples/quickstart.ts).

## Quick Start

```bash
# Import a Claude Code session
operad-session commit ~/.claude/projects/myapp/session.jsonl

# See what happened
operad-session inspect --graph session_1716000000000

# Fork at a decision point and try something different
operad-session fork --graph session_1716000000000 \
  --at-event evt_17160000 \
  --run "Use session cookies instead of JWT"

# Compare outcomes
operad-session diff session_1716000000000 session_1716000000000_fork
```

## Commands

| Command | What it does |
|---------|-------------|
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

## Supported Harnesses

- Claude Code (auto-detected)
- OpenAI Codex
- OpenCode

The parser auto-detects which harness produced the JSONL.
