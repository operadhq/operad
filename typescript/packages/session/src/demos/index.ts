/**
 * Demo registry — lazy-loaded demos available via `operad-session demo`.
 *
 * Each entry has a description (shown in --list) and a run() function
 * that dynamically imports the demo module only when invoked.
 *
 * Two types of demos:
 *   - Runtime demos (primitives): use the graph API directly
 *   - Agent demos (coding, insurance, etc.): generate JSONL → commit pipeline
 */

import type { MemoryAdapter } from '@operad/adapter-memory'

export interface DemoOptions {
  interactive?: boolean
}

export interface DemoResult {
  storage: MemoryAdapter
  graphId: string
}

// Helper: lazy-load an agent scenario demo
function agentDemo(
  scenarioName: string,
  scenarioKey: string,
) {
  return async (opts?: DemoOptions) => {
    const [{ runAgentDemo }, scenarios] = await Promise.all([
      import('./agent-demo.js'),
      import('./scenarios.js'),
    ])
    const scenario = (scenarios as Record<string, unknown>)[scenarioKey] as
      import('./session-builder.js').ScenarioConfig
    return runAgentDemo(scenarioName, scenario, opts)
  }
}

export const DEMOS = {
  primitives: {
    description: 'All 7 primitives — actor, relations, views, forking, patches, patterns, LLM',
    run: (opts?: DemoOptions) => import('./primitives.js').then(m => m.run(opts)),
  },
  coding: {
    description: 'Coding agent — building JWT auth with thinking, tool use, and tests',
    run: agentDemo('coding', 'coding'),
  },
  'financial-analyst': {
    description: 'Financial analyst — SaaS revenue analysis, churn, and forecasting',
    run: agentDemo('financial-analyst', 'financialAnalyst'),
  },
  insurance: {
    description: 'Insurance claims — fraud detection, SIU referral, batch processing',
    run: agentDemo('insurance', 'insurance'),
  },
  'customer-support': {
    description: 'Customer support — debugging permissions, fixing code, post-mortems',
    run: agentDemo('customer-support', 'customerSupport'),
  },
  'hedge-fund': {
    description: 'Hedge fund — biotech screening, thesis building, position sizing',
    run: agentDemo('hedge-fund', 'hedgeFund'),
  },
  'research-agent': {
    description: 'Research agent — RAG literature survey, benchmarks, recommendations',
    run: agentDemo('research-agent', 'researchAgent'),
  },
} as const satisfies Record<string, { description: string; run: (opts?: DemoOptions) => Promise<DemoResult> }>

export type DemoName = keyof typeof DEMOS
