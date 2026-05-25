import type {
  GraphObject,
  GraphRelation,
  GraphEvent,
  GraphAPI,
  ViewSpec,
  GraphView,
} from './types.js'

/**
 * Concrete implementation of GraphView — a read-only, scoped snapshot
 * of graph objects and relations around focal point(s).
 */
export class GraphViewImpl implements GraphView {
  private objectMap = new Map<string, GraphObject>()
  private relationList: GraphRelation[] = []
  private neighborIndex = new Map<string, Set<string>>()

  constructor(objects: GraphObject[], relations: GraphRelation[]) {
    for (const obj of objects) {
      this.objectMap.set(obj.id, obj)
    }
    this.relationList = relations

    // Build neighbor index from relations
    for (const rel of relations) {
      if (!this.neighborIndex.has(rel.sourceId)) {
        this.neighborIndex.set(rel.sourceId, new Set())
      }
      if (!this.neighborIndex.has(rel.targetId)) {
        this.neighborIndex.set(rel.targetId, new Set())
      }
      this.neighborIndex.get(rel.sourceId)!.add(rel.targetId)
      this.neighborIndex.get(rel.targetId)!.add(rel.sourceId)
    }
  }

  objects(): GraphObject[] {
    return [...this.objectMap.values()]
  }

  get(id: string): GraphObject | undefined {
    return this.objectMap.get(id)
  }

  relations(): GraphRelation[] {
    return [...this.relationList]
  }

  objectsOfType(type: string): GraphObject[] {
    return this.objects().filter((o) => o.type === type)
  }

  neighbors(objectId: string): GraphObject[] {
    const neighborIds = this.neighborIndex.get(objectId)
    if (!neighborIds) return []
    const result: GraphObject[] = []
    for (const id of neighborIds) {
      const obj = this.objectMap.get(id)
      if (obj) result.push(obj)
    }
    return result
  }
}

/**
 * Resolve focal object IDs from dot-paths in the event.
 * E.g., 'payload.objectId' → event.payload.objectId
 * If the path doesn't resolve to a string, it's treated as a literal ID.
 */
function resolveFocalIds(spec: ViewSpec, event: GraphEvent): string[] {
  const paths = Array.isArray(spec.around) ? spec.around : [spec.around]
  const ids: string[] = []

  for (const path of paths) {
    const resolved = getNestedValue(event as unknown as Record<string, unknown>, path)
    if (typeof resolved === 'string') {
      ids.push(resolved)
    } else {
      // Treat as literal ID
      ids.push(path)
    }
  }

  return ids
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Resolve a ViewSpec into a GraphView by BFS traversal from focal objects.
 * Returns a read-only scoped view of the graph neighborhood.
 */
export async function resolveView(
  spec: ViewSpec,
  event: GraphEvent,
  graph: GraphAPI
): Promise<GraphView> {
  const focalIds = resolveFocalIds(spec, event)

  // BFS from focal objects up to `depth` hops
  const visitedObjects = new Map<string, GraphObject>()
  const collectedRelations: GraphRelation[] = []
  const seenRelations = new Set<string>()

  let frontier = new Set<string>(focalIds)

  // Fetch and add focal objects
  for (const id of focalIds) {
    const obj = await graph.getObject(id)
    if (obj) visitedObjects.set(id, obj)
  }

  for (let hop = 0; hop < spec.depth; hop++) {
    const nextFrontier = new Set<string>()

    for (const objectId of frontier) {
      // Get all relations involving this object (as source or target)
      const outgoing = await graph.queryRelations({ sourceId: objectId })
      const incoming = await graph.queryRelations({ targetId: objectId })

      for (const rel of [...outgoing, ...incoming]) {
        if (seenRelations.has(rel.id)) continue
        seenRelations.add(rel.id)
        collectedRelations.push(rel)

        // Find the neighbor
        const neighborId = rel.sourceId === objectId ? rel.targetId : rel.sourceId
        if (!visitedObjects.has(neighborId)) {
          const neighbor = await graph.getObject(neighborId)
          if (neighbor) {
            visitedObjects.set(neighborId, neighbor)
            nextFrontier.add(neighborId)
          }
        }
      }
    }

    frontier = nextFrontier
  }

  return new GraphViewImpl([...visitedObjects.values()], collectedRelations)
}
