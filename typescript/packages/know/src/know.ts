import { createRuntime } from '@operad/core'
import type { GraphAPI, Runtime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { PatternExtractor } from './extractor.js'
import type {
  DocumentInput,
  KnowledgeGraph,
  KnowOptions,
  Extractor,
  ExtractionResult,
} from './types.js'

/**
 * Know: turn documents into provenance-tracked knowledge graphs.
 *
 * Everything runs locally. Nothing is uploaded.
 * Uses @operad/core for the graph runtime and @operad/adapter-memory for storage.
 *
 * Usage:
 *   const know = new Know()
 *   const kg = await know.ingest({ name: 'Client Brief', content: '...' })
 *   const people = await kg.graph.queryObjects({ type: 'person' })
 */
export class Know {
  private runtime: Runtime
  private extractor: Extractor
  private graphCounter = 0

  constructor(opts: KnowOptions = {}) {
    this.extractor = opts.extractor ?? new PatternExtractor()
    this.runtime = createRuntime({
      storage: new MemoryAdapter(),
    })
  }

  /**
   * Ingest a single document into a new knowledge graph.
   * Extracts entities and relations, creates graph objects for each,
   * and wires them together with typed edges.
   */
  async ingest(doc: DocumentInput): Promise<KnowledgeGraph> {
    const graphId = `know_${++this.graphCounter}_${Date.now()}`
    const graph = await this.runtime.createGraph(graphId)

    // Extract entities and relations from text
    const result = this.extractor.extract(doc.content)

    // Build the graph
    const entityIds = await this.buildGraph(graph, doc, result)

    return {
      graph,
      id: graphId,
      entityIds,
      stats: {
        documents: 1,
        entities: result.entities.length,
        relations: result.relations.length,
        facts: result.facts.length,
      },
    }
  }

  /**
   * Ingest multiple documents into a single knowledge graph.
   * Entities with the same value are merged (same node, multiple sources).
   */
  async ingestMany(docs: DocumentInput[]): Promise<KnowledgeGraph> {
    const graphId = `know_${++this.graphCounter}_${Date.now()}`
    const graph = await this.runtime.createGraph(graphId)

    let totalEntities = 0
    let totalRelations = 0
    let totalFacts = 0
    const allEntityIds: string[] = []

    for (const doc of docs) {
      const result = this.extractor.extract(doc.content)
      const ids = await this.buildGraph(graph, doc, result)
      allEntityIds.push(...ids)
      totalEntities += result.entities.length
      totalRelations += result.relations.length
      totalFacts += result.facts.length
    }

    return {
      graph,
      id: graphId,
      entityIds: allEntityIds,
      stats: {
        documents: docs.length,
        entities: totalEntities,
        relations: totalRelations,
        facts: totalFacts,
      },
    }
  }

  /**
   * Extract without building a graph — useful for previewing
   * what would be extracted before committing to a graph.
   */
  extract(text: string): ExtractionResult {
    return this.extractor.extract(text)
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private async buildGraph(
    graph: GraphAPI,
    doc: DocumentInput,
    result: ExtractionResult
  ): Promise<string[]> {
    // 1. Create document node (source provenance)
    const docObj = await graph.addObject({
      type: 'document',
      data: {
        name: doc.name,
        mimeType: doc.mimeType ?? 'text/plain',
        ...(doc.metadata ?? {}),
        sectionCount: result.sections.length,
        entityCount: result.entities.length,
      },
    })

    // 2. Create entity nodes
    const entityMap = new Map<string, string>() // label → objectId
    const entityIds: string[] = []

    for (const entity of result.entities) {
      // Deduplicate by value — reuse existing node
      const key = `${entity.type}:${entity.value}`
      if (entityMap.has(key)) continue

      const obj = await graph.addObject({
        type: entity.type,
        data: {
          label: entity.label,
          value: entity.value,
          confidence: entity.confidence,
          source: entity.source,
        },
      })

      entityMap.set(key, obj.id)
      entityMap.set(entity.value, obj.id) // Also index by raw value for relation linking
      entityIds.push(obj.id)

      // Link entity to source document
      await graph.addRelation(obj.id, docObj.id, 'extracted_from', {
        confidence: entity.confidence,
      })
    }

    // 3. Create relation edges between entities
    for (const rel of result.relations) {
      const sourceId = entityMap.get(rel.sourceLabel)
      const targetId = entityMap.get(rel.targetLabel)
      if (sourceId && targetId) {
        await graph.addRelation(sourceId, targetId, rel.type)
      }
    }

    // 4. Create section nodes (for long documents)
    if (result.sections.length > 1) {
      for (let i = 0; i < result.sections.length; i++) {
        const section = result.sections[i]
        const sectionObj = await graph.addObject({
          type: 'section',
          data: {
            heading: section.heading,
            body: section.body,
            order: i,
          },
        })
        await graph.addRelation(sectionObj.id, docObj.id, 'part_of')
      }
    }

    return entityIds
  }
}
