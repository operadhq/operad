import { behavior } from '../behavior.js'
import type { BehaviorDef } from '../types.js'

/**
 * Detects redundant file reads — when the same file_path is read
 * again without an intervening edit, emits `custom.waste_detected`.
 */
export function wasteAlert(): BehaviorDef {
  const readCounts = new Map<string, number>()
  const editedSinceLastRead = new Set<string>()

  return behavior({
    name: 'wasteAlert',
    on: ['custom.tool_called'],
    handler: async (event, _graph, ctx) => {
      const tool = event.payload.tool as string | undefined
      const filePath = event.payload.file_path as string | undefined

      if (!filePath) return

      if (tool === 'Edit' || tool === 'Write') {
        editedSinceLastRead.add(filePath)
        return
      }

      if (tool === 'Read') {
        if (editedSinceLastRead.has(filePath)) {
          editedSinceLastRead.delete(filePath)
          readCounts.set(filePath, 1)
        } else {
          const count = (readCounts.get(filePath) ?? 0) + 1
          readCounts.set(filePath, count)
          if (count > 1) {
            await ctx.emit({
              type: 'custom.waste_detected',
              payload: {
                file_path: filePath,
                readCount: count,
                message: `File "${filePath}" read ${count} times without edit`,
              },
              causedBy: event.id,
            })
          }
        }
      }
    },
  })
}
