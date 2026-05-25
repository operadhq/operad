# @operad/adapter-memory

In-memory storage adapter for [Operad](https://github.com/operadhq/operad) — the event-sourced graph runtime for AI agents.

Perfect for development, testing, and short-lived processes. Data lives in memory and is lost when the process exits.

## Install

```bash
npm install @operad/core @operad/adapter-memory
```

## Usage

```typescript
import { createRuntime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'

const runtime = createRuntime({
  storage: new MemoryAdapter(),
})

const graph = await runtime.createGraph('my-agent')
await graph.addObject({ type: 'note', data: { text: 'hello' } })
```

## When to use

| Adapter | Use case |
|---------|----------|
| **`adapter-memory`** | Development, testing, demos, short-lived scripts |
| [`adapter-postgres`](https://www.npmjs.com/package/@operad/adapter-postgres) | Production, multi-session agents, audit trails |

## Links

- [GitHub](https://github.com/operadhq/operad)
- [Operad Core](https://www.npmjs.com/package/@operad/core)

## License

MIT
