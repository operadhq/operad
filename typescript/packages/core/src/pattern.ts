import type { GraphAPI, GraphObject, GraphRelation, PatternMatch } from './types.js'

/**
 * Parsed representation of a single-hop Cypher pattern.
 * E.g., (a:Claim)-[:contradicts]->(b:Claim)
 */
export interface ParsedPattern {
  source: { alias: string; type?: string }
  relation: { type: string }
  target: { alias: string; type?: string }
}

/**
 * Parse a single-hop Cypher-like pattern string.
 * Supported syntax: (alias:Type)-[:relType]->(alias:Type)
 * Type is optional: (a)-[:rel]->(b) matches any types.
 */
export function parsePattern(pattern: string): ParsedPattern {
  // Match: (alias:Type)-[:relType]->(alias:Type)
  // Or:    (alias)-[:relType]->(alias)
  const regex = /^\((\w+)(?::(\w+))?\)-\[:(\w+)\]->\((\w+)(?::(\w+))?\)$/
  const match = pattern.trim().match(regex)

  if (!match) {
    throw new Error(
      `Invalid pattern: "${pattern}". Expected format: (alias:Type)-[:relType]->(alias:Type)`
    )
  }

  return {
    source: { alias: match[1], type: match[2] },
    relation: { type: match[3] },
    target: { alias: match[4], type: match[5] },
  }
}

/**
 * Execute a parsed pattern against the graph, returning all matches.
 * Each match is a map from alias to the matched object or relation.
 */
export async function matchPattern(
  parsed: ParsedPattern,
  graph: GraphAPI
): Promise<PatternMatch[]> {
  // Get all relations of the specified type
  const relations = await graph.queryRelations({ type: parsed.relation.type })
  const matches: PatternMatch[] = []

  for (const rel of relations) {
    // Fetch source and target objects
    const source = await graph.getObject(rel.sourceId)
    const target = await graph.getObject(rel.targetId)

    if (!source || !target) continue

    // Check type constraints
    if (parsed.source.type && source.type !== parsed.source.type) continue
    if (parsed.target.type && target.type !== parsed.target.type) continue

    matches.push({
      [parsed.source.alias]: source,
      [parsed.relation.type]: rel,
      [parsed.target.alias]: target,
    })
  }

  return matches
}
