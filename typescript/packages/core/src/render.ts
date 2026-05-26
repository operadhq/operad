/**
 * ASCII graph renderer — visual representation of an Operad graph.
 *
 * Renders box-drawn node cards with typed data and edge trees.
 * Full IDs and data shown. Box width adapts dynamically.
 * Topologically ordered via BFS; isolated nodes marked with ○.
 *
 * Returns string lines (no I/O) — callers decide how to output.
 */

export interface RenderableObject {
  id: string
  type: string
  data: Record<string, unknown>
}

export interface RenderableRelation {
  sourceId: string
  targetId: string
  type: string
}

/**
 * Renders an ASCII graph as an array of lines showing objects as box-drawn
 * cards with outgoing/incoming edges as tree branches.
 *
 * Pure function — no I/O. Caller is responsible for printing.
 */
export function renderAsciiGraph(
  objects: RenderableObject[],
  relations: RenderableRelation[],
): string[] {
  const lines: string[] = []

  if (objects.length === 0) {
    lines.push('  (empty graph)')
    return lines
  }

  const objById = new Map(objects.map((o) => [o.id, o]))
  const connected = new Set<string>()

  const outgoing = new Map<string, Array<{ targetId: string; type: string }>>()
  const incoming = new Map<string, Array<{ sourceId: string; type: string }>>()

  for (const rel of relations) {
    connected.add(rel.sourceId)
    connected.add(rel.targetId)
    if (!outgoing.has(rel.sourceId)) outgoing.set(rel.sourceId, [])
    outgoing.get(rel.sourceId)!.push({ targetId: rel.targetId, type: rel.type })
    if (!incoming.has(rel.targetId)) incoming.set(rel.targetId, [])
    incoming.get(rel.targetId)!.push({ sourceId: rel.sourceId, type: rel.type })
  }

  const edgeLabel = (type: string, targetId: string): string => {
    const target = objById.get(targetId)
    const tLabel = target ? `${target.type}:${targetId}` : targetId
    return `${type} ── ${tLabel}`
  }

  const inEdgeLabel = (type: string, sourceId: string): string => {
    const source = objById.get(sourceId)
    const sLabel = source ? `${source.type}:${sourceId}` : sourceId
    return `${sLabel} ── ${type}`
  }

  const dataLines = (data: Record<string, unknown>): string[] => {
    const entries = Object.entries(data)
    if (entries.length === 0) return ['(empty)']
    return entries.map(([k, v]) => {
      const val = typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
      return `${k}: ${val}`
    })
  }

  // Topological order via BFS
  const printed = new Set<string>()
  const order: string[] = []
  const roots = objects.filter((o) => outgoing.has(o.id) && !incoming.has(o.id))
  if (roots.length === 0) {
    for (const o of objects) {
      if (outgoing.has(o.id)) roots.push(o)
    }
  }
  const queue = [...roots]
  while (queue.length > 0) {
    const node = queue.shift()!
    if (printed.has(node.id)) continue
    printed.add(node.id)
    order.push(node.id)
    for (const e of outgoing.get(node.id) ?? []) {
      const target = objById.get(e.targetId)
      if (target && !printed.has(e.targetId)) queue.push(target)
    }
  }
  for (const o of objects) {
    if (!printed.has(o.id)) order.push(o.id)
  }

  const pad = (s: string, w: number) => s.length >= w ? s : s + ' '.repeat(w - s.length)
  let isFirst = true

  for (const id of order) {
    const obj = objById.get(id)!
    const isIsolated = !connected.has(id)
    const out = outgoing.get(id) ?? []
    const inc = incoming.get(id) ?? []
    const icon = isIsolated ? '○' : '●'

    const idStr = isIsolated ? `${obj.id}  (isolated)` : obj.id
    const dLines = dataLines(obj.data)
    const outLabels = out.map((e) => `├──▶ ${edgeLabel(e.type, e.targetId)}`)
    if (outLabels.length > 0) outLabels[outLabels.length - 1] = '└' + outLabels[outLabels.length - 1].slice(1)
    const incLabels = (inc.length > 0 && !outgoing.has(id))
      ? inc.map((e) => `├──◀ ${inEdgeLabel(e.type, e.sourceId)}`)
      : []
    if (incLabels.length > 0) incLabels[incLabels.length - 1] = '└' + incLabels[incLabels.length - 1].slice(1)

    const allLines = [idStr, ...dLines, ...outLabels, ...incLabels]
    const maxContent = Math.max(...allLines.map((l) => l.length))
    const innerW = Math.max(maxContent, 20)
    const boxW = innerW + 4

    if (!isFirst && !isIsolated && inc.length > 0) {
      lines.push('       │')
      lines.push('       ▼')
    }
    if (!isFirst && isIsolated) lines.push('')
    isFirst = false

    const typeHeader = ` ${icon} ${obj.type} `
    const topFill = '─'.repeat(Math.max(0, boxW - 3 - typeHeader.length))
    lines.push(`  ╭─${typeHeader}${topFill}╮`)
    lines.push(`  │  ${pad(idStr, innerW)} │`)

    for (const line of dLines) {
      lines.push(`  │  ${pad(line, innerW)} │`)
    }

    if (outLabels.length > 0) {
      lines.push(`  ├${'─'.repeat(boxW - 2)}┤`)
      for (const line of outLabels) {
        lines.push(`  │  ${pad(line, innerW)} │`)
      }
    }

    if (incLabels.length > 0) {
      lines.push(`  ├${'─'.repeat(boxW - 2)}┤`)
      for (const line of incLabels) {
        lines.push(`  │  ${pad(line, innerW)} │`)
      }
    }

    lines.push(`  ╰${'─'.repeat(boxW - 2)}╯`)
  }

  return lines
}
