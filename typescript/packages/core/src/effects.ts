import type { GraphEvent, ReversalHandler } from './types.js'

// ─── Effect Categories (Atomix-inspired) ────────────────────────────────────

/**
 * Categorizes side effects of agent tools:
 * - pure: no side effects (Read, Grep, Glob) — freely reversible, nothing to undo
 * - bufferable: side effects can be undone (Edit, Write) — auto-reversible via inverse ops
 * - externalized: side effects cannot be undone (API calls, Bash) — need compensating actions
 */
export type EffectCategory = 'pure' | 'bufferable' | 'externalized'

export interface EffectRegistry {
  /** Look up the effect category for a tool name */
  categorize(toolName: string): EffectCategory
  /** Register a tool with its effect category and optional reversal handler */
  registerEffect(toolName: string, category: EffectCategory, reverser?: ReversalHandler): void
  /** Filter events to only those with bufferable effects */
  getBufferedEffects(events: GraphEvent[]): GraphEvent[]
  /** Filter events to only those with externalized effects */
  getExternalizedEffects(events: GraphEvent[]): GraphEvent[]
  /** Get the reversal handler for a tool (if registered) */
  getReverser(toolName: string): ReversalHandler | undefined
}

// ─── Default Tool Classifications ───────────────────────────────────────────

const DEFAULT_PURE: string[] = [
  'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch',
  'LSP.hover', 'LSP.definition', 'LSP.references', 'LSP.diagnostics',
  'getDiagnostics', 'executeCode',
]

const DEFAULT_BUFFERABLE: string[] = [
  'Edit', 'Write', 'NotebookEdit',
]

const DEFAULT_EXTERNALIZED: string[] = [
  'Bash', 'mcp__', // MCP tool calls are externalized by default
]

// ─── Implementation ─────────────────────────────────────────────────────────

export function createEffectRegistry(): EffectRegistry {
  const categories = new Map<string, EffectCategory>()
  const reversers = new Map<string, ReversalHandler>()

  // Seed defaults
  for (const tool of DEFAULT_PURE) categories.set(tool, 'pure')
  for (const tool of DEFAULT_BUFFERABLE) categories.set(tool, 'bufferable')
  for (const tool of DEFAULT_EXTERNALIZED) categories.set(tool, 'externalized')

  function categorize(toolName: string): EffectCategory {
    // Exact match first
    const exact = categories.get(toolName)
    if (exact) return exact

    // Prefix match (e.g., 'mcp__' prefix for all MCP tools)
    for (const [key, cat] of categories) {
      if (key.endsWith('_') && toolName.startsWith(key)) return cat
    }

    // Unknown tools default to externalized (safe assumption)
    return 'externalized'
  }

  function extractToolName(event: GraphEvent): string | null {
    const tool = event.payload.tool ?? event.payload.toolName
    return typeof tool === 'string' ? tool : null
  }

  function filterByCategory(events: GraphEvent[], target: EffectCategory): GraphEvent[] {
    return events.filter((e) => {
      const tool = extractToolName(e)
      if (!tool) return false
      return categorize(tool) === target
    })
  }

  return {
    categorize,

    registerEffect(toolName: string, category: EffectCategory, reverser?: ReversalHandler): void {
      categories.set(toolName, category)
      if (reverser) reversers.set(toolName, reverser)
    },

    getBufferedEffects(events: GraphEvent[]): GraphEvent[] {
      return filterByCategory(events, 'bufferable')
    },

    getExternalizedEffects(events: GraphEvent[]): GraphEvent[] {
      return filterByCategory(events, 'externalized')
    },

    getReverser(toolName: string): ReversalHandler | undefined {
      return reversers.get(toolName)
    },
  }
}
