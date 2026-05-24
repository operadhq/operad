import type { GraphAPI } from '@operad/core'

// ─── Extraction Input ────────────────────────────────────────────────────────

export interface DocumentInput {
  /** Human-readable name (e.g., "Client Brief - John Smith") */
  name: string
  /** Raw text content */
  content: string
  /** Optional MIME type hint */
  mimeType?: string
  /** Optional metadata to attach to the document node */
  metadata?: Record<string, string | number | boolean>
}

// ─── Extracted Entities ──────────────────────────────────────────────────────

export type EntityType =
  | 'person'
  | 'organization'
  | 'address'
  | 'phone'
  | 'email'
  | 'money'
  | 'date'
  | 'policy'
  | 'property'
  | 'vehicle'
  | 'fact'
  | 'procedure_step'
  | `custom.${string}`

export interface ExtractedEntity {
  type: EntityType
  label: string
  value: string
  /** Confidence 0-1 (1 = regex match, lower = heuristic) */
  confidence: number
  /** Source line or context where this was found */
  source: string
}

export interface ExtractedRelation {
  sourceLabel: string
  targetLabel: string
  type: string
}

export interface ExtractionResult {
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
  /** Key-value facts (flat summary) */
  facts: Array<{ label: string; value: string }>
  /** The raw text sections */
  sections: Array<{ heading: string; body: string }>
}

// ─── Knowledge Graph ────────────────────────────────────────────────────────

export interface KnowledgeGraph {
  /** The underlying Operad graph */
  graph: GraphAPI
  /** Graph ID */
  id: string
  /** All extracted entities as graph object IDs */
  entityIds: string[]
  /** Summary stats */
  stats: {
    documents: number
    entities: number
    relations: number
    facts: number
  }
}

// ─── Extractor Interface ────────────────────────────────────────────────────

export interface Extractor {
  /** Extract entities and relations from raw text */
  extract(text: string): ExtractionResult
}

// ─── Know Options ───────────────────────────────────────────────────────────

export interface KnowOptions {
  /** Custom extractor (defaults to built-in PatternExtractor) */
  extractor?: Extractor
}
