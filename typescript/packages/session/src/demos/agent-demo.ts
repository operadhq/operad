/**
 * Agent demo runner — takes a ScenarioConfig, builds JSONL,
 * commits through the full pipeline, and returns a DemoResult.
 *
 * This is the counterpart to primitives.ts (which uses the runtime API directly).
 * Agent demos exercise: goals, tool calls, thinking traces, causal chains,
 * blame (cost), and stash (wasted work).
 */

import { createInterface } from 'node:readline'
import { createRuntime } from '@operad/core'
import { MemoryAdapter } from '@operad/adapter-memory'
import { commit } from '../session.js'
import { buildSession, type ScenarioConfig } from './session-builder.js'
import type { DemoResult, DemoOptions } from './index.js'

// ─── Terminal helpers (shared style with primitives.ts) ─────────────────────

const isTTY = process.stdout.isTTY ?? false

const s = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
  red: isTTY ? '\x1b[31m' : '',
}

const W = Math.min(process.stdout.columns ?? 60, 70)
const line = (ch = '─') => ch.repeat(W)

function blank() { console.log() }

function banner(title: string, subtitle: string) {
  blank()
  console.log(`${s.bold}${s.cyan}  ◆  O P E R A D${s.reset}`)
  console.log(`${s.bold}  ${title}${s.reset}`)
  console.log(`${s.dim}  ${subtitle}${s.reset}`)
  blank()
  console.log(`  ${s.dim}${line()}${s.reset}`)
}

async function pause(rl: ReturnType<typeof createInterface>) {
  blank()
  await new Promise<void>(resolve => {
    rl.question(`  ${s.dim}↵ Press Enter to continue...${s.reset}`, () => resolve())
  })
}

// ─── Scenario metadata ─────────────────────────────────────────────────────

interface ScenarioMeta {
  title: string
  subtitle: string
  description: string
}

const META: Record<string, ScenarioMeta> = {
  coding: {
    title: 'Coding Agent Session',
    subtitle: 'Building JWT auth in an Express API',
    description: 'A coding agent adding authentication — thinking, reading code, editing files, running tests.',
  },
  'financial-analyst': {
    title: 'Financial Analyst Agent',
    subtitle: 'SaaS portfolio analysis and revenue forecasting',
    description: 'Analyzing revenue trends, churn segmentation, building financial models, and pricing scenarios.',
  },
  insurance: {
    title: 'Insurance Claims Agent',
    subtitle: 'Processing claims with fraud detection',
    description: 'Processing homeowner claims, investigating fraud flags, generating SIU referrals, batch triage.',
  },
  'customer-support': {
    title: 'Customer Support Agent',
    subtitle: 'Debugging permissions, fixing code, writing post-mortems',
    description: 'Investigating a permissions sync bug, fixing the root cause, writing a post-mortem.',
  },
  'hedge-fund': {
    title: 'Hedge Fund Research Agent',
    subtitle: 'Biotech catalyst screening and position sizing',
    description: 'Screening FDA catalysts, building investment theses, sizing positions, running risk reports.',
  },
  'research-agent': {
    title: 'Research Agent',
    subtitle: 'Surveying RAG techniques in 2025',
    description: 'Literature survey, paper analysis, benchmark comparison, and practical recommendations.',
  },
}

// ─── Runner ────────────────────────────────────────────────────────────────

export async function runAgentDemo(
  scenarioName: string,
  scenario: ScenarioConfig,
  opts: DemoOptions = {},
): Promise<DemoResult> {
  const interactive = opts.interactive ?? (isTTY && !process.env.CI)
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null

  const meta = META[scenarioName] ?? {
    title: scenarioName,
    subtitle: 'Agent session demo',
    description: '',
  }

  try {
    banner(meta.title, meta.subtitle)

    if (meta.description) {
      console.log(`  ${s.dim}${meta.description}${s.reset}`)
      blank()
    }

    // ── Build JSONL ──────────────────────────────────────────────────
    const jsonl = buildSession(scenario)
    const lineCount = jsonl.split('\n').length
    console.log(`  ${s.bold}Generated:${s.reset} ${s.yellow}${lineCount}${s.reset} JSONL lines from ${s.yellow}${scenario.goals.length}${s.reset} goals`)

    // ── Commit through pipeline ─────────────────────────────────────
    const storage = new MemoryAdapter()
    const runtime = createRuntime({ storage })
    const graphId = `demo-${scenarioName}`
    await runtime.createGraph(graphId)

    const log = await commit(jsonl, { storage, runtime, graphId })

    console.log(`  ${s.bold}Session:${s.reset}  ${s.cyan}${log.sessionId}${s.reset}`)
    console.log(`  ${s.bold}Goals:${s.reset}    ${s.yellow}${log.goals}${s.reset}`)
    console.log(`  ${s.bold}Tools:${s.reset}    ${s.yellow}${log.toolCalls}${s.reset}`)
    console.log(`  ${s.bold}Cost:${s.reset}     ${s.green}$${log.blame.totalCost.toFixed(2)}${s.reset} (saved $${log.blame.cacheSavings.toFixed(2)} via cache)`)
    console.log(`  ${s.bold}Files:${s.reset}    ${log.filesRead} read, ${log.filesEdited} edited`)

    if (log.stash.redundantReads > 0) {
      console.log(`  ${s.bold}Stash:${s.reset}    ${s.red}${log.stash.redundantReads} redundant reads${s.reset}`)
    }

    if (rl) await pause(rl)

    // ── Show goal trace ─────────────────────────────────────────────
    blank()
    console.log(`  ${s.bold}Goal trace:${s.reset}`)
    console.log(`  ${s.dim}${line()}${s.reset}`)

    const events = await storage.queryEvents(graphId, {})
    const goals = events.filter(e => e.type === 'goal.set')

    for (let i = 0; i < goals.length; i++) {
      const goal = goals[i]
      const text = (goal.payload.text as string) ?? '(no text)'
      const toolsInGoal = events.filter(
        e => e.type === 'custom.tool_called' && e.causedBy === goal.id
      )
      // Count tools between this goal and the next
      const goalIdx = events.indexOf(goal)
      const nextGoalIdx = i < goals.length - 1 ? events.indexOf(goals[i + 1]) : events.length
      const toolsBetween = events.slice(goalIdx, nextGoalIdx).filter(e => e.type === 'custom.tool_called')

      const num = `${i + 1}`.padStart(2)
      console.log(`  ${s.cyan}${num}.${s.reset} ${s.bold}${text.slice(0, 60)}${s.reset}`)
      console.log(`      ${s.dim}${toolsBetween.length} tool calls${toolsInGoal.length > 0 ? ` (${toolsInGoal.length} direct)` : ''}${s.reset}`)
    }

    if (rl) await pause(rl)

    // ── Outro ────────────────────────────────────────────────────────
    blank()
    console.log(`  ${s.dim}${line()}${s.reset}`)
    blank()
    console.log(`  ${s.bold}${s.green}◆ Demo complete.${s.reset}`)
    console.log(`  ${s.dim}Full pipeline: JSONL → parse → commit → blame → stash${s.reset}`)
    console.log(`  ${s.dim}Use --html to see the interactive timeline viewer.${s.reset}`)
    blank()

    return { storage, graphId }
  } finally {
    rl?.close()
  }
}
