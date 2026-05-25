import type { BehaviorDef, RelationBehaviorDef } from './types.js'

/**
 * Create a behavior that fires once per matching relation.
 * Returns a standard BehaviorDef (composition, not inheritance).
 *
 * When the subscribed event fires, the generated behavior:
 * 1. Queries all relations of `relationType` in the graph
 * 2. Applies the optional `where` clause
 * 3. Calls the handler once per matching relation
 */
export function relationBehavior(def: RelationBehaviorDef): BehaviorDef {
  return {
    name: def.name,
    on: def.on,
    where: def.where,
    handler: async (event, graph, ctx) => {
      const relations = await graph.queryRelations({ type: def.relationType })

      for (const relation of relations) {
        await def.handler(relation, event, graph, ctx)
      }
    },
  }
}
