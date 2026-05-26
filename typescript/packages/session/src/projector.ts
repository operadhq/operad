/**
 * Projector — events → graph objects + relations.
 *
 * Like `git log --graph` visualizes commit history,
 * the projector turns flat events into a queryable object graph:
 * goals, files, patches, test runs — all linked by causality.
 */
import type { GraphAPI, GraphEvent } from '@operad/core'

const TEST_COMMANDS = ['test', 'pytest', 'vitest', 'jest', 'npm test', 'pnpm test', 'npx vitest']

/**
 * Project parsed events into typed graph objects and relations.
 * Call this after parseAndEmit() has populated the event log.
 */
export async function projectGraph(
  graph: GraphAPI,
  events: GraphEvent[]
): Promise<ProjectionStats> {
  const stats: ProjectionStats = { goals: 0, files: 0, patches: 0, testRuns: 0, relations: 0 }

  // Track state for relation building
  let activeGoalId: string | null = null
  const fileObjects = new Map<string, string>() // path → objectId

  for (const event of events) {
    switch (event.type) {
      case 'goal.set': {
        const obj = await graph.addObject({
          type: 'goal',
          data: {
            text: event.payload.text as string,
            uuid: event.payload.uuid as string,
            status: 'completed',
          },
        })
        activeGoalId = obj.id
        stats.goals++
        break
      }

      case 'custom.tool_called': {
        const tool = event.payload.tool as string
        const input = event.payload.input as Record<string, unknown> | undefined

        if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') {
          const filePath = (input?.file_path as string) ?? (input?.path as string) ?? (input?.pattern as string) ?? ''
          if (filePath && !fileObjects.has(filePath)) {
            const obj = await graph.addObject({
              type: 'file',
              data: { path: filePath, readCount: 1, editCount: 0 },
            })
            fileObjects.set(filePath, obj.id)
            stats.files++

            // goal → triggered → file
            if (activeGoalId) {
              await graph.addRelation(activeGoalId, obj.id, 'triggered')
              stats.relations++
            }
          } else if (filePath && fileObjects.has(filePath)) {
            // Increment read count
            const objId = fileObjects.get(filePath)!
            const existing = await graph.getObject(objId)
            if (existing) {
              await graph.patchObject(objId, {
                readCount: ((existing.data.readCount as number) ?? 0) + 1,
              })
            }
          }
        }

        if (tool === 'Edit' || tool === 'Write') {
          const filePath = (input?.file_path as string) ?? ''
          const patchObj = await graph.addObject({
            type: 'patch',
            data: {
              file: filePath,
              tool,
              oldString: tool === 'Edit' ? ((input?.old_string as string) ?? '').slice(0, 200) : '',
              newString: tool === 'Edit' ? ((input?.new_string as string) ?? '').slice(0, 200) : '',
            },
          })
          stats.patches++

          // Ensure file object exists
          if (filePath && !fileObjects.has(filePath)) {
            const fObj = await graph.addObject({
              type: 'file',
              data: { path: filePath, readCount: 0, editCount: 1 },
            })
            fileObjects.set(filePath, fObj.id)
            stats.files++
          } else if (filePath && fileObjects.has(filePath)) {
            const objId = fileObjects.get(filePath)!
            const existing = await graph.getObject(objId)
            if (existing) {
              await graph.patchObject(objId, {
                editCount: ((existing.data.editCount as number) ?? 0) + 1,
              })
            }
          }

          // goal → produced → patch
          if (activeGoalId) {
            await graph.addRelation(activeGoalId, patchObj.id, 'produced')
            stats.relations++
          }
        }

        if (tool === 'Bash') {
          const command = (input?.command as string) ?? ''
          if (isTestCommand(command)) {
            const testObj = await graph.addObject({
              type: 'test_run',
              data: { command: command.slice(0, 200) },
            })
            stats.testRuns++

            // Find most recent patch and link: patch → verified_by → test_run
            if (activeGoalId) {
              await graph.addRelation(activeGoalId, testObj.id, 'verified_by')
              stats.relations++
            }
          }
        }
        break
      }
    }
  }

  return stats
}

function isTestCommand(command: string): boolean {
  const lower = command.toLowerCase().trim()
  return TEST_COMMANDS.some((tc) => lower.startsWith(tc) || lower.includes(` ${tc}`))
}

export interface ProjectionStats {
  goals: number
  files: number
  patches: number
  testRuns: number
  relations: number
}
