# The ActiveGraph

> The event log is the agent. The graph is its world.

## The Collapse

Traditional agent architectures split state across four separate systems:

| System | What it does | The problem |
|--------|-------------|-------------|
| **Memory** | Stores what an agent might want to recall | Disconnected from causality |
| **Workflows** | Defines what should happen next | Can't explain *why* something happened |
| **Logs** | Records what happened afterward | Write-only, no projection |
| **State** | The current world | No history, no branching |

The ActiveGraph collapses these into one substrate: an **append-only event log projected into a live graph**.

The graph is the agent's world — what exists, what depends on what, what was produced, what was approved, what changed, and why. Every question you'd ask about an agent's work has a single answer: read the graph.

## Core Primitives

### Events

Everything is an event. Creating an object, setting a goal, making a decision, calling a tool — all are events with timestamps, causal chains, and actors.

```
goal.set → custom.tool_called → object.created → relation.created
    ↑ causedBy links form a DAG of "why did this happen?"
```

### Projection

Events project into objects and relations — the "current state" view. But unlike a database, you can project to *any point in time*. The graph at event 5 is different from the graph at event 50.

### Branching

```
runtime.fork(at_event=…)
```

Branches the run. The shared prefix replays from cache. Forks don't re-pay for LLM calls already made.

This is the key insight: **forking is cheap** because events before the fork point are shared. You're not duplicating state — you're creating an alternate timeline that diverges from a known point.

### Coordination at the Edge

Relations carry meaning. A relation isn't just "A connects to B" — it's "this file *depends on* that decision" or "this approval *gates* that deployment."

Coordination logic lives on the edge, where the meaning is — not duplicated across every node that might emit a relevant event. When you fork, relations in the shared prefix come along for free, and new ones emerge on the branch.

### Diff

Two graphs that share a common ancestor can be compared:

```
diff(parent, fork) → { objects: added/removed/changed, relations: added/removed }
```

This answers: "what did the alternative approach produce differently?" Not by comparing text, but by comparing *structured outcomes*.

## The Git Analogy

| Git | Operad |
|-----|--------|
| commit | `commit(jsonl)` — parse agent work into events |
| log | `log` — event history with causal chains |
| branch | `fork --at-event` — branch at any decision point |
| diff | `diff` — structured comparison of two timelines |
| blame | `blame` — who (which goal) spent how much |
| stash | `stash` — work that was done but wasted |
| checkout | `replay --to-event` — time-travel to any point |

But unlike Git, the "files" being tracked aren't text — they're **objects with typed relations in a knowledge graph**. The diff isn't line-by-line — it's structural.

## Why This Matters

When you run `fork --run "try a different approach"`:

1. The parent graph's events replay from cache (free)
2. Context is extracted from the shared prefix (goals, files, decisions)
3. A new agent runs with that context + new instructions
4. Its work becomes events on the fork branch
5. `diff` shows what diverged — structurally, not textually

You're not comparing two code diffs. You're comparing two **agent reasoning traces** and their outcomes. Which approach found more bugs? Which cost less? Which produced cleaner architecture?

The event log is the agent. The graph is its world. Forking lets you explore alternate worlds.
