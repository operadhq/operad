# `operad` CLI — Reference Guide

> Single binary for dev-time graph inspection and production ops.
> No GUI, no browser — everything is ASCII in the terminal.

## Quick Start

```bash
# Build
cd typescript && pnpm build

# Run any command
node packages/server/dist/cli.js <command>

# Or, after `pnpm link`:
operad <command>
```

## Architecture

```
operad <command> [args] [--flags]
       │
       ├── parseArgs()          Raw process.argv → { positional[], flags{} }
       ├── createStorage()      ADAPTER env → MemoryAdapter | PostgresAdapter
       ├── createRuntime()      Core runtime with storage wired in
       └── route to handler     switch on positional[0]
```

**Key design decision:** All dev commands operate directly against the storage adapter — no HTTP server required. The same CLI works against in-memory (dev) or Postgres (production) by flipping an environment variable.

```bash
# Dev (default — ephemeral, data lost between runs)
operad graph inspect my-graph

# Production (persistent)
ADAPTER=postgres DATABASE_URL=postgres://... operad graph inspect my-graph
```

### No External Dependencies

The CLI uses raw `process.argv` parsing. No commander, no yargs, no chalk. The command surface is small (~15 subcommands), so hand-rolled parsing keeps the binary lean and dependency-free.

---

## Command Reference

### `operad` / `operad help`

Show the full help screen with all commands and environment variables.

---

### Dev Commands

#### `operad demo [name]`

Run a built-in demo scenario. Demos execute as `tsx` subprocesses from the `apps/example/` directory.

```bash
operad demo                  # List available demos
operad demo primitives       # All 7 primitives: actors, views, forking, patches, etc.
operad demo insurance        # Insurance agent processing a water damage claim
operad demo fraud            # Fraud detection workflow
```

#### `operad graph create <id>`

Create a new graph with the given ID.

```bash
operad graph create claim-42
# ◆ Graph created: claim-42
```

#### `operad graph inspect <id>`

Full summary: ASCII graph topology, objects table, relations table, and event breakdown.

```bash
operad graph inspect claim-42
```

Output:

```
◆ Graph: claim-42

Graph:
  ╭─ ● claim ────────────────────────────────────╮
  │  obj_1779670817..                             │
  │  "Water damage - basement"                    │
  ├──────────────────────────────────────────────┤
  │  ├──▶ depends_on ── evidence:obj_17..         │
  │  ├──▶ contradicts ── claim:obj_17..           │
  │  └──▶ covered_by ── policy:obj_17..           │
  ╰──────────────────────────────────────────────╯
       │
       ▼
  ╭─ ● evidence ─────────────────────────────────╮
  │  obj_1779670817..                             │
  │  "Plumber report"                             │
  ├──────────────────────────────────────────────┤
  │  └──◀ claim:obj_17.. ── depends_on            │
  ╰──────────────────────────────────────────────╯

  ╭─ ○ flag ─────────────────────────────────────╮
  │  obj_1779670817..  (isolated)                 │
  │  "contradicting claims"                       │
  ╰──────────────────────────────────────────────╯

Objects (3):
  ID                TYPE        DATA                         UPDATED
  obj_1779..6638    claim       {"title":"Water damage..."}  2m ago
  obj_1779..6641    evidence    {"title":"Plumber repo..."}  2m ago
  obj_1779..6650    flag        {"reason":"contradict..."}   1m ago

Relations (2):
  SOURCE            TARGET            TYPE
  obj_1779..6638    obj_1779..6641    depends_on
  obj_1779..6638    obj_1779..6639    contradicts

Events: 21 total
  By actor: user=9, runtime=8, llm-claim-analyzer=3, admin-user=1
  By type: object.created=3, object.patched=1, relation.created=2, ...
```

The **ASCII graph** section uses box-drawing characters for rich visualization:
- **Node cards** with `╭╰` borders show type (with ● / ○ icon), truncated ID, and readable data label
- **Outgoing edges** rendered as `├──▶` tree inside the card, showing relation type and target
- **Incoming edges** shown as `├──◀` for leaf nodes (targets with no outgoing edges)
- **Topological ordering** via BFS from root nodes — source nodes appear first, flowing downward with `│ ▼` connectors
- **Isolated nodes** marked with `○` and `(isolated)` tag, displayed at the end with spacing

#### `operad graph events <id> [--type <eventType>]`

List events in a graph, optionally filtered by type.

```bash
operad graph events claim-42
operad graph events claim-42 --type object.created
operad graph events claim-42 --type custom.hello
```

#### `operad graph objects <id> [--type <objectType>]`

List objects in a graph, optionally filtered by type.

```bash
operad graph objects claim-42
operad graph objects claim-42 --type claim
```

#### `operad graph relations <id>`

List all relations (edges) in a graph.

```bash
operad graph relations claim-42
```

#### `operad graph fork <id> --at <eventId>`

Fork a graph at a specific event, creating a divergent timeline for what-if analysis.

```bash
operad graph fork claim-42 --at evt_abc123 --label what-if-deny
# ◆ Forked graph "claim-42" at event evt_abc1..
#   New graph: claim-42-fork-1
```

#### `operad emit <graphId> <type> [json]`

Emit a custom event into a graph. Triggers any matching behaviors.

```bash
operad emit claim-42 custom.hello '{"msg":"world"}'
# ◆ Event emitted: custom.hello (evt_1779..)
```

