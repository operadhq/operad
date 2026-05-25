import type { BehaviorDef, LLMBehaviorDef, LLMProvider, GraphView } from './types.js'
import { resolveView } from './view.js'

/**
 * Simple hash for caching LLM responses by prompt content.
 */
function hashPrompt(prompt: string): string {
  let hash = 0
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return `prompt_${hash}`
}

/**
 * Create an LLM-backed behavior. Returns a standard BehaviorDef (composition).
 *
 * Features:
 * - Provider injection (no AI SDK bundled in core)
 * - Caching by prompt hash
 * - Emits llm.requested and llm.responded events for observability
 * - Automatic view resolution if view spec provided
 * - Optional onResponse callback for post-processing
 */
export function llmBehavior(def: LLMBehaviorDef, provider: LLMProvider): BehaviorDef {
  const cache = new Map<string, string>()

  return {
    name: def.name,
    on: def.on,
    where: def.where,
    view: def.view,
    handler: async (event, graph, ctx) => {
      // Resolve the prompt (static string or dynamic function)
      const prompt =
        typeof def.prompt === 'function'
          ? def.prompt(event, ctx.view)
          : def.prompt

      // Check cache
      const cacheKey = hashPrompt(prompt)
      const cached = cache.get(cacheKey)

      if (cached) {
        // Still emit events for observability
        await ctx.emit({
          type: 'llm.responded',
          payload: {
            behaviorName: def.name,
            model: def.model,
            text: cached,
            cached: true,
          },
        })

        if (def.onResponse) {
          await def.onResponse(cached, event, graph, ctx)
        }
        return
      }

      // Emit llm.requested
      await ctx.emit({
        type: 'llm.requested',
        payload: {
          behaviorName: def.name,
          model: def.model,
          promptLength: prompt.length,
        },
      })

      // Call provider
      const response = await provider.complete({
        model: def.model,
        prompt,
        tools: def.tools,
      })

      // Cache the response
      cache.set(cacheKey, response.text)

      // Emit llm.responded
      await ctx.emit({
        type: 'llm.responded',
        payload: {
          behaviorName: def.name,
          model: def.model,
          text: response.text,
          cached: false,
          ...(response.usage && {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
          }),
        },
      })

      // Call onResponse callback if provided
      if (def.onResponse) {
        await def.onResponse(response.text, event, graph, ctx)
      }
    },
  }
}
