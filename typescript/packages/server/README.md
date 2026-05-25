# @operad/server

REST API server and CLI for [Operad](https://github.com/operadhq/operad) — the event-sourced graph runtime for AI agents.

## Try it now

```bash
npx @operad/server demo primitives
```

This runs a full demo showing all 7 primitives (actors, relation behaviors, views, LLM behaviors, pattern matching, patches, forking) with an ASCII graph visualization — no clone needed.

## Install

```bash
npm install @operad/server
```

## CLI

```bash
# Run demos
operad demo primitives          # All 7 primitives
operad demo insurance           # Insurance claim processing
operad demo fraud               # Fraud detection

# Scaffold a new project
operad init my-agent

# Graph inspection
operad graph create my-graph
operad graph inspect my-graph   # ASCII visualization + tables
operad graph events my-graph
operad graph objects my-graph

# Pattern matching
operad match my-graph "(a:claim)-[:contradicts]->(b:claim)"

# Governance
operad patches my-graph
operad approve <patchId>
operad deny <patchId>

# HTTP server
operad serve --port 3111
```

## REST API

The server exposes a full CRUD REST API over Hono:

```
POST   /graphs/:id                    Create graph
GET    /graphs/:id/objects            Query objects
POST   /graphs/:id/objects            Add object
PATCH  /graphs/:id/objects/:objectId  Patch object
GET    /graphs/:id/relations          Query relations
POST   /graphs/:id/relations          Add relation
GET    /graphs/:id/events             Query events
POST   /graphs/:id/emit              Emit event
POST   /graphs/:id/match             Pattern match
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `ADAPTER` | `memory` | Storage adapter: `memory` or `postgres` |
| `DATABASE_URL` | — | Postgres connection (required when `ADAPTER=postgres`) |
| `PORT` | `3111` | HTTP server port |

## Links

- [GitHub](https://github.com/operadhq/operad)
- [Operad Core](https://www.npmjs.com/package/@operad/core)
- [Blog](https://operad.dev)

## License

MIT
