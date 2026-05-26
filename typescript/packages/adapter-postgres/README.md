# @operad/adapter-postgres

Production-ready PostgreSQL storage adapter for [Operad](https://github.com/operadhq/operad) — the event-sourced graph runtime for AI agents.

Features recursive CTE-based causal chain tracing, JSONB queries for flexible data filtering, and full transactional integrity.

## Install

```bash
npm install @operad/core @operad/adapter-postgres
```

## Usage

```typescript
import { createRuntime } from '@operad/core'
import { PostgresAdapter } from '@operad/adapter-postgres'

const runtime = createRuntime({
  storage: new PostgresAdapter({
    connectionString: process.env.DATABASE_URL!,
  }),
})

const graph = await runtime.createGraph('production-agent')
```

## Features

- **Causal chain queries** — Recursive CTEs trace `causedBy` links through the full event history
- **JSONB filtering** — Query objects and events by nested data fields
- **Transactional integrity** — All mutations are atomic
- **Production-ready** — Connection pooling, prepared statements, graceful shutdown

## Schema

The adapter auto-creates tables on first use. Tables: `operad_objects`, `operad_relations`, `operad_events`, `operad_decisions`, `operad_health`.

## When to use

| Adapter | Use case |
|---------|----------|
| [`adapter-memory`](https://www.npmjs.com/package/@operad/adapter-memory) | Development, testing, demos |
| **`adapter-postgres`** | Production, multi-session agents, audit trails, regulated industries |

## Links

- [GitHub](https://github.com/operadhq/operad)
- [Operad Core](https://www.npmjs.com/package/@operad/core)

## License

MIT