#### `operad match <graphId> <pattern>`

Run a Cypher-subset pattern query against the graph.

```bash
operad match claim-42 '(a:claim)-[:contradicts]->(b:claim)'
```

Output:

```
◆ Pattern: (a:claim)-[:contradicts]->(b:claim)
  Matches: 1

  Match 1:
    a: claim obj_17.. {"title":"Water damage in kitchen"}
    b: claim obj_17.. {"title":"Water damage in bathroom"}
```

**Pattern syntax:** `(alias:Type)-[:relationType]->(alias:Type)`. Type constraints are optional.

---

### Ops Commands

#### `operad serve [--port N]`

Start the HTTP REST server. This is the original `operad-server` behavior, now accessible as a subcommand.

```bash
operad serve                 # Default port 3111
operad serve --port 8080     # Custom port
```

Also respects `PORT` environment variable.

#### `operad patches <graphId>`

List pending patch proposals awaiting governance approval.

```bash
operad patches claim-42
```

Output:

```
◆ Pending patches for: claim-42 (2)

  ID                TYPE    REASON                  PROPOSED BY       CREATED
  patch_abc1..de    flag    LLM detected fraud      llm-analyzer      3m ago
  patch_def2..gh    tag     High-value threshold    auto-tagger       1m ago
```

#### `operad approve <patchId>`

Approve a pending patch. Creates the proposed object and emits a `patch.applied` event.

```bash
operad approve patch_abc123
# ◆ Patch approved: patch_abc123
```

#### `operad deny <patchId>`

Deny a pending patch. Emits a `patch.rejected` event.

```bash
operad deny patch_abc123
# ◆ Patch denied: patch_abc123
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADAPTER` | `memory` | Storage backend: `memory` or `postgres` |
| `DATABASE_URL` | — | Postgres connection string (required when `ADAPTER=postgres`) |
| `PORT` | `3111` | HTTP port for `operad serve` |

---

## File Layout

```
packages/server/
├── src/
│   ├── cli.ts          ← Unified CLI (this file)
│   └── index.ts        ← Hono REST app factory (used by `serve`)
├── package.json        ← bin: { "operad": "./dist/cli.js", ... }
└── tsup.config.ts      ← Bundles cli.ts as entry point
```

The CLI imports from three workspace packages:
- `@operad/core` — Runtime, behaviors, pattern matching
- `@operad/adapter-memory` — In-memory storage (dev)
- `@operad/adapter-postgres` — Postgres storage (production)

---

## How It Works Internally

### Argument Parsing

Minimal hand-rolled parser. Positional args and `--flag value` pairs:

```
operad graph events claim-42 --type custom.hello
       ^^^^^ ^^^^^^ ^^^^^^^^       ^^^^^^^^^^^^
       pos[0] pos[1] pos[2]        flags.type = "custom.hello"
```

### Command Routing

Two-level routing for the `graph` command group:

```
main()
├── "serve"   → cmdServe(flags)
├── "demo"    → cmdDemo(name)
├── "graph"   → sub-route on pos[1]:
│   ├── "create"    → cmdGraphCreate(id, runtime)
│   ├── "inspect"   → cmdGraphInspect(id, runtime, storage)
│   ├── "events"    → cmdGraphEvents(id, flags, storage)
│   ├── "objects"   → cmdGraphObjects(id, flags, runtime)
│   ├── "relations" → cmdGraphRelations(id, runtime)
│   └── "fork"      → cmdGraphFork(id, flags, runtime)
├── "emit"    → cmdEmit(graphId, type, json, runtime)
├── "match"   → cmdMatch(graphId, pattern, runtime)
├── "patches" → cmdPatches(graphId, runtime)
├── "approve" → cmdApprove(patchId, runtime)
└── "deny"    → cmdDeny(patchId, runtime)
```

### Formatting Helpers

| Helper | Purpose |
|--------|---------|
| `truncId(id, len)` | Shorten UUIDs: `obj_177966749963..` |
| `timeAgo(iso)` | Relative time: `2m ago`, `3h ago` |
| `table(headers, rows)` | Padded column-aligned console table |
| `truncData(data, maxLen)` | Truncate JSON: `{"title":"Water da..."}` |
| `renderAsciiGraph(objects, relations)` | ASCII topology with arrows and grouping |

### ASCII Graph Rendering

The renderer draws each object as a bordered card with box-drawing characters (`╭╰├│`), showing outgoing/incoming edges as tree branches inside the card. Nodes are topologically ordered via BFS so the graph flows top-to-bottom.

Algorithm:
1. Build `objById` lookup and group relations into `outgoing` / `incoming` maps
2. Find root nodes (have outgoing edges but no incoming) for BFS ordering
3. BFS to produce topological order — sources first, targets after
4. For each node: draw card with type header, ID, data label
5. If node has outgoing edges: draw `├──▶` tree section with relation type + target label
6. If node is a leaf (incoming only): draw `├──◀` section with source label + relation type
7. Between connected nodes: draw `│ ▼` connector lines
8. Isolated nodes (`○`) appear last with spacing

---

## Extending the CLI

To add a new command:

1. Add an `async function cmdYourCommand(...)` handler
2. Add a case to the `switch (cmd)` in `main()`
3. Add a line to `printHelp()`
4. Rebuild: `pnpm build`

All commands follow the pattern: parse args → get runtime/storage → query → format → print.
