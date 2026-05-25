/**
 * @operad/session types
 *
 * Git-flavored vocabulary:
 * - commit   = importing a JSONL into the graph (atomic unit of work)
 * - log      = the event trail of a session
 * - blame    = cost attribution per goal/tool
 * - stash    = wasted work (redundant reads, re-spent tokens)
 */

// ─── JSONL Line Types (raw Claude Code format) ──────────────────────
export type LineType =
  | 'user'
  | 'assistant'
  | 'progress'
  | 'system'
  | 'file-history-snapshot'
  | 'pr-link'
  | 'queue-operation'

export interface JSONLLine {
  uuid: string
  parentUuid?: string
  timestamp: string
  type: LineType
  sessionId: string
  message: JSONLMessage
}

export interface JSONLMessage {
  role: string
  content: string | ContentBlock[]
  usage?: TokenUsage
  model?: string
}

export type BlockType = 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image'

export interface ContentBlock {
  type: BlockType
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | ContentBlock[]
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

// ─── Blame (cost attribution) ───────────────────────────────────────
export interface Blame {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  inputCost: number
  outputCost: number
  cacheSavings: number
  totalCost: number
}

// ─── Stash (wasted work) ────────────────────────────────────────────
export interface Stash {
  redundantReads: number
  tokensWasted: number
  potentialSavings: number
}

// ─── Session Log (the full picture after commit) ────────────────────
export interface SessionLog {
  sessionId: string
  graphId: string
  goals: number
  toolCalls: number
  filesRead: number
  filesEdited: number
  blame: Blame
  stash: Stash
}
