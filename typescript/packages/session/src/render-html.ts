/**
 * HTML graph renderer — Timeline + Tree split-panel visualization.
 *
 * Generates a self-contained HTML file (~18KB) with no external dependencies.
 * Left panel: chronological goal list with replay controls.
 * Right panel: selected goal's tree with fork markers.
 *
 * Pure function — no I/O. Caller writes the file and opens the browser.
 */
import type { RenderableObject, RenderableRelation, GraphEvent } from '@operad/core'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiffEntry {
  objectId: string
  type: string
  status: 'added' | 'removed' | 'modified'
  data?: Record<string, unknown>
  sourceData?: Record<string, unknown>
  targetData?: Record<string, unknown>
}

export interface BranchInfo {
  /** Goal ID where the branch was created */
  forkGoalId: string
  /** Human label for the branch */
  branchLabel: string
  /** Object diffs between source and branch */
  diffs: DiffEntry[]
  /** Event count on source after fork */
  sourceEventsAfterFork: number
  /** Event count on branch after fork */
  branchEventsAfterFork: number
}

export interface RenderHtmlOptions {
  /** Title shown in the page header */
  title?: string
  /** Branch/diff data to embed for interactive diff view */
  branch?: BranchInfo
}

// ─── Node Colors ─────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; font: string }> = {
  goal:     { bg: '#2B5CE6', border: '#1A3FA0', font: '#FFFFFF' },
  file:     { bg: '#2EA043', border: '#1B7A30', font: '#FFFFFF' },
  patch:    { bg: '#E07020', border: '#B85A18', font: '#FFFFFF' },
  test_run: { bg: '#8B5CF6', border: '#6D3FD0', font: '#FFFFFF' },
}

const DEFAULT_COLOR = { bg: '#6B7280', border: '#4B5563', font: '#FFFFFF' }

// ─── Node Icons ──────────────────────────────────────────────────────────────

const NODE_ICONS: Record<string, string> = {
  goal: '★',
  file: '📄',
  patch: '✏️',
  test_run: '🧪',
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Render objects + relations into a self-contained HTML string.
 * Split panel: goals list on left, selected goal's tree on right.
 */
export function renderHtmlGraph(
  objects: RenderableObject[],
  relations: RenderableRelation[],
  options?: RenderHtmlOptions,
): string {
  const title = options?.title ?? 'Operad Session Graph'

  // Build goal → children map with edge labels
  const goalChildren: Record<string, Array<{ targetId: string; edgeLabel: string }>> = {}
  for (const rel of relations) {
    const sourceNode = objects.find((o) => o.id === rel.sourceId)
    if (sourceNode?.type === 'goal') {
      if (!goalChildren[rel.sourceId]) goalChildren[rel.sourceId] = []
      goalChildren[rel.sourceId].push({ targetId: rel.targetId, edgeLabel: rel.type })
    }
  }

  // Build node data for client
  const nodeData: Record<string, { id: string; type: string; label: string; tooltip: string }> = {}
  for (const obj of objects) {
    nodeData[obj.id] = {
      id: obj.id,
      type: obj.type,
      label: buildNodeLabel(obj),
      tooltip: buildNodeTooltip(obj),
    }
  }

  // Extract goals in order
  const goals = objects.filter((o) => o.type === 'goal')

  // Stats
  const stats = {
    total: objects.length,
    goals: goals.length,
    files: objects.filter((o) => o.type === 'file').length,
    patches: objects.filter((o) => o.type === 'patch').length,
    testRuns: objects.filter((o) => o.type === 'test_run').length,
    relations: relations.length,
  }

  return buildHtml(title, goals, goalChildren, nodeData, stats, options?.branch ?? null)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    const s = d.getSeconds().toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  } catch { return '' }
}

function buildNodeLabel(obj: RenderableObject): string {
  switch (obj.type) {
    case 'goal': {
      const text = (obj.data.text as string) ?? ''
      return text.length > 60 ? text.slice(0, 57) + '...' : text
    }
    case 'file':
      return (obj.data.path as string) ?? obj.id
    case 'patch':
      return (obj.data.file as string) ?? obj.id
    case 'test_run':
      return ((obj.data.command as string) ?? '').slice(0, 50)
    default:
      return `${obj.type}: ${obj.id.slice(0, 12)}`
  }
}

function buildNodeTooltip(obj: RenderableObject): string {
  const lines = [`Type: ${obj.type}`, `ID: ${obj.id}`]
  for (const [k, v] of Object.entries(obj.data)) {
    if (k.startsWith('_')) continue
    const val = typeof v === 'string' ? v.slice(0, 120) : JSON.stringify(v)
    lines.push(`${k}: ${val}`)
  }
  return lines.join('\n')
}

// ─── HTML Template ───────────────────────────────────────────────────────────

function buildHtml(
  title: string,
  goals: RenderableObject[],
  goalChildren: Record<string, Array<{ targetId: string; edgeLabel: string }>>,
  nodeData: Record<string, { id: string; type: string; label: string; tooltip: string }>,
  stats: Record<string, number>,
  branch: BranchInfo | null,
): string {
  // Build goal list HTML server-side
  const goalListHtml = goals.map((g, i) => {
    const text = buildNodeLabel(g)
    const childCount = goalChildren[g.id]?.length ?? 0
    const countBadge = childCount > 0 ? `<span class="child-count">${childCount}</span>` : ''
    const ts = formatTimestamp(g.data._createdAt as string | undefined)
    const timeBadge = ts ? `<span class="goal-time">${escapeHtml(ts)}</span>` : ''
    return `<div class="goal-item" data-id="${escapeHtml(g.id)}" data-index="${i}"><span class="goal-num">#${i + 1}</span><span class="goal-icon">★</span><span class="goal-mid"><span class="goal-text">${escapeHtml(text)}</span>${timeBadge}</span>${countBadge}<button class="fork-btn" title="Mark fork point" data-id="${escapeHtml(g.id)}">⑂</button></div>`
  }).join('\n      ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a2e; color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    height: 100vh; overflow: hidden;
  }

  /* Top toolbar */
  .toolbar {
    height: 44px; background: #12122a; border-bottom: 1px solid #2a2a4a;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px; flex-shrink: 0;
  }
  .toolbar-left { display: flex; align-items: center; gap: 12px; }
  .toolbar-center { display: flex; align-items: center; gap: 8px; }
  .toolbar-right { display: flex; align-items: center; gap: 8px; }

  .toolbar .brand {
    font-size: 12px; color: #555; text-decoration: none;
    transition: color 0.15s;
  }
  .toolbar .brand:hover { color: #88aaff; }
  .toolbar .brand span { color: #88aaff; font-weight: 600; }

  .toolbar .session-info {
    font-size: 12px; color: #666;
  }
  .toolbar .session-info .val { color: #aaa; }

  .tb-btn {
    background: transparent; border: 1px solid #333;
    color: #aaa; padding: 4px 12px; border-radius: 4px;
    cursor: pointer; font-size: 12px; transition: all 0.15s;
    display: flex; align-items: center; gap: 5px;
  }
  .tb-btn:hover { border-color: #555; color: #fff; background: #1e1e3a; }
  .tb-btn.active { border-color: #2B5CE6; color: #88aaff; }
  .tb-btn svg { width: 14px; height: 14px; }

  /* Replay scrubber */
  .replay-bar {
    display: none; height: 36px; background: #12122a;
    border-bottom: 1px solid #2a2a4a;
    align-items: center; padding: 0 16px; gap: 12px;
  }
  .replay-bar.visible { display: flex; }
  .replay-bar input[type="range"] {
    flex: 1; accent-color: #2B5CE6; cursor: pointer;
  }
  .replay-bar .replay-label {
    font-size: 11px; color: #666; min-width: 60px;
    font-variant-numeric: tabular-nums;
  }
  .replay-bar .replay-speed {
    font-size: 11px; color: #555; padding: 2px 6px;
    border: 1px solid #333; border-radius: 3px; cursor: pointer;
    background: transparent;
  }
  .replay-bar .replay-speed:hover { color: #aaa; border-color: #555; }

  /* Main layout */
  .main { display: flex; flex: 1; overflow: hidden; }
  .wrapper { display: flex; flex-direction: column; height: 100vh; }

  /* Left panel — goal timeline */
  .left-panel {
    width: 30%; min-width: 280px; max-width: 400px;
    border-right: 1px solid #2a2a4a;
    display: flex; flex-direction: column;
    background: #16162b;
  }

  .panel-header {
    padding: 14px 16px 10px;
    border-bottom: 1px solid #2a2a4a;
    flex-shrink: 0;
  }
  .panel-header h1 {
    font-size: 14px; color: #88aaff;
    margin-bottom: 4px; font-weight: 600;
  }
  .panel-header .stats {
    font-size: 12px; color: #888;
  }
  .panel-header .stats .val { color: #ccc; font-weight: 600; }

  .goal-list {
    flex: 1; overflow-y: auto; padding: 8px;
  }
  .goal-list::-webkit-scrollbar { width: 6px; }
  .goal-list::-webkit-scrollbar-track { background: transparent; }
  .goal-list::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

  .goal-item {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; margin: 2px 0;
    border-radius: 6px; cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease;
    font-size: 13px;
    position: relative;
  }
  .goal-item:hover { background: #1e1e3a; border-color: #333; }
  .goal-item.active {
    background: #1a2a4a; border-color: #2B5CE6;
    box-shadow: 0 0 0 1px rgba(43, 92, 230, 0.3);
  }
  .goal-item.forked {
    border-color: #E07020;
    box-shadow: 0 0 0 1px rgba(224, 112, 32, 0.3);
  }
  .goal-item.forked::after {
    content: '⑂ fork point';
    position: absolute; top: -8px; right: 8px;
    font-size: 9px; color: #E07020; background: #16162b;
    padding: 0 4px; letter-spacing: 0.5px;
  }
  .goal-item.dimmed { opacity: 0.3; }
  .goal-num { color: #555; font-size: 11px; min-width: 24px; font-variant-numeric: tabular-nums; }
  .goal-icon { color: #2B5CE6; flex-shrink: 0; }
  .goal-mid { flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 2px; }
  .goal-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ddd; }
  .goal-time { font-size: 10px; color: #555; font-family: 'SF Mono', Monaco, monospace; font-variant-numeric: tabular-nums; }
  .child-count {
    background: #2a2a4a; color: #888; font-size: 11px;
    padding: 1px 6px; border-radius: 10px; flex-shrink: 0;
  }
  .fork-btn {
    background: none; border: none; color: #444; cursor: pointer;
    font-size: 14px; padding: 2px; border-radius: 3px;
    opacity: 0; transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .goal-item:hover .fork-btn { opacity: 1; }
  .fork-btn:hover { color: #E07020; }

  /* Right panel — tree view */
  .right-panel {
    flex: 1; display: flex; flex-direction: column;
    overflow: hidden;
  }

  .tree-header {
    padding: 14px 24px 10px;
    border-bottom: 1px solid #2a2a4a;
    flex-shrink: 0;
  }
  .tree-header h2 {
    font-size: 15px; color: #fff; font-weight: 600;
    display: flex; align-items: center; gap: 8px;
  }
  .tree-header .tree-stats {
    font-size: 12px; color: #666; margin-top: 4px;
  }

  .tree-content {
    flex: 1; overflow-y: auto; padding: 20px 24px;
  }
  .tree-content::-webkit-scrollbar { width: 6px; }
  .tree-content::-webkit-scrollbar-track { background: transparent; }
  .tree-content::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

  .tree-empty {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: #555; font-size: 14px;
  }

  /* Tree nodes */
  .tree-root { padding-left: 0; }
  .tree-node {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; margin: 4px 0;
    border-radius: 6px; position: relative;
    transition: background 0.1s;
  }
  .tree-node:hover { background: rgba(255,255,255,0.03); }
  .tree-node .node-icon { flex-shrink: 0; font-size: 14px; }
  .tree-node .node-label {
    flex: 1; font-size: 13px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tree-node .edge-label {
    font-size: 11px; color: #666; padding: 2px 8px;
    background: #1a1a2e; border-radius: 4px; flex-shrink: 0;
  }

  /* Node type colors */
  .tree-node[data-type="file"] .node-label { color: #4ade80; }
  .tree-node[data-type="patch"] .node-label { color: #fb923c; }
  .tree-node[data-type="test_run"] .node-label { color: #a78bfa; }
  .tree-node[data-type="goal"] .node-label { color: #60a5fa; }

  /* Connector lines */
  .tree-children {
    margin-left: 20px; padding-left: 16px;
    border-left: 1px solid #2a2a4a;
  }

  /* Tooltip */
  .tooltip {
    display: none; position: fixed;
    background: #0d0d1a; border: 1px solid #333;
    border-radius: 6px; padding: 10px 12px;
    font-size: 11px; max-width: 400px; z-index: 100;
    white-space: pre-wrap; word-break: break-all;
    color: #aaa; line-height: 1.5;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  }

  /* Toast notification */
  .toast {
    position: fixed; bottom: 20px; left: 50%;
    transform: translateX(-50%) translateY(60px);
    background: #2B5CE6; color: #fff;
    padding: 8px 20px; border-radius: 6px;
    font-size: 13px; opacity: 0;
    transition: all 0.3s ease; z-index: 200;
    pointer-events: none;
  }
  .toast.show {
    opacity: 1; transform: translateX(-50%) translateY(0);
  }

  /* Legend */
  .legend {
    padding: 10px 16px; border-top: 1px solid #2a2a4a;
    display: flex; gap: 12px; flex-wrap: wrap;
    font-size: 11px; color: #666; flex-shrink: 0;
  }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; }

  /* Diff panel */
  .diff-panel {
    display: none; flex-direction: column;
    border-left: 1px solid #2a2a4a; width: 320px;
    background: #14142a; flex-shrink: 0;
  }
  .diff-panel.visible { display: flex; }
  .diff-header {
    padding: 14px 16px 10px;
    border-bottom: 1px solid #2a2a4a; flex-shrink: 0;
  }
  .diff-header h3 { font-size: 13px; color: #E07020; font-weight: 600; }
  .diff-header .diff-stats { font-size: 11px; color: #666; margin-top: 4px; }

  .diff-list {
    flex: 1; overflow-y: auto; padding: 8px;
  }
  .diff-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; margin: 2px 0;
    border-radius: 4px; font-size: 12px;
    font-family: 'SF Mono', Monaco, monospace;
  }
  .diff-item .diff-status {
    font-size: 10px; padding: 1px 6px; border-radius: 3px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .diff-item .diff-status.added { background: #1a3a1a; color: #4ade80; }
  .diff-item .diff-status.removed { background: #3a1a1a; color: #f87171; }
  .diff-item .diff-status.modified { background: #3a2a1a; color: #fbbf24; }
  .diff-item .diff-label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #aaa;
  }
  .diff-item .diff-type { color: #555; font-size: 10px; flex-shrink: 0; }

  .diff-summary {
    padding: 10px 16px; border-top: 1px solid #2a2a4a;
    font-size: 11px; color: #555; flex-shrink: 0;
  }

  /* Subscribe banner */
  .subscribe-banner {
    background: linear-gradient(90deg, #1a1040 0%, #12122a 100%);
    border-bottom: 1px solid #2a2a4a;
    padding: 10px 16px;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 13px; color: #9090b0;
    flex-shrink: 0;
  }
  .subscribe-banner.hidden { display: none; }
  .subscribe-banner { animation: slideBannerIn 0.3s ease-out; }
  @keyframes slideBannerIn { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: translateY(0); } }
  .subscribe-text { display: flex; align-items: center; gap: 8px; }
  .subscribe-text strong { color: #c0c0e0; font-weight: 500; }
  .subscribe-form { display: flex; gap: 8px; align-items: center; }
  .subscribe-form input[type="email"] {
    background: #0c0a1d; border: 1px solid #2a2a4a; border-radius: 4px;
    color: #e0e0e0; padding: 5px 10px; font-size: 12px; width: 220px;
    outline: none; transition: border-color 0.15s;
  }
  .subscribe-form input[type="email"]:focus { border-color: #4a6cf7; }
  .subscribe-form input[type="email"]::placeholder { color: #555; }
  .subscribe-btn {
    background: #2B5CE6; color: #fff; border: none; border-radius: 4px;
    padding: 5px 14px; font-size: 12px; cursor: pointer; font-weight: 500;
    transition: background 0.15s;
  }
  .subscribe-btn:hover { background: #3d6ef7; }
  .subscribe-btn:disabled { opacity: 0.6; cursor: default; }
  .subscribe-dismiss {
    background: none; border: none; color: #555; cursor: pointer;
    font-size: 16px; padding: 0 4px; line-height: 1;
  }
  .subscribe-dismiss:hover { color: #888; }
  .subscribe-ok { color: #4ade80; font-size: 12px; }

  /* Feedback panel */
  .fb-overlay { display: none; position: fixed; inset: 0; z-index: 999; }
  .fb-overlay.open { display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); }
  .fb-panel {
    background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 8px;
    width: 400px; max-width: 90vw; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: fbIn 0.2s ease-out;
  }
  @keyframes fbIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  .fb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .fb-header h3 { margin: 0; font-size: 14px; color: #e0e0e0; font-weight: 500; }
  .fb-close { background: none; border: none; color: #555; cursor: pointer; font-size: 18px; padding: 0; }
  .fb-close:hover { color: #888; }
  .fb-tabs { display: flex; gap: 0; margin-bottom: 14px; border-bottom: 1px solid #2a2a4a; }
  .fb-tab {
    padding: 6px 14px; font-size: 12px; color: #666; cursor: pointer;
    border-bottom: 2px solid transparent; transition: all 0.15s; background: none; border-top: none; border-left: none; border-right: none;
  }
  .fb-tab:hover { color: #aaa; }
  .fb-tab.active { color: #88aaff; border-bottom-color: #88aaff; }
  .fb-textarea {
    width: 100%; min-height: 80px; background: #0c0a1d; border: 1px solid #2a2a4a;
    border-radius: 4px; color: #e0e0e0; padding: 8px 10px; font-size: 13px;
    font-family: inherit; resize: vertical; outline: none; transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .fb-textarea:focus { border-color: #4a6cf7; }
  .fb-textarea::placeholder { color: #555; }
  .fb-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .fb-submit {
    background: #2B5CE6; color: #fff; border: none; border-radius: 4px;
    padding: 6px 16px; font-size: 12px; cursor: pointer; font-weight: 500;
    transition: background 0.15s;
  }
  .fb-submit:hover { background: #3d6ef7; }
  .fb-submit:disabled { opacity: 0.6; cursor: default; }
  .fb-hint { font-size: 11px; color: #555; margin-top: 8px; }

  /* Responsive */
  @media (max-width: 768px) {
    .main { flex-direction: column; }
    .left-panel { width: 100%; max-width: none; height: 40%; min-width: auto; border-right: none; border-bottom: 1px solid #2a2a4a; }
    .right-panel { height: 60%; }
    .toolbar { padding: 0 8px; }
    .toolbar .session-info { display: none; }
    .subscribe-banner { flex-direction: column; gap: 8px; text-align: center; }
    .subscribe-form input[type="email"] { width: 160px; }
  }
</style>
</head>
<body>

<div class="wrapper">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <a class="brand" href="https://github.com/operadhq/operad" target="_blank" rel="noopener"><span>operad</span> session graph</a>
      <span class="session-info">
        <span class="val">${stats.goals}</span> goals · <span class="val">${stats.total}</span> nodes · <span class="val">${stats.relations}</span> edges
      </span>
    </div>
    <div class="toolbar-center">
      <button class="tb-btn" id="btn-replay" title="Replay through goals sequentially">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="4,2 14,8 4,14" fill="currentColor" stroke="none"/></svg>
        Replay
      </button>
    </div>
    <div class="toolbar-right">
      <button class="tb-btn" id="btn-download" title="Download this HTML file">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10"/></svg>
        Save
      </button>
      <button class="tb-btn" id="btn-share" title="Copy shareable link">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 8.5a3 3 0 004.5.5l2-2a3 3 0 00-4.24-4.24l-1.14 1.14"/><path d="M10 7.5a3 3 0 00-4.5-.5l-2 2a3 3 0 004.24 4.24l1.14-1.14"/></svg>
        Share
      </button>
      <button class="tb-btn" id="btn-feedback" title="Send feedback">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h12v8H5l-3 3V3z"/></svg>
        Feedback
      </button>
    </div>
  </div>

  <!-- Feedback modal -->
  <div class="fb-overlay" id="fb-overlay">
    <div class="fb-panel">
      <div class="fb-header">
        <h3>Feedback</h3>
        <button class="fb-close" id="fb-close">&times;</button>
      </div>
      <div class="fb-tabs">
        <button class="fb-tab active" data-fb-type="comment">Session comment</button>
        <button class="fb-tab" data-fb-type="feedback">Product feedback</button>
      </div>
      <textarea class="fb-textarea" id="fb-text" placeholder="What do you think about this session?"></textarea>
      <div class="fb-hint" id="fb-hint">Comments are attached to this session.</div>
      <div class="fb-footer">
        <button class="fb-submit" id="fb-submit">Send</button>
      </div>
    </div>
  </div>

  <!-- Subscribe banner -->
  <div class="subscribe-banner hidden" id="subscribe-banner">
    <div class="subscribe-text">
      <strong>Trace your own agent sessions</strong>
      <span>— get notified when Operad launches.</span>
    </div>
    <div class="subscribe-form">
      <input type="email" id="subscribe-email" placeholder="you@company.com" autocomplete="email" />
      <button class="subscribe-btn" id="subscribe-btn">Notify me</button>
      <button class="subscribe-dismiss" id="subscribe-dismiss" title="Dismiss">&times;</button>
    </div>
  </div>

  <!-- Replay bar (hidden by default) -->
  <div class="replay-bar" id="replay-bar">
    <button class="tb-btn" id="btn-replay-toggle" style="padding:4px 8px" title="Play / Pause">▶</button>
    <input type="range" id="replay-scrubber" min="0" max="${Math.max(0, stats.goals - 1)}" value="0">
    <span class="replay-label" id="replay-label">1 / ${stats.goals}</span>
    <button class="replay-speed" id="replay-speed" title="Playback speed">1×</button>
  </div>

  <!-- Main content -->
  <div class="main">
    <div class="left-panel">
      <div class="panel-header">
        <h1>${escapeHtml(title)}</h1>
        <div class="stats">
          <span class="val">${stats.goals}</span> goals · <span class="val">${stats.files}</span> files · <span class="val">${stats.patches}</span> patches · <span class="val">${stats.testRuns}</span> tests
        </div>
      </div>
      <div class="goal-list" id="goal-list">
        ${goalListHtml}
      </div>
      <div class="legend">
        <div class="legend-item"><div class="legend-dot" style="background:#2B5CE6"></div> Goal</div>
        <div class="legend-item"><div class="legend-dot" style="background:#2EA043"></div> File</div>
        <div class="legend-item"><div class="legend-dot" style="background:#E07020"></div> Patch</div>
        <div class="legend-item"><div class="legend-dot" style="background:#8B5CF6"></div> Test</div>
      </div>
    </div>

    <div class="right-panel">
      <div class="tree-header">
        <h2 id="tree-title">Select a goal</h2>
        <div class="tree-stats" id="tree-stats"></div>
      </div>
      <div class="tree-content" id="tree-content">
        <div class="tree-empty">← Click a goal to view its dependency tree</div>
      </div>
    </div>

    <!-- Diff panel (hidden until branch data + fork click) -->
    <div class="diff-panel" id="diff-panel">
      <div class="diff-header">
        <h3>⑂ Branch Diff</h3>
        <div class="diff-stats" id="diff-stats"></div>
      </div>
      <div class="diff-list" id="diff-list"></div>
      <div class="diff-summary" id="diff-summary"></div>
    </div>
  </div>
</div>

<div class="tooltip" id="tooltip"></div>
<div class="toast" id="toast"></div>

<script>
(function() {
  var goalChildren = ${JSON.stringify(goalChildren)};
  var nodeData = ${JSON.stringify(nodeData)};
  var branchData = ${JSON.stringify(branch)};
  var icons = { goal: '★', file: '📄', patch: '✏️', test_run: '🧪' };
  var totalGoals = ${stats.goals};

  var goalItems = document.querySelectorAll('.goal-item');
  var treeTitle = document.getElementById('tree-title');
  var treeStats = document.getElementById('tree-stats');
  var treeContent = document.getElementById('tree-content');
  var tooltip = document.getElementById('tooltip');
  var toast = document.getElementById('toast');

  var selectedId = null;
  var forkPointId = null;

  // ─── Toast ──────────────────────────────────────────────
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 2000);
  }

  // ─── Select Goal ────────────────────────────────────────
  function selectGoal(goalId) {
    selectedId = goalId;
    for (var i = 0; i < goalItems.length; i++) {
      goalItems[i].classList.toggle('active', goalItems[i].getAttribute('data-id') === goalId);
    }

    var node = nodeData[goalId];
    if (!node) return;

    treeTitle.innerHTML = '<span style="color:#2B5CE6">★</span> ' + escapeHtml(node.label);
    var children = goalChildren[goalId] || [];

    var counts = { file: 0, patch: 0, test_run: 0 };
    for (var i = 0; i < children.length; i++) {
      var child = nodeData[children[i].targetId];
      if (child && counts[child.type] !== undefined) counts[child.type]++;
    }

    var statParts = [];
    if (counts.file > 0) statParts.push(counts.file + ' file' + (counts.file > 1 ? 's' : ''));
    if (counts.patch > 0) statParts.push(counts.patch + ' patch' + (counts.patch > 1 ? 'es' : ''));
    if (counts.test_run > 0) statParts.push(counts.test_run + ' test' + (counts.test_run > 1 ? 's' : ''));
    treeStats.textContent = statParts.length > 0 ? statParts.join(' · ') : 'No children';

    if (children.length === 0) {
      treeContent.innerHTML = '<div class="tree-empty">This goal has no connected nodes</div>';
      return;
    }

    var html = '<div class="tree-root"><div class="tree-children">';
    for (var i = 0; i < children.length; i++) {
      var edge = children[i];
      var child = nodeData[edge.targetId];
      if (!child) continue;
      var icon = icons[child.type] || '●';
      html += '<div class="tree-node" data-type="' + child.type + '" data-id="' + child.id + '">';
      html += '<span class="edge-label">' + escapeHtml(edge.edgeLabel) + '</span>';
      html += '<span class="node-icon">' + icon + '</span>';
      html += '<span class="node-label">' + escapeHtml(child.label) + '</span>';
      html += '</div>';
    }
    html += '</div></div>';
    treeContent.innerHTML = html;
  }

  // ─── Fork Point + Diff ───────────────────────────────────
  var diffPanel = document.getElementById('diff-panel');
  var diffList = document.getElementById('diff-list');
  var diffStats = document.getElementById('diff-stats');
  var diffSummary = document.getElementById('diff-summary');

  function setForkPoint(goalId) {
    if (forkPointId === goalId) {
      forkPointId = null;
      for (var i = 0; i < goalItems.length; i++) {
        goalItems[i].classList.remove('forked', 'dimmed');
      }
      diffPanel.classList.remove('visible');
      showToast('Fork point cleared');
      return;
    }

    forkPointId = goalId;
    var foundFork = false;
    for (var i = 0; i < goalItems.length; i++) {
      var id = goalItems[i].getAttribute('data-id');
      goalItems[i].classList.remove('forked', 'dimmed');
      if (id === goalId) {
        goalItems[i].classList.add('forked');
        foundFork = true;
      } else if (foundFork) {
        goalItems[i].classList.add('dimmed');
      }
    }

    var goalNum = parseInt(document.querySelector('[data-id="' + goalId + '"]').getAttribute('data-index')) + 1;

    // Show diff panel if branch data matches this fork point
    if (branchData && branchData.forkGoalId === goalId) {
      renderDiffPanel(branchData);
      showToast('Fork point #' + goalNum + ' — diff loaded (' + branchData.diffs.length + ' changes)');
    } else if (branchData) {
      // Branch exists but at a different goal — still show fork marker
      diffPanel.classList.remove('visible');
      showToast('Fork point set at #' + goalNum + ' (branch data at different goal)');
    } else {
      diffPanel.classList.remove('visible');
      showToast('Fork point set at #' + goalNum + ' — run branch() to see diff');
    }
  }

  function renderDiffPanel(branch) {
    diffPanel.classList.add('visible');

    var added = 0, removed = 0, modified = 0;
    var html = '';

    for (var i = 0; i < branch.diffs.length; i++) {
      var d = branch.diffs[i];
      if (d.status === 'added') added++;
      else if (d.status === 'removed') removed++;
      else modified++;

      var label = d.data ? summarizeDiffData(d.data) : d.objectId.slice(0, 16);
      html += '<div class="diff-item">';
      html += '<span class="diff-status ' + d.status + '">' + d.status + '</span>';
      html += '<span class="diff-type">' + d.type + '</span>';
      html += '<span class="diff-label" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</span>';
      html += '</div>';
    }

    diffList.innerHTML = html || '<div style="padding:16px;color:#555;font-size:12px">No differences</div>';

    diffStats.innerHTML = branch.branchLabel +
      '<br>' + added + ' added · ' + removed + ' removed · ' + modified + ' modified';

    diffSummary.innerHTML =
      'Source: ' + branch.sourceEventsAfterFork + ' events after fork<br>' +
      'Branch: ' + branch.branchEventsAfterFork + ' events after fork';
  }

  function summarizeDiffData(data) {
    if (!data) return '?';
    if (data.text) return String(data.text).slice(0, 40);
    if (data.path) return String(data.path);
    if (data.file) return String(data.file);
    if (data.command) return String(data.command).slice(0, 40);
    var keys = Object.keys(data);
    return keys.slice(0, 2).join(', ');
  }

  // ─── Replay ─────────────────────────────────────────────
  var replayBar = document.getElementById('replay-bar');
  var replayBtn = document.getElementById('btn-replay');
  var replayToggle = document.getElementById('btn-replay-toggle');
  var scrubber = document.getElementById('replay-scrubber');
  var replayLabel = document.getElementById('replay-label');
  var speedBtn = document.getElementById('replay-speed');
  var replayActive = false;
  var replayPlaying = false;
  var replayTimer = null;
  var replayIndex = 0;
  var speeds = [1, 2, 4, 0.5];
  var speedIndex = 0;

  replayBtn.addEventListener('click', function() {
    replayActive = !replayActive;
    replayBar.classList.toggle('visible', replayActive);
    replayBtn.classList.toggle('active', replayActive);
    if (replayActive) {
      replayIndex = 0;
      scrubber.value = 0;
      updateReplayLabel();
      if (goalItems.length > 0) selectGoal(goalItems[0].getAttribute('data-id'));
    } else {
      stopReplay();
    }
  });

  replayToggle.addEventListener('click', function() {
    if (replayPlaying) {
      stopReplay();
    } else {
      startReplay();
    }
  });

  scrubber.addEventListener('input', function() {
    replayIndex = parseInt(this.value);
    updateReplayLabel();
    if (goalItems[replayIndex]) {
      selectGoal(goalItems[replayIndex].getAttribute('data-id'));
      goalItems[replayIndex].scrollIntoView({ block: 'nearest' });
    }
  });

  speedBtn.addEventListener('click', function() {
    speedIndex = (speedIndex + 1) % speeds.length;
    speedBtn.textContent = speeds[speedIndex] + '×';
    if (replayPlaying) { stopReplay(); startReplay(); }
  });

  function startReplay() {
    replayPlaying = true;
    replayToggle.textContent = '⏸';
    advanceReplay();
  }

  function stopReplay() {
    replayPlaying = false;
    replayToggle.textContent = '▶';
    if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
  }

  function advanceReplay() {
    if (!replayPlaying || replayIndex >= totalGoals) {
      stopReplay();
      return;
    }
    if (goalItems[replayIndex]) {
      selectGoal(goalItems[replayIndex].getAttribute('data-id'));
      goalItems[replayIndex].scrollIntoView({ block: 'nearest' });
      scrubber.value = replayIndex;
      updateReplayLabel();
    }
    replayIndex++;
    replayTimer = setTimeout(advanceReplay, 1200 / speeds[speedIndex]);
  }

  function updateReplayLabel() {
    replayLabel.textContent = (parseInt(scrubber.value) + 1) + ' / ' + totalGoals;
  }

  // ─── Share & Download ───────────────────────────────────
  document.getElementById('btn-share').addEventListener('click', function() {
    // Copy the current page URL or the full HTML as a blob URL
    if (window.location.protocol === 'file:') {
      // File URL — create a blob URL the user can bookmark
      var blob = new Blob([document.documentElement.outerHTML], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      // Try clipboard
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href).then(function() {
          showToast('File path copied to clipboard');
        }).catch(function() {
          showToast('File: ' + window.location.href.replace('file://', ''));
        });
      } else {
        showToast('File: ' + window.location.href.replace('file://', ''));
      }
    } else {
      navigator.clipboard.writeText(window.location.href).then(function() {
        showToast('Link copied to clipboard');
      });
    }
  });

  document.getElementById('btn-download').addEventListener('click', function() {
    var html = '<!DOCTYPE html>' + document.documentElement.outerHTML;
    var blob = new Blob([html], { type: 'text/html' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'operad-session-graph.html';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Downloaded operad-session-graph.html');
  });

  // ─── Click Handlers ─────────────────────────────────────
  document.getElementById('goal-list').addEventListener('click', function(e) {
    var forkBtn = e.target.closest('.fork-btn');
    if (forkBtn) {
      e.stopPropagation();
      setForkPoint(forkBtn.getAttribute('data-id'));
      return;
    }
    var item = e.target.closest('.goal-item');
    if (item) selectGoal(item.getAttribute('data-id'));
  });

  // Auto-select first goal
  if (goalItems.length > 0) {
    selectGoal(goalItems[0].getAttribute('data-id'));
  }

  // ─── Tooltip ────────────────────────────────────────────
  treeContent.addEventListener('mouseover', function(e) {
    var node = e.target.closest('.tree-node');
    if (!node) { tooltip.style.display = 'none'; return; }
    var id = node.getAttribute('data-id');
    var data = nodeData[id];
    if (!data || !data.tooltip) { tooltip.style.display = 'none'; return; }
    tooltip.textContent = data.tooltip;
    tooltip.style.display = 'block';
  });

  treeContent.addEventListener('mousemove', function(e) {
    if (tooltip.style.display === 'block') {
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top = (e.clientY + 12) + 'px';
    }
  });

  treeContent.addEventListener('mouseout', function(e) {
    if (!e.target.closest('.tree-node')) tooltip.style.display = 'none';
  });

  // ─── Keyboard Navigation ────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (!selectedId) return;
    var currentIndex = -1;
    for (var i = 0; i < goalItems.length; i++) {
      if (goalItems[i].getAttribute('data-id') === selectedId) { currentIndex = i; break; }
    }
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      if (currentIndex < goalItems.length - 1) {
        selectGoal(goalItems[currentIndex + 1].getAttribute('data-id'));
        goalItems[currentIndex + 1].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      if (currentIndex > 0) {
        selectGoal(goalItems[currentIndex - 1].getAttribute('data-id'));
        goalItems[currentIndex - 1].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === ' ' && replayActive) {
      e.preventDefault();
      replayPlaying ? stopReplay() : startReplay();
    }
  });

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── Feedback panel ─────────────────────────────────────
  (function() {
    var overlay = document.getElementById('fb-overlay');
    var openBtn = document.getElementById('btn-feedback');
    var closeBtn = document.getElementById('fb-close');
    var textarea = document.getElementById('fb-text');
    var submitBtn = document.getElementById('fb-submit');
    var hint = document.getElementById('fb-hint');
    if (!overlay || !openBtn || !textarea || !submitBtn) return;

    var fbType = 'comment';
    var tabs = overlay.querySelectorAll('.fb-tab');

    openBtn.addEventListener('click', function() { overlay.classList.add('open'); textarea.focus(); });
    if (closeBtn) closeBtn.addEventListener('click', function() { overlay.classList.remove('open'); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.classList.remove('open'); });

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        fbType = tab.getAttribute('data-fb-type');
        if (fbType === 'comment') {
          textarea.placeholder = 'What do you think about this session?';
          hint.textContent = 'Comments are attached to this session.';
        } else {
          textarea.placeholder = 'Bug report, feature idea, or general thoughts about Operad...';
          hint.textContent = 'This opens a GitHub Discussion on the Operad repo.';
        }
      });
    });

    submitBtn.addEventListener('click', function() {
      var text = (textarea.value || '').trim();
      if (!text) { textarea.style.borderColor = '#ef4444'; return; }
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      fetch('https://operad.sh/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: fbType,
          message: text,
          sessionUrl: window.location.href,
        })
      }).then(function(res) {
        if (res.ok) {
          textarea.value = '';
          submitBtn.textContent = 'Sent!';
          setTimeout(function() {
            overlay.classList.remove('open');
            submitBtn.textContent = 'Send';
            submitBtn.disabled = false;
          }, 1500);
          showToast(fbType === 'comment' ? 'Comment saved.' : 'Feedback submitted to GitHub.');
        } else {
          submitBtn.textContent = 'Send';
          submitBtn.disabled = false;
          showToast('Something went wrong.');
        }
      }).catch(function() {
        submitBtn.textContent = 'Send';
        submitBtn.disabled = false;
        showToast('Network error.');
      });
    });
  })();

  // ─── Subscribe banner (shown after first interaction) ──
  (function() {
    var banner = document.getElementById('subscribe-banner');
    var emailInput = document.getElementById('subscribe-email');
    var btn = document.getElementById('subscribe-btn');
    var dismissBtn = document.getElementById('subscribe-dismiss');
    if (!banner || !emailInput || !btn) return;

    // Already handled — stay hidden forever
    if (localStorage.getItem('operad-subscribed') || localStorage.getItem('operad-dismiss-subscribe')) return;

    // Reveal on first meaningful interaction
    var revealed = false;
    function revealBanner() {
      if (revealed) return;
      revealed = true;
      banner.classList.remove('hidden');
    }

    // Listen on interactive elements: goals, replay, tree nodes, event rows, tabs
    document.querySelectorAll('.goal-item, .ev-row, .tab, .gt-goal-item').forEach(function(el) {
      el.addEventListener('click', revealBanner, { once: true });
    });
    var replayBtn = document.getElementById('btn-replay');
    if (replayBtn) replayBtn.addEventListener('click', revealBanner, { once: true });
    document.addEventListener('click', function(e) {
      if (e.target.closest && (e.target.closest('.tree-node') || e.target.closest('.tl-event'))) revealBanner();
    });

    if (dismissBtn) dismissBtn.addEventListener('click', function() {
      banner.classList.add('hidden');
      localStorage.setItem('operad-dismiss-subscribe', '1');
    });

    btn.addEventListener('click', function() {
      var email = (emailInput.value || '').trim();
      if (!email || email.indexOf('@') < 1) {
        emailInput.style.borderColor = '#ef4444';
        return;
      }
      btn.disabled = true;
      btn.textContent = '...';
      fetch('https://operad.sh/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function(res) {
        if (res.ok) {
          banner.innerHTML = '<span class="subscribe-ok">Thanks! We will let you know when Operad launches.</span>';
          localStorage.setItem('operad-subscribed', '1');
        } else {
          btn.textContent = 'Notify me';
          btn.disabled = false;
          showToast('Something went wrong.');
        }
      }).catch(function() {
        btn.textContent = 'Notify me';
        btn.disabled = false;
        showToast('Network error.');
      });
    });

    emailInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') btn.click();
      emailInput.style.borderColor = '#2a2a4a';
    });
  })();
})();
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Session HTML Renderer (Tabbed: Event Stream + Goal Traces) ─────────────

export interface RenderSessionOptions {
  title?: string
  branch?: BranchInfo
  /** Pre-resolved objects from storage (needed for Graph View on runtime graphs) */
  objects?: RenderableObject[]
  /** Pre-resolved relations from storage (needed for Graph View on runtime graphs) */
  relations?: RenderableRelation[]
}

/**
 * Render raw events into a tabbed HTML view.
 * Tab 1: Event Stream (chronological, color-coded, with redundant markers)
 * Tab 2: Goal Traces (per-goal cards with summaries)
 */
export function renderSessionHtml(
  events: GraphEvent[],
  options?: RenderSessionOptions,
): string {
  const title = options?.title ?? 'Operad Session'

  // ── Pre-compute data ──────────────────────────────────────────────────

  // Build turns (goals)
  interface Turn { goalText: string; goalTimestamp: string; events: GraphEvent[] }
  const turns: Turn[] = []
  let current: Turn | null = null
  for (const e of events) {
    if (e.type === 'goal.set') {
      if (current) turns.push(current)
      current = { goalText: (e.payload.text as string) ?? '', goalTimestamp: e.timestamp, events: [] }
    } else if (current) {
      current.events.push(e)
    }
  }
  if (current) turns.push(current)

  // Detect redundant reads
  const redundantIndices = new Set<number>()
  const lastReadIdx = new Map<string, number>()
  const lastEditIdx = new Map<string, number>()
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev.type !== 'custom.tool_called') continue
    const tool = ev.payload.tool as string
    const input = ev.payload.input as Record<string, unknown> | undefined
    if (tool === 'Edit' || tool === 'Write') {
      const fp = (input?.file_path as string) ?? ''
      if (fp) lastEditIdx.set(fp, i)
    } else if (tool === 'Read') {
      const fp = (input?.file_path as string) ?? ''
      if (!fp) continue
      const prev = lastReadIdx.get(fp)
      const le = lastEditIdx.get(fp) ?? -1
      if (prev !== undefined && le <= prev) redundantIndices.add(i)
      lastReadIdx.set(fp, i)
    }
  }

  // Stats
  const goalEvents = events.filter(e => e.type === 'goal.set')
  const toolEvents = events.filter(e => e.type === 'custom.tool_called')
  const blameEvents = events.filter(e => e.type === 'custom.blame_recorded')
  const totalCost = blameEvents.reduce((s, e) => s + ((e.payload.cost as number) ?? 0), 0)

  // Runtime-specific stats (for demos / non-session graphs)
  const objectEvents = events.filter(e => e.type.startsWith('object.'))
  const relationEvents = events.filter(e => e.type.startsWith('relation.'))
  const behaviorEvents = events.filter(e => e.type.startsWith('behavior.'))
  const isRuntimeGraph = goalEvents.length === 0 && objectEvents.length > 0

  // ── Extract graph nodes/edges for runtime graphs ────────────────────
  // object.created events don't contain the object ID (it's generated by
  // the storage adapter after the event). Use pre-resolved objects/relations
  // from storage when available; fall back to event-only extraction.
  interface GraphNode { id: string; type: string; label: string; data: Record<string, unknown> }
  interface GraphEdge { source: string; target: string; type: string }
  const graphNodes: GraphNode[] = []
  const graphEdges: GraphEdge[] = []
  const graphNodeMap = new Map<string, GraphNode>()

  if (isRuntimeGraph) {
    const resolvedObjects = options?.objects
    const resolvedRelations = options?.relations

    if (resolvedObjects && resolvedRelations) {
      // Preferred path: use pre-resolved objects from storage (has real IDs)
      for (const obj of resolvedObjects) {
        const label = (obj.data.title as string) ?? (obj.data.name as string) ?? (obj.data.reason as string) ?? obj.type
        const node: GraphNode = { id: obj.id, type: obj.type, label, data: obj.data as Record<string, unknown> }
        graphNodes.push(node)
        graphNodeMap.set(obj.id, node)
      }
      for (const rel of resolvedRelations) {
        graphEdges.push({ source: rel.sourceId, target: rel.targetId, type: rel.type })
      }
    } else {
      // Fallback: extract from events only (limited — no object IDs on object.created)
      for (const e of events) {
        if (e.type === 'object.created') {
          const objType = (e.payload.objectType as string) ?? 'unknown'
          const data = (e.payload.data as Record<string, unknown>) ?? {}
          // Use event ID as a proxy since object ID isn't available
          const id = e.id
          const label = (data.title as string) ?? (data.name as string) ?? objType
          const node: GraphNode = { id, type: objType, label, data }
          graphNodes.push(node)
          graphNodeMap.set(id, node)
        } else if (e.type === 'relation.created') {
          const source = (e.payload.sourceId as string) ?? ''
          const target = (e.payload.targetId as string) ?? ''
          const relType = (e.payload.relationType as string) ?? 'related'
          if (source && target) graphEdges.push({ source, target, type: relType })
        }
      }
    }
  }

  // Filter events for stream view (skip internal noise)
  // Only filter out cost accounting — keep reasoning + responses for timeline
  const internalTypes = new Set(['custom.blame_recorded'])
  const streamEvents = events
    .map((e, i) => ({ event: e, idx: i }))
    .filter(({ event }) => !internalTypes.has(event.type))

  // ── Build event stream rows ───────────────────────────────────────────
  const streamRowsHtml = streamEvents.map(({ event, idx }) => {
    const rawType = event.type.replace(/^custom\./, '')
    const ts = new Date(event.timestamp)
    const timeStr = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`

    let cssClass = 'ev-default'
    let icon = '·'
    if (rawType === 'goal.set' || rawType === 'goal_started') {
      cssClass = 'ev-goal'; icon = '●'
    } else if (rawType === 'tool_called') {
      const tool = (event.payload.tool as string) ?? ''
      if (['Read', 'Grep', 'Glob'].includes(tool)) { cssClass = 'ev-read'; icon = '○' }
      else if (['Edit', 'Write'].includes(tool)) { cssClass = 'ev-write'; icon = '◆' }
      else if (tool === 'Bash') { cssClass = 'ev-bash'; icon = '◆' }
      else { cssClass = 'ev-tool'; icon = '○' }
    } else if (rawType === 'graph.created') {
      cssClass = 'ev-graph'; icon = '◈'
    } else if (rawType.startsWith('object.')) {
      cssClass = 'ev-object'; icon = rawType === 'object.created' ? '●' : rawType === 'object.patched' ? '◆' : '○'
    } else if (rawType.startsWith('relation.')) {
      cssClass = 'ev-relation'; icon = '⟶'
    } else if (rawType.startsWith('behavior.')) {
      cssClass = 'ev-behavior'; icon = rawType === 'behavior.triggered' ? '⚡' : '✓'
    } else if (rawType.startsWith('llm.') || rawType === 'analyze_claim') {
      cssClass = 'ev-llm'; icon = '🤖'
    } else if (rawType.startsWith('patch.')) {
      cssClass = 'ev-patch'; icon = rawType === 'patch.proposed' ? '📋' : '✅'
    } else if (rawType.startsWith('custom.')) {
      cssClass = 'ev-custom'; icon = '◇'
    }

    const isRedundant = redundantIndices.has(idx)
    if (isRedundant) cssClass = 'ev-redundant'

    // Detail
    let detail = ''
    const p = event.payload
    if (rawType === 'goal.set' || rawType === 'goal_started') {
      const text = (p.text as string) ?? (p.goal as string) ?? ''
      detail = `"${escapeHtml(text.replace(/\n/g, ' ').slice(0, 80))}"`
    } else if (rawType === 'tool_called') {
      const tool = (p.tool as string) ?? '?'
      const input = p.input as Record<string, unknown> | undefined
      const filePath = (p.file_path as string) ?? (input?.file_path as string) ?? ''
      const shortFile = filePath ? filePath.split('/').slice(-2).join('/') : ''
      detail = `<strong>${escapeHtml(tool)}</strong>${shortFile ? ` <span class="ev-file">${escapeHtml(shortFile)}</span>` : ''}`
      if (isRedundant) detail += ' <span class="redundant-tag">← redundant</span>'
    } else if (rawType === 'graph.created') {
      const graphId = (p.graphId as string) ?? ''
      if (graphId) detail = `<strong>${escapeHtml(graphId)}</strong>`
    } else if (rawType === 'object.created') {
      const objType = (p.objectType as string) ?? (p.type as string) ?? ''
      const title = (p.data as Record<string, unknown>)?.title as string | undefined
      detail = objType ? `<strong>${escapeHtml(objType)}</strong>` : ''
      if (title) detail += ` <span class="ev-file">${escapeHtml(String(title).slice(0, 60))}</span>`
    } else if (rawType === 'object.patched') {
      const objType = (p.objectType as string) ?? ''
      const patch = p.patch as Record<string, unknown> | undefined
      detail = objType ? `<strong>${escapeHtml(objType)}</strong>` : ''
      if (patch) detail += ` <span class="ev-file">${escapeHtml(Object.keys(patch).join(', '))}</span>`
    } else if (rawType === 'relation.created') {
      const relType = (p.relationType as string) ?? (p.type as string) ?? ''
      detail = relType ? `<strong>${escapeHtml(relType)}</strong>` : ''
    } else if (rawType === 'behavior.triggered' || rawType === 'behavior.completed') {
      const name = (p.behaviorName as string) ?? (p.name as string) ?? ''
      detail = name ? `<strong>${escapeHtml(name)}</strong>` : ''
    } else if (rawType.startsWith('llm.')) {
      const model = (p.model as string) ?? ''
      detail = model ? `<span class="ev-file">${escapeHtml(model)}</span>` : ''
    } else if (rawType === 'patch.proposed') {
      const reason = (p.reason as string) ?? ''
      const proposedBy = (p.proposedBy as string) ?? ''
      detail = reason ? `"${escapeHtml(reason.slice(0, 60))}"` : ''
      if (proposedBy) detail += ` <span class="ev-file">by ${escapeHtml(proposedBy)}</span>`
    } else if (rawType === 'patch.applied') {
      const patchType = (p.type as string) ?? (p.objectType as string) ?? ''
      detail = patchType ? `<strong>${escapeHtml(patchType)}</strong>` : ''
    } else {
      // Generic: show actor or first meaningful payload key
      const actor = event.actor
      const keys = Object.keys(p).filter(k => k !== 'type' && k !== 'timestamp')
      if (actor && actor !== 'runtime') detail = `<span class="ev-file">${escapeHtml(actor)}</span>`
      else if (keys.length > 0) {
        const firstVal = p[keys[0]]
        if (typeof firstVal === 'string') detail = `<span class="ev-file">${escapeHtml(firstVal.slice(0, 60))}</span>`
      }
    }

    // Find which goal this event belongs to (for cross-linking)
    let goalIdx = -1
    for (let g = turns.length - 1; g >= 0; g--) {
      const goalTs = turns[g].goalTimestamp
      if (event.timestamp >= goalTs) { goalIdx = g; break }
    }

    const tooltip = escapeHtml(JSON.stringify(event.payload, null, 2).slice(0, 500))

    return `<div class="ev-row ${cssClass}" data-goal-idx="${goalIdx}" data-idx="${idx}" title="${tooltip}"><span class="ev-time">${timeStr}</span><span class="ev-icon">${icon}</span><span class="ev-type">${escapeHtml(rawType)}</span><span class="ev-detail">${detail}</span></div>`
  }).join('\n')

  // ── Project events → objects/relations (inline, no database) ─────────
  const TEST_CMDS = ['test', 'pytest', 'vitest', 'jest', 'npm test', 'pnpm test', 'npx vitest']
  function isTestCmd(cmd: string) {
    // Only check the first line / actual command, not heredoc bodies or string args
    const firstLine = cmd.split('\n')[0].toLowerCase().trim()
    return TEST_CMDS.some(tc => firstLine.startsWith(tc) || firstLine.includes(` ${tc}`))
  }

  interface PNode { id: string; type: string; label: string; tooltip: string }
  interface PEdge { targetId: string; edgeLabel: string }

  const goalChildrenMap: Record<string, PEdge[]> = {}
  const nodeDataMap: Record<string, PNode> = {}
  const projGoals: Array<{ id: string; text: string; ts: string; childCount: number }> = []
  const fileObjIds = new Map<string, string>()
  let activeGoalId: string | null = null
  let nodeCounter = 0

  function mkId() { return `n_${nodeCounter++}` }

  for (const event of events) {
    if (event.type === 'goal.set') {
      const id = mkId()
      const text = (event.payload.text as string) ?? ''
      activeGoalId = id
      goalChildrenMap[id] = []
      nodeDataMap[id] = { id, type: 'goal', label: text.length > 60 ? text.slice(0, 57) + '...' : text, tooltip: `Goal: ${text}` }
      projGoals.push({ id, text, ts: event.timestamp, childCount: 0 })
    } else if (event.type === 'custom.tool_called') {
      const tool = event.payload.tool as string
      const input = event.payload.input as Record<string, unknown> | undefined

      if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') {
        const fp = (input?.file_path as string) ?? (input?.path as string) ?? (input?.pattern as string) ?? ''
        if (fp && !fileObjIds.has(fp)) {
          const id = mkId()
          fileObjIds.set(fp, id)
          const shortPath = fp.split('/').slice(-3).join('/')
          nodeDataMap[id] = { id, type: 'file', label: shortPath, tooltip: `File: ${fp}\nRead count: 1` }
          if (activeGoalId) {
            goalChildrenMap[activeGoalId].push({ targetId: id, edgeLabel: 'triggered' })
            const g = projGoals.find(g => g.id === activeGoalId)
            if (g) g.childCount++
          }
        }
      }

      if (tool === 'Edit' || tool === 'Write') {
        const fp = (input?.file_path as string) ?? ''
        const id = mkId()
        const shortPath = fp ? fp.split('/').slice(-3).join('/') : tool
        const oldStr = tool === 'Edit' ? ((input?.old_string as string) ?? '').slice(0, 80) : ''
        const newStr = tool === 'Edit' ? ((input?.new_string as string) ?? '').slice(0, 80) : ''
        nodeDataMap[id] = { id, type: 'patch', label: shortPath, tooltip: `${tool}: ${fp}${oldStr ? `\n- ${oldStr}\n+ ${newStr}` : ''}` }
        if (activeGoalId) {
          goalChildrenMap[activeGoalId].push({ targetId: id, edgeLabel: 'produced' })
          const g = projGoals.find(g => g.id === activeGoalId)
          if (g) g.childCount++
        }
        // Ensure file node exists
        if (fp && !fileObjIds.has(fp)) {
          const fid = mkId()
          fileObjIds.set(fp, fid)
          nodeDataMap[fid] = { id: fid, type: 'file', label: fp.split('/').slice(-3).join('/'), tooltip: `File: ${fp}` }
        }
      }

      if (tool === 'Bash') {
        const command = (input?.command as string) ?? ''
        if (isTestCmd(command)) {
          const id = mkId()
          nodeDataMap[id] = { id, type: 'test_run', label: command.slice(0, 50), tooltip: `Test: ${command.slice(0, 200)}` }
          if (activeGoalId) {
            goalChildrenMap[activeGoalId].push({ targetId: id, edgeLabel: 'verified_by' })
            const g = projGoals.find(g => g.id === activeGoalId)
            if (g) g.childCount++
          }
        }
      }
    }
  }

  // Goal list HTML for the left panel
  const goalListHtml = projGoals.map((g, i) => {
    const text = escapeHtml(g.text.replace(/\n/g, ' ').slice(0, 60))
    const countBadge = g.childCount > 0 ? `<span class="child-count">${g.childCount}</span>` : ''
    const ts = formatTimestamp(g.ts)
    const timeBadge = ts ? `<span class="goal-time">${ts}</span>` : ''
    return `<div class="gt-goal-item" data-id="${g.id}" data-index="${i}"><span class="gt-goal-num">#${i + 1}</span><span class="gt-goal-icon">★</span><span class="gt-goal-mid"><span class="gt-goal-text">${text}</span>${timeBadge}</span>${countBadge}</div>`
  }).join('\n')

  // Stats for goal traces tab
  const projFiles = new Set(fileObjIds.keys()).size
  const projPatches = Object.values(nodeDataMap).filter(n => n.type === 'patch').length
  const projTests = Object.values(nodeDataMap).filter(n => n.type === 'test_run').length

  // ── Build file-centric graph for coding sessions ────────────────────
  // Shows goals connected through shared files — reveals hotspots and clusters.
  // Filters: only goals that touched files, only files touched by edits or 2+ goals.
  if (!isRuntimeGraph && projGoals.length > 0) {
    // Step 1: Walk events to track goal → file → action
    const goalFileActions = new Map<string, Map<string, 'read' | 'edited'>>()
    let curGoalId: string | null = null
    let goalIdx = -1

    for (const event of events) {
      if (event.type === 'goal.set') {
        goalIdx++
        curGoalId = projGoals[goalIdx]?.id ?? null
        if (curGoalId) goalFileActions.set(curGoalId, new Map())
      } else if (event.type === 'custom.tool_called' && curGoalId) {
        const tool = event.payload.tool as string
        const input = event.payload.input as Record<string, unknown> | undefined
        let fp = ''

        if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') {
          fp = (input?.file_path as string) ?? (input?.path as string) ?? ''
        } else if (tool === 'Edit' || tool === 'Write') {
          fp = (input?.file_path as string) ?? ''
        }

        if (fp) {
          const actions = goalFileActions.get(curGoalId)!
          const existing = actions.get(fp)
          if (tool === 'Edit' || tool === 'Write') {
            actions.set(fp, 'edited')
          } else if (!existing) {
            actions.set(fp, 'read')
          }
        }
      }
    }

    // Step 2: Count how many goals touch each file & whether it was edited
    const fileTouchCount = new Map<string, number>()
    const fileWasEdited = new Set<string>()
    for (const [, files] of goalFileActions) {
      for (const [fp, action] of files) {
        fileTouchCount.set(fp, (fileTouchCount.get(fp) ?? 0) + 1)
        if (action === 'edited') fileWasEdited.add(fp)
      }
    }

    // Step 3: Include file if it was edited OR touched by 2+ goals (interesting connections)
    const includedFiles = new Set<string>()
    for (const [fp, count] of fileTouchCount) {
      if (fileWasEdited.has(fp) || count >= 2) includedFiles.add(fp)
    }

    // Step 4: Include goals that touch at least one included file
    const includedGoals = new Set<string>()
    for (const [goalId, files] of goalFileActions) {
      for (const fp of files.keys()) {
        if (includedFiles.has(fp)) { includedGoals.add(goalId); break }
      }
    }

    // Step 5: Build graph nodes & edges
    for (const g of projGoals) {
      if (!includedGoals.has(g.id)) continue
      const label = g.text.replace(/\n/g, ' ').slice(0, 40)
      graphNodes.push({ id: g.id, type: 'goal', label, data: { text: g.text, timestamp: g.ts } })
      graphNodeMap.set(g.id, graphNodes[graphNodes.length - 1])
    }

    const fileNodeIds = new Map<string, string>()
    for (const [goalId, files] of goalFileActions) {
      if (!includedGoals.has(goalId)) continue
      for (const [fp, action] of files) {
        if (!includedFiles.has(fp)) continue
        if (!fileNodeIds.has(fp)) {
          const fid = `file_${fileNodeIds.size}`
          fileNodeIds.set(fp, fid)
          const shortPath = fp.split('/').slice(-2).join('/')
          const touchCount = fileTouchCount.get(fp) ?? 1
          graphNodes.push({ id: fid, type: 'file', label: shortPath, data: { path: fp, touchedBy: touchCount, edited: fileWasEdited.has(fp) } })
          graphNodeMap.set(fid, graphNodes[graphNodes.length - 1])
        }
        graphEdges.push({ source: goalId, target: fileNodeIds.get(fp)!, type: action })
      }
    }

    // Test nodes linked to included goals
    for (const [goalId, children] of Object.entries(goalChildrenMap)) {
      if (!includedGoals.has(goalId)) continue
      for (const child of children) {
        const node = nodeDataMap[child.targetId]
        if (node?.type === 'test_run') {
          const testId = `test_${graphNodes.length}`
          graphNodes.push({ id: testId, type: 'test_run', label: node.label, data: { command: node.tooltip } })
          graphNodeMap.set(testId, graphNodes[graphNodes.length - 1])
          graphEdges.push({ source: goalId, target: testId, type: 'verified_by' })
        }
      }
    }
  }

  // ── Timeline data ────────────────────────────────────────────────────
  const timelineEvents = streamEvents.map(({ event, idx }) => {
    const rawType = event.type.replace(/^custom\./, '')
    let cssClass = 'ev-default'
    let icon = '·'
    if (rawType === 'goal.set' || rawType === 'goal_started') { cssClass = 'ev-goal'; icon = '●' }
    else if (rawType === 'tool_called') {
      const tool = (event.payload.tool as string) ?? ''
      if (['Read', 'Grep', 'Glob'].includes(tool)) { cssClass = 'ev-read'; icon = '○' }
      else if (['Edit', 'Write'].includes(tool)) { cssClass = 'ev-write'; icon = '◆' }
      else if (tool === 'Bash') { cssClass = 'ev-bash'; icon = '◆' }
      else { cssClass = 'ev-tool'; icon = '○' }
    } else if (rawType.startsWith('object.')) { cssClass = 'ev-object'; icon = '●' }
    else if (rawType.startsWith('relation.')) { cssClass = 'ev-relation'; icon = '⟶' }
    else if (rawType.startsWith('behavior.')) { cssClass = 'ev-behavior'; icon = '⚡' }
    else if (rawType.startsWith('llm.')) { cssClass = 'ev-llm'; icon = '🤖' }
    else if (rawType.startsWith('patch.')) { cssClass = 'ev-patch'; icon = '📋' }
    else if (rawType === 'reasoning_trace') { cssClass = 'ev-llm'; icon = '🧠' }
    else if (rawType === 'assistant_responded') { cssClass = 'ev-tool'; icon = '💬' }

    // Build short label
    let label = rawType
    const p = event.payload
    if (rawType === 'goal.set' || rawType === 'goal_started') {
      label = ((p.text as string) ?? (p.goal as string) ?? '').replace(/\n/g, ' ').slice(0, 40)
    } else if (rawType === 'reasoning_trace') {
      label = ((p.preview as string) ?? '').replace(/\n/g, ' ').slice(0, 50)
    } else if (rawType === 'assistant_responded') {
      label = ((p.preview as string) ?? '').replace(/\n/g, ' ').slice(0, 50)
    } else if (rawType === 'tool_called') {
      const tool = (p.tool as string) ?? '?'
      const input = p.input as Record<string, unknown> | undefined
      const fp = (input?.file_path as string) ?? ''
      label = tool + (fp ? ` ${fp.split('/').slice(-2).join('/')}` : '')
    } else if (rawType === 'object.created') {
      label = `create ${(p.objectType as string) ?? ''}`
    } else if (rawType === 'relation.created') {
      label = `link ${(p.relationType as string) ?? ''}`
    } else if (rawType.startsWith('behavior.')) {
      label = `${rawType.split('.')[1]} ${(p.behaviorName as string) ?? (p.name as string) ?? ''}`
    }

    // Derive a richer actor for swim lane separation.
    // Raw actor from parsers is often just 'user'/'agent' — we infer from event semantics.
    let actor = event.actor ?? 'runtime'
    if (rawType === 'goal.set' || rawType === 'goal_started') {
      actor = 'user'
    } else if (rawType === 'tool_called') {
      actor = 'agent'
    } else if (rawType.startsWith('object.') || rawType.startsWith('relation.') || rawType === 'graph.created') {
      actor = 'runtime'
    } else if (rawType.startsWith('behavior.')) {
      actor = 'behavior'
    } else if (rawType.startsWith('llm.') || rawType === 'analyze_claim') {
      actor = 'llm'
    } else if (rawType.startsWith('patch.')) {
      actor = 'governance'
    } else if (rawType === 'reasoning_trace' || rawType === 'assistant_responded') {
      actor = 'thinking'
    }

    return {
      id: event.id,
      type: rawType,
      actor,
      timestamp: event.timestamp,
      causedBy: event.causedBy,
      label: label.slice(0, 50),
      cssClass,
      icon,
      payload: event.payload,
      idx,
    }
  })

  // Build causedBy map: parent → children
  const causedByMap: Record<string, string[]> = {}
  for (const te of timelineEvents) {
    if (te.causedBy) {
      if (!causedByMap[te.causedBy]) causedByMap[te.causedBy] = []
      causedByMap[te.causedBy].push(te.id)
    }
  }

  // ── Goal-level aggregation for large sessions ───────────────────────
  // Group events by goal so timeline views render O(goals) nodes, not O(events).
  interface GoalBucket {
    goalIdx: number
    goalLabel: string
    goalId: string       // the goal event's id
    eventCount: number
    eventIndices: number[]  // indices into timelineEvents
    actorCounts: Record<string, number>
    dominantActor: string
    typeCounts: Record<string, number>
    firstTimestamp: string
    lastTimestamp: string
    // Phase counts for coding sessions
    phases: { thinking: number; research: number; implement: number; verify: number; other: number }
    // File paths touched (short form)
    filesTouched: string[]
  }
  const goalBuckets: GoalBucket[] = []
  let currentBucket: GoalBucket | null = null
  let goalCounter = 0

  for (let i = 0; i < timelineEvents.length; i++) {
    const te = timelineEvents[i]
    if (te.type === 'goal.set' || te.type === 'goal_started') {
      if (currentBucket) goalBuckets.push(currentBucket)
      goalCounter++
      currentBucket = {
        goalIdx: goalCounter,
        goalLabel: te.label,
        goalId: te.id,
        eventCount: 1,
        eventIndices: [i],
        actorCounts: { [te.actor]: 1 },
        dominantActor: te.actor,
        typeCounts: { [te.type]: 1 },
        firstTimestamp: te.timestamp,
        lastTimestamp: te.timestamp,
        phases: { thinking: 0, research: 0, implement: 0, verify: 0, other: 0 },
        filesTouched: [],
      }
    } else if (currentBucket) {
      currentBucket.eventCount++
      currentBucket.eventIndices.push(i)
      currentBucket.actorCounts[te.actor] = (currentBucket.actorCounts[te.actor] ?? 0) + 1
      currentBucket.typeCounts[te.type] = (currentBucket.typeCounts[te.type] ?? 0) + 1
      currentBucket.lastTimestamp = te.timestamp
      // Classify into coding phases
      if (te.type === 'reasoning_trace' || te.type === 'assistant_responded') {
        currentBucket.phases.thinking++
      } else if (te.type === 'tool_called') {
        const tlabel = te.label.split(' ')[0] // tool name is first word of label
        if (['Read', 'Grep', 'Glob'].includes(tlabel)) currentBucket.phases.research++
        else if (['Edit', 'Write'].includes(tlabel)) currentBucket.phases.implement++
        else if (tlabel === 'Bash') currentBucket.phases.verify++
        else currentBucket.phases.other++
        // Track files
        const match = te.label.match(/\s(.+)$/)
        if (match && match[1] && !currentBucket.filesTouched.includes(match[1])) {
          currentBucket.filesTouched.push(match[1])
        }
      } else {
        currentBucket.phases.other++
      }
      // Update dominant actor
      let maxCount = 0
      for (const [a, c] of Object.entries(currentBucket.actorCounts)) {
        if (c > maxCount) { maxCount = c; currentBucket.dominantActor = a }
      }
    } else {
      // Pre-goal events: create a synthetic bucket
      if (!currentBucket) {
        currentBucket = {
          goalIdx: 0,
          goalLabel: '(before first goal)',
          goalId: te.id,
          eventCount: 0,
          eventIndices: [],
          actorCounts: {},
          dominantActor: te.actor,
          typeCounts: {},
          firstTimestamp: te.timestamp,
          lastTimestamp: te.timestamp,
          phases: { thinking: 0, research: 0, implement: 0, verify: 0, other: 0 },
          filesTouched: [],
        }
      }
      currentBucket.eventCount++
      currentBucket.eventIndices.push(i)
      currentBucket.actorCounts[te.actor] = (currentBucket.actorCounts[te.actor] ?? 0) + 1
      currentBucket.typeCounts[te.type] = (currentBucket.typeCounts[te.type] ?? 0) + 1
      currentBucket.lastTimestamp = te.timestamp
    }
  }
  if (currentBucket) goalBuckets.push(currentBucket)

  // Threshold: if fewer than 100 events, use event-level rendering (no aggregation)
  const useAggregation = timelineEvents.length > 100

  // ── Assemble HTML ─────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a2e; color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    height: 100vh; overflow: hidden;
    display: flex; flex-direction: column;
  }

  /* ── Toolbar ────────────────────────────────── */
  .toolbar {
    height: 44px; background: #12122a; border-bottom: 1px solid #2a2a4a;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px; flex-shrink: 0;
  }
  .toolbar-left { display: flex; align-items: center; gap: 12px; }
  .toolbar-right { display: flex; align-items: center; gap: 8px; }
  .brand { font-size: 12px; color: #555; text-decoration: none; transition: color 0.15s; }
  .brand:hover { color: #88aaff; }
  .brand span { color: #88aaff; font-weight: 600; }
  .session-info { font-size: 12px; color: #666; }
  .session-info .val { color: #ccc; font-weight: 600; }
  .tb-btn {
    background: transparent; border: 1px solid #333;
    color: #aaa; padding: 4px 12px; border-radius: 4px;
    cursor: pointer; font-size: 12px; transition: all 0.15s;
    display: flex; align-items: center; gap: 5px;
  }
  .tb-btn:hover { border-color: #555; color: #fff; background: #1e1e3a; }

  /* ── Tabs ────────────────────────────────────── */
  .tab-bar {
    display: flex; background: #12122a; border-bottom: 1px solid #2a2a4a;
    flex-shrink: 0; padding: 0 16px;
  }
  .tab {
    padding: 10px 20px; font-size: 13px; color: #666;
    cursor: pointer; border-bottom: 2px solid transparent;
    transition: all 0.15s; user-select: none;
    display: flex; align-items: center; gap: 6px;
  }
  .tab:hover { color: #aaa; }
  .tab.active { color: #88aaff; border-bottom-color: #2B5CE6; }
  .tab .tab-count {
    font-size: 10px; background: #2a2a4a; color: #888;
    padding: 1px 6px; border-radius: 8px;
  }
  .tab.active .tab-count { background: #1a3a6a; color: #88aaff; }

  /* ── Tab Panels ─────────────────────────────── */
  .tab-panel { flex: 1; overflow: hidden; display: none; }
  .tab-panel.active { display: flex; }

  /* ── Event Stream (Tab 1) ───────────────────── */
  #panel-stream { flex-direction: column; overflow-y: auto; }
  #panel-stream::-webkit-scrollbar { width: 6px; }
  #panel-stream::-webkit-scrollbar-track { background: transparent; }
  #panel-stream::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

  .ev-row {
    display: flex; align-items: center; gap: 10px;
    padding: 5px 20px; font-size: 13px;
    border-bottom: 1px solid #1e1e38;
    cursor: pointer; transition: background 0.1s;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    flex-shrink: 0;
  }
  .ev-row:hover { background: #1e1e3a; }
  .ev-row.highlighted { background: #1a2a4a; border-left: 3px solid #2B5CE6; }
  .ev-time { color: #555; font-size: 11px; min-width: 60px; font-variant-numeric: tabular-nums; }
  .ev-icon { min-width: 14px; text-align: center; }
  .ev-type { min-width: 160px; font-size: 12px; }
  .ev-detail { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ev-file { color: #888; }
  .ev-detail strong { font-weight: 600; }

  .ev-goal { color: #4ade80; }
  .ev-goal .ev-icon { color: #4ade80; }
  .ev-read { color: #aaa; }
  .ev-read .ev-icon { color: #2EA043; }
  .ev-write { color: #e0e0e0; }
  .ev-write .ev-icon { color: #E07020; }
  .ev-bash { color: #d0d0e0; }
  .ev-bash .ev-icon { color: #8B5CF6; }
  .ev-tool { color: #b0b0d0; }
  .ev-tool .ev-icon { color: #60a5fa; }
  .ev-graph { color: #88aaff; }
  .ev-graph .ev-icon { color: #88aaff; }
  .ev-object { color: #c084fc; }
  .ev-object .ev-icon { color: #a78bfa; }
  .ev-relation { color: #67e8f9; }
  .ev-relation .ev-icon { color: #22d3ee; }
  .ev-behavior { color: #fbbf24; }
  .ev-behavior .ev-icon { color: #f59e0b; }
  .ev-llm { color: #60a5fa; }
  .ev-llm .ev-icon { color: #3b82f6; }
  .ev-patch { color: #fb923c; }
  .ev-patch .ev-icon { color: #f97316; }
  .ev-custom { color: #a0a0c0; }
  .ev-custom .ev-icon { color: #888; }
  .ev-projection { color: #888; }
  .ev-projection .ev-icon { color: #666; }
  .ev-default { color: #777; }
  .ev-redundant { color: #777; }
  .ev-redundant .ev-icon { color: #EF4444; }
  .ev-redundant .ev-detail { color: #999; }
  .redundant-tag { color: #EF4444; font-size: 11px; font-weight: 600; margin-left: 6px; }

  /* ── Goal Traces (Tab 2) — Split Panel ──────── */
  #panel-goals { flex-direction: row; }

  /* Left: goal list */
  .gt-left {
    width: 30%; min-width: 280px; max-width: 400px;
    border-right: 1px solid #2a2a4a;
    display: flex; flex-direction: column;
    background: #16162b;
  }
  .gt-panel-header {
    padding: 14px 16px 10px; border-bottom: 1px solid #2a2a4a; flex-shrink: 0;
  }
  .gt-panel-header h2 { font-size: 14px; color: #88aaff; margin-bottom: 4px; font-weight: 600; }
  .gt-panel-header .gt-stats { font-size: 12px; color: #888; }
  .gt-panel-header .gt-stats .val { color: #ccc; font-weight: 600; }

  .gt-goal-list { flex: 1; overflow-y: auto; padding: 8px; }
  .gt-goal-list::-webkit-scrollbar { width: 6px; }
  .gt-goal-list::-webkit-scrollbar-track { background: transparent; }
  .gt-goal-list::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

  .gt-goal-item {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; margin: 2px 0;
    border-radius: 6px; cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease; font-size: 13px;
  }
  .gt-goal-item:hover { background: #1e1e3a; border-color: #333; }
  .gt-goal-item.active { background: #1a2a4a; border-color: #2B5CE6; box-shadow: 0 0 0 1px rgba(43,92,230,0.3); }
  .gt-goal-num { color: #555; font-size: 11px; min-width: 24px; font-variant-numeric: tabular-nums; }
  .gt-goal-icon { color: #2B5CE6; flex-shrink: 0; }
  .gt-goal-mid { flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 2px; }
  .gt-goal-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ddd; }
  .gt-goal-time { font-size: 10px; color: #555; font-family: 'SF Mono', Monaco, monospace; font-variant-numeric: tabular-nums; }
  .child-count {
    background: #2a2a4a; color: #888; font-size: 11px;
    padding: 1px 6px; border-radius: 10px; flex-shrink: 0;
  }

  /* Right: tree */
  .gt-right { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .gt-tree-header {
    padding: 14px 24px 10px; border-bottom: 1px solid #2a2a4a; flex-shrink: 0;
  }
  .gt-tree-header h2 {
    font-size: 15px; color: #fff; font-weight: 600;
    display: flex; align-items: center; gap: 8px;
  }
  .gt-tree-header .gt-tree-stats { font-size: 12px; color: #666; margin-top: 4px; }

  .gt-tree-content { flex: 1; overflow-y: auto; padding: 20px 24px; }
  .gt-tree-content::-webkit-scrollbar { width: 6px; }
  .gt-tree-content::-webkit-scrollbar-track { background: transparent; }
  .gt-tree-content::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

  .gt-tree-empty {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: #555; font-size: 14px;
  }

  .gt-tree-children { margin-left: 20px; padding-left: 16px; border-left: 1px solid #2a2a4a; }
  .gt-tree-node {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; margin: 4px 0;
    border-radius: 6px; transition: background 0.1s;
  }
  .gt-tree-node:hover { background: rgba(255,255,255,0.03); }
  .gt-tree-node .node-icon { flex-shrink: 0; font-size: 14px; }
  .gt-tree-node .node-label {
    flex: 1; font-size: 13px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .gt-tree-node .edge-label {
    font-size: 11px; color: #666; padding: 2px 8px;
    background: #1a1a2e; border-radius: 4px; flex-shrink: 0;
  }

  .gt-tree-node[data-type="file"] .node-label { color: #4ade80; }
  .gt-tree-node[data-type="patch"] .node-label { color: #fb923c; }
  .gt-tree-node[data-type="test_run"] .node-label { color: #a78bfa; }

  /* Tooltip */
  .tooltip {
    display: none; position: fixed;
    background: #0d0d1a; border: 1px solid #333;
    border-radius: 6px; padding: 10px 12px;
    font-size: 11px; max-width: 400px; z-index: 100;
    white-space: pre-wrap; word-break: break-all;
    color: #aaa; line-height: 1.5;
    pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  }

  /* ── Replay Scrubber ────────────────────────── */
  .replay-bar {
    display: none; height: 36px; background: #12122a;
    border-bottom: 1px solid #2a2a4a;
    align-items: center; padding: 0 16px; gap: 12px; flex-shrink: 0;
  }
  .replay-bar.visible { display: flex; }
  .replay-bar input[type="range"] { flex: 1; accent-color: #2B5CE6; cursor: pointer; }
  .replay-label { font-size: 11px; color: #666; min-width: 80px; font-variant-numeric: tabular-nums; }
  .replay-speed {
    font-size: 11px; color: #555; padding: 2px 6px;
    border: 1px solid #333; border-radius: 3px; cursor: pointer; background: transparent;
  }
  .replay-speed:hover { color: #aaa; border-color: #555; }

  /* ── Toast ──────────────────────────────────── */
  .toast {
    position: fixed; bottom: 20px; left: 50%;
    transform: translateX(-50%) translateY(60px);
    background: #2B5CE6; color: #fff;
    padding: 8px 20px; border-radius: 6px;
    font-size: 13px; opacity: 0;
    transition: all 0.3s ease; z-index: 200; pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  /* ── Legend ──────────────────────────────────── */
  .legend {
    padding: 8px 16px; border-top: 1px solid #2a2a4a;
    display: flex; gap: 14px; flex-wrap: wrap;
    font-size: 11px; color: #666; flex-shrink: 0;
  }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; }

  /* ── Graph View (runtime graphs) ────────────── */
  #graph-svg {
    flex: 1; background: #141428; min-width: 0;
    width: 100%; height: 100%;
  }
  .graph-node rect {
    rx: 6; ry: 6; cursor: grab;
    transition: filter 0.15s;
  }
  .graph-node rect:hover, .graph-node.hovered rect {
    filter: drop-shadow(0 0 6px rgba(136,170,255,0.5));
  }
  .graph-node text {
    fill: #fff; font-size: 12px;
    pointer-events: none; user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .graph-node.dimmed { opacity: 0.2; }
  .graph-edge {
    stroke: #555; stroke-width: 1.5;
    marker-end: url(#arrowhead);
    transition: opacity 0.15s;
  }
  .graph-edge.dimmed { opacity: 0.1; }
  .graph-edge.highlighted { stroke: #88aaff; stroke-width: 2.5; }
  .edge-label-text {
    fill: #666; font-size: 10px;
    pointer-events: none; user-select: none;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .graph-detail {
    width: 300px; background: #14142a;
    border-left: 1px solid #2a2a4a;
    display: none; flex-direction: column;
    flex-shrink: 0; overflow: hidden;
  }
  .graph-detail.visible { display: flex; }
  .graph-detail-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 10px; border-bottom: 1px solid #2a2a4a;
  }
  .graph-detail-header h3 {
    font-size: 14px; color: #88aaff; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .detail-close {
    background: none; border: none; color: #555; cursor: pointer;
    font-size: 18px; padding: 0 4px; line-height: 1;
  }
  .detail-close:hover { color: #fff; }
  .detail-body {
    flex: 1; overflow-y: auto; padding: 12px 16px;
    font-size: 12px; color: #aaa; line-height: 1.6;
    font-family: 'SF Mono', Monaco, monospace;
    white-space: pre-wrap; word-break: break-all;
  }
  .detail-body::-webkit-scrollbar { width: 6px; }
  .detail-body::-webkit-scrollbar-track { background: transparent; }
  .detail-body::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

  /* ── Timeline (Tab 3) ──────────────────────── */
  #panel-timeline { flex-direction: column; }
  .tl-toolbar {
    height: 36px; display: flex; gap: 4px; padding: 6px 16px;
    border-bottom: 1px solid #2a2a4a; flex-shrink: 0; align-items: center;
  }
  .tl-mode {
    background: #1e1e38; border: 1px solid #2a2a4a; color: #888;
    border-radius: 4px; padding: 2px 12px; cursor: pointer; font-size: 12px;
    transition: all 0.15s;
  }
  .tl-mode.active { background: #2B5CE6; color: #fff; border-color: #2B5CE6; }
  .tl-body { flex: 1; display: flex; overflow: hidden; position: relative; }
  #timeline-svg {
    flex: 1; background: #141428; min-width: 0;
    width: 100%; height: 100%;
  }
  .tl-lane-bg { fill: #16162e; }
  .tl-lane-bg.alt { fill: #1a1a32; }
  .tl-lane-label { fill: #888; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .tl-event { cursor: pointer; transition: filter 0.15s; }
  .tl-event:hover { filter: drop-shadow(0 0 4px rgba(136,170,255,0.5)); }
  .tl-causal-arrow { stroke: #555; stroke-dasharray: 4 3; stroke-width: 1; fill: none; marker-end: url(#tl-arrowhead); }
  .tl-node { cursor: pointer; transition: filter 0.15s; }
  .tl-node:hover { filter: drop-shadow(0 0 4px rgba(136,170,255,0.5)); }
  .tl-edge { stroke: #444; stroke-width: 1; fill: none; }

  /* Subscribe banner */
  .subscribe-banner {
    background: linear-gradient(90deg, #1a1040 0%, #12122a 100%);
    border-bottom: 1px solid #2a2a4a;
    padding: 10px 16px;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 13px; color: #9090b0;
    flex-shrink: 0;
  }
  .subscribe-banner.hidden { display: none; }
  .subscribe-banner { animation: slideBannerIn 0.3s ease-out; }
  @keyframes slideBannerIn { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: translateY(0); } }
  .subscribe-text { display: flex; align-items: center; gap: 8px; }
  .subscribe-text strong { color: #c0c0e0; font-weight: 500; }
  .subscribe-form { display: flex; gap: 8px; align-items: center; }
  .subscribe-form input[type="email"] {
    background: #0c0a1d; border: 1px solid #2a2a4a; border-radius: 4px;
    color: #e0e0e0; padding: 5px 10px; font-size: 12px; width: 220px;
    outline: none; transition: border-color 0.15s;
  }
  .subscribe-form input[type="email"]:focus { border-color: #4a6cf7; }
  .subscribe-form input[type="email"]::placeholder { color: #555; }
  .subscribe-btn {
    background: #2B5CE6; color: #fff; border: none; border-radius: 4px;
    padding: 5px 14px; font-size: 12px; cursor: pointer; font-weight: 500;
    transition: background 0.15s;
  }
  .subscribe-btn:hover { background: #3d6ef7; }
  .subscribe-btn:disabled { opacity: 0.6; cursor: default; }
  .subscribe-dismiss {
    background: none; border: none; color: #555; cursor: pointer;
    font-size: 16px; padding: 0 4px; line-height: 1;
  }
  .subscribe-dismiss:hover { color: #888; }
  .subscribe-ok { color: #4ade80; font-size: 12px; }

  /* Feedback panel */
  .fb-overlay { display: none; position: fixed; inset: 0; z-index: 999; }
  .fb-overlay.open { display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); }
  .fb-panel {
    background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 8px;
    width: 400px; max-width: 90vw; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: fbIn 0.2s ease-out;
  }
  @keyframes fbIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  .fb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .fb-header h3 { margin: 0; font-size: 14px; color: #e0e0e0; font-weight: 500; }
  .fb-close { background: none; border: none; color: #555; cursor: pointer; font-size: 18px; padding: 0; }
  .fb-close:hover { color: #888; }
  .fb-tabs { display: flex; gap: 0; margin-bottom: 14px; border-bottom: 1px solid #2a2a4a; }
  .fb-tab {
    padding: 6px 14px; font-size: 12px; color: #666; cursor: pointer;
    border-bottom: 2px solid transparent; transition: all 0.15s; background: none; border-top: none; border-left: none; border-right: none;
  }
  .fb-tab:hover { color: #aaa; }
  .fb-tab.active { color: #88aaff; border-bottom-color: #88aaff; }
  .fb-textarea {
    width: 100%; min-height: 80px; background: #0c0a1d; border: 1px solid #2a2a4a;
    border-radius: 4px; color: #e0e0e0; padding: 8px 10px; font-size: 13px;
    font-family: inherit; resize: vertical; outline: none; transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .fb-textarea:focus { border-color: #4a6cf7; }
  .fb-textarea::placeholder { color: #555; }
  .fb-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .fb-submit {
    background: #2B5CE6; color: #fff; border: none; border-radius: 4px;
    padding: 6px 16px; font-size: 12px; cursor: pointer; font-weight: 500;
    transition: background 0.15s;
  }
  .fb-submit:hover { background: #3d6ef7; }
  .fb-submit:disabled { opacity: 0.6; cursor: default; }
  .fb-hint { font-size: 11px; color: #555; margin-top: 8px; }

  @media (max-width: 768px) {
    .ev-type { min-width: 100px; }
    .session-info { display: none; }
    .ev-row { padding: 5px 10px; gap: 6px; }
    #panel-goals { flex-direction: column; }
    .gt-left { width: 100%; max-width: none; height: 40%; min-width: auto; border-right: none; border-bottom: 1px solid #2a2a4a; }
    .gt-right { height: 60%; }
    .graph-detail { width: 100%; position: absolute; right: 0; top: 0; height: 100%; }
    .subscribe-banner { flex-direction: column; gap: 8px; text-align: center; }
    .subscribe-form input[type="email"] { width: 160px; }
  }
</style>
</head>
<body>

<!-- Toolbar -->
<div class="toolbar">
  <div class="toolbar-left">
    <a class="brand" href="https://github.com/operadhq/operad" target="_blank" rel="noopener"><span>operad</span> session</a>
    <span class="session-info">
      ${isRuntimeGraph
        ? `<span class="val">${objectEvents.length}</span> objects ·
           <span class="val">${relationEvents.length}</span> relations ·
           <span class="val">${behaviorEvents.length}</span> behaviors ·
           <span class="val">${events.length}</span> events`
        : `<span class="val">${goalEvents.length}</span> goals ·
           <span class="val">${toolEvents.length}</span> tools ·
           <span class="val">${events.length}</span> events ·
           $<span class="val">${totalCost.toFixed(2)}</span>`}
      ${redundantIndices.size > 0 ? ` · <span style="color:#EF4444">${redundantIndices.size} redundant</span>` : ''}
    </span>
  </div>
  <div class="toolbar-right">
    <button class="tb-btn" id="btn-replay" title="Replay events chronologically">▶ Replay</button>
    <button class="tb-btn" id="btn-download" title="Download this HTML file">↓ Save</button>
    <button class="tb-btn" id="btn-feedback" title="Send feedback">💬 Feedback</button>
  </div>
</div>

<!-- Feedback modal -->
<div class="fb-overlay" id="fb-overlay">
  <div class="fb-panel">
    <div class="fb-header">
      <h3>Feedback</h3>
      <button class="fb-close" id="fb-close">&times;</button>
    </div>
    <div class="fb-tabs">
      <button class="fb-tab active" data-fb-type="comment">Session comment</button>
      <button class="fb-tab" data-fb-type="feedback">Product feedback</button>
    </div>
    <textarea class="fb-textarea" id="fb-text" placeholder="What do you think about this session?"></textarea>
    <div class="fb-hint" id="fb-hint">Comments are attached to this session.</div>
    <div class="fb-footer">
      <button class="fb-submit" id="fb-submit">Send</button>
    </div>
  </div>
</div>

<!-- Tabs -->
<div class="tab-bar">
  <div class="tab active" data-tab="stream">
    Event Stream <span class="tab-count">${streamEvents.length}</span>
  </div>
  <div class="tab" data-tab="goals">
    Graph View <span class="tab-count">${graphNodes.length}</span>
  </div>
  <div class="tab" data-tab="timeline">
    Timeline <span class="tab-count">${streamEvents.length}</span>
  </div>
</div>

<!-- Subscribe banner -->
<div class="subscribe-banner hidden" id="subscribe-banner">
  <div class="subscribe-text">
    <strong>Trace your own agent sessions</strong>
    <span>— get notified when Operad launches.</span>
  </div>
  <div class="subscribe-form">
    <input type="email" id="subscribe-email" placeholder="you@company.com" autocomplete="email" />
    <button class="subscribe-btn" id="subscribe-btn">Notify me</button>
    <button class="subscribe-dismiss" id="subscribe-dismiss" title="Dismiss">&times;</button>
  </div>
</div>

<!-- Replay bar -->
<div class="replay-bar" id="replay-bar">
  <button class="tb-btn" id="btn-replay-toggle" style="padding:4px 8px" title="Play / Pause">▶</button>
  <input type="range" id="replay-scrubber" min="0" max="${Math.max(0, streamEvents.length - 1)}" value="0">
  <span class="replay-label" id="replay-label">1 / ${streamEvents.length}</span>
  <button class="replay-speed" id="replay-speed" title="Playback speed">1×</button>
</div>

<!-- Event Stream Panel (Tab 1) -->
<div class="tab-panel active" id="panel-stream">
  ${streamRowsHtml}
</div>

<!-- Tab 2 Panel: Graph View -->
<div class="tab-panel" id="panel-goals">
  <svg id="graph-svg">
    <defs>
      <marker id="arrowhead" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
        <polygon points="0 0, 10 3.5, 0 7" fill="#555"/>
      </marker>
    </defs>
  </svg>
  <div id="graph-detail" class="graph-detail">
    <div class="graph-detail-header">
      <h3 id="detail-title">Click a node</h3>
      <button id="detail-close" class="detail-close">×</button>
    </div>
    <pre id="detail-body" class="detail-body">Select a node in the graph to inspect its data.</pre>
  </div>
</div>

<!-- Tab 3 Panel: Timeline -->
<div class="tab-panel" id="panel-timeline">
  <div class="tl-toolbar">
    <button class="tl-mode active" data-mode="swim">Swim Lanes</button>
    <button class="tl-mode" data-mode="causal">Causal Chain</button>
    <button class="tl-mode" data-mode="waterfall">Waterfall</button>
  </div>
  <div class="tl-body">
    <svg id="timeline-svg"></svg>
    <div id="tl-detail" class="graph-detail">
      <div class="graph-detail-header">
        <h3 id="tl-detail-title">Click an event</h3>
        <button id="tl-detail-close" class="detail-close">×</button>
      </div>
      <pre id="tl-detail-body" class="detail-body">Select an event in the timeline to inspect its data.</pre>
    </div>
  </div>
</div>

<!-- Legend -->
<div class="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#4ade80"></div> Goal / File</div>
  <div class="legend-item"><div class="legend-dot" style="background:#E07020"></div> Edit/Write</div>
  <div class="legend-item"><div class="legend-dot" style="background:#8B5CF6"></div> Bash / Test</div>
  <div class="legend-item"><div class="legend-dot" style="background:#a78bfa"></div> Object</div>
  <div class="legend-item"><div class="legend-dot" style="background:#22d3ee"></div> Relation</div>
  <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> Behavior</div>
  <div class="legend-item"><div class="legend-dot" style="background:#3b82f6"></div> LLM</div>
  <div class="legend-item"><div class="legend-dot" style="background:#f97316"></div> Patch</div>
  <div class="legend-item"><div class="legend-dot" style="background:#EF4444"></div> Redundant</div>
</div>

<div class="tooltip" id="tooltip"></div>
<div class="toast" id="toast"></div>

<script>
(function() {
  var totalEvents = ${streamEvents.length};
  var isRuntimeGraph = ${isRuntimeGraph};
  var goalChildren = ${JSON.stringify(goalChildrenMap)};
  var nodeData = ${JSON.stringify(nodeDataMap)};
  var graphNodes = ${JSON.stringify(graphNodes)};
  var graphEdges = ${JSON.stringify(graphEdges)};
  var timelineEvents = ${JSON.stringify(timelineEvents)};
  var causedByMap = ${JSON.stringify(causedByMap)};
  var goalBuckets = ${JSON.stringify(goalBuckets)};
  var useAggregation = ${useAggregation};
  var icons = { goal: '★', file: '📄', patch: '✏️', test_run: '🧪' };

  // ── Tab switching ─────────────────────────────
  var tabs = document.querySelectorAll('.tab');

  function switchTab(tabName) {
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tabName);
    }
    document.getElementById('panel-stream').classList.toggle('active', tabName === 'stream');
    document.getElementById('panel-goals').classList.toggle('active', tabName === 'goals');
    document.getElementById('panel-timeline').classList.toggle('active', tabName === 'timeline');
    if (tabName === 'timeline') renderTimeline();
    // Hide replay bar when leaving stream tab
    if (tabName !== 'stream' && replayActive) {
      replayBar.classList.remove('visible');
    } else if (tabName === 'stream' && replayActive) {
      replayBar.classList.add('visible');
    }
  }

  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function() {
      switchTab(this.getAttribute('data-tab'));
    });
  }

  // ── Toast ─────────────────────────────────────
  var toast = document.getElementById('toast');
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 2000);
  }

  // ── Keyboard nav (tab switching + replay) ─────────────────
  document.addEventListener('keydown', function(e) {
    if (e.key === '1') switchTab('stream');
    else if (e.key === '2') switchTab('goals');
    else if (e.key === '3') switchTab('timeline');
    else if (e.key === ' ' && replayActive) {
      e.preventDefault();
      replayPlaying ? stopReplay() : startReplay();
    }
  });

  // ── Graph View ────────────────
  if (graphNodes.length > 0) {
    var NODE_COLORS = {
      // Runtime graph types
      claim:          { fill: '#c084fc', stroke: '#a78bfa' },
      evidence:       { fill: '#4ade80', stroke: '#22c55e' },
      flag:           { fill: '#fb923c', stroke: '#f97316' },
      decision:       { fill: '#60a5fa', stroke: '#3b82f6' },
      review_request: { fill: '#fbbf24', stroke: '#f59e0b' },
      // Coding session types
      goal:           { fill: '#60a5fa', stroke: '#3b82f6' },
      file:           { fill: '#4ade80', stroke: '#22c55e' },
      patch:          { fill: '#fb923c', stroke: '#f97316' },
      test_run:       { fill: '#c084fc', stroke: '#a78bfa' }
    };
    var DEFAULT_NODE = { fill: '#6B7280', stroke: '#4B5563' };

    var svg = document.getElementById('graph-svg');
    var detailPanel = document.getElementById('graph-detail');
    var detailTitle = document.getElementById('detail-title');
    var detailBody = document.getElementById('detail-body');
    var detailClose = document.getElementById('detail-close');

    // Force-directed layout
    var nodeW = 160, nodeH = 38;
    var positions = [];
    var n = graphNodes.length;
    var cx = 400, cy = 300;
    var radius = Math.max(100, n * 30);

    // Init positions in a circle
    for (var i = 0; i < n; i++) {
      var angle = (2 * Math.PI * i) / n;
      positions.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        vx: 0, vy: 0
      });
    }

    // Build index lookup
    var idToIdx = {};
    for (var i = 0; i < n; i++) idToIdx[graphNodes[i].id] = i;

    // Run simulation (150 iterations, no animation)
    // Scale force constants based on graph size
    var REPULSION = graphNodes.length > 20 ? 15000 : 8000;
    var ATTRACTION = graphNodes.length > 20 ? 0.005 : 0.01;
    var DAMPING = 0.9;
    for (var iter = 0; iter < 150; iter++) {
      // Repulsion between all pairs
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var dx = positions[i].x - positions[j].x;
          var dy = positions[i].y - positions[j].y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var force = REPULSION / (dist * dist);
          var fx = (dx / dist) * force;
          var fy = (dy / dist) * force;
          positions[i].vx += fx; positions[i].vy += fy;
          positions[j].vx -= fx; positions[j].vy -= fy;
        }
      }
      // Spring attraction on edges
      for (var e = 0; e < graphEdges.length; e++) {
        var si = idToIdx[graphEdges[e].source];
        var ti = idToIdx[graphEdges[e].target];
        if (si === undefined || ti === undefined) continue;
        var dx = positions[ti].x - positions[si].x;
        var dy = positions[ti].y - positions[si].y;
        var fx = dx * ATTRACTION;
        var fy = dy * ATTRACTION;
        positions[si].vx += fx; positions[si].vy += fy;
        positions[ti].vx -= fx; positions[ti].vy -= fy;
      }
      // Apply velocity with damping
      for (var i = 0; i < n; i++) {
        positions[i].vx *= DAMPING; positions[i].vy *= DAMPING;
        positions[i].x += positions[i].vx; positions[i].y += positions[i].vy;
      }
    }

    // Center the result
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < n; i++) {
      if (positions[i].x < minX) minX = positions[i].x;
      if (positions[i].y < minY) minY = positions[i].y;
      if (positions[i].x > maxX) maxX = positions[i].x;
      if (positions[i].y > maxY) maxY = positions[i].y;
    }
    var pad = 60;
    var vbW = (maxX - minX) + nodeW + pad * 2;
    var vbH = (maxY - minY) + nodeH + pad * 2;
    var offsetX = -minX + pad + nodeW / 2;
    var offsetY = -minY + pad + nodeH / 2;

    // Viewbox state for zoom/pan
    var vbX = 0, vbY = 0, vbCurW = vbW, vbCurH = vbH;
    function updateViewBox() {
      svg.setAttribute('viewBox', vbX + ' ' + vbY + ' ' + vbCurW + ' ' + vbCurH);
    }
    updateViewBox();

    // Render edges
    var edgeEls = [];
    var edgeLabelEls = [];
    for (var e = 0; e < graphEdges.length; e++) {
      var si = idToIdx[graphEdges[e].source];
      var ti = idToIdx[graphEdges[e].target];
      if (si === undefined || ti === undefined) continue;
      var x1 = positions[si].x + offsetX, y1 = positions[si].y + offsetY;
      var x2 = positions[ti].x + offsetX, y2 = positions[ti].y + offsetY;

      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('class', 'graph-edge');
      line.setAttribute('data-source', graphEdges[e].source);
      line.setAttribute('data-target', graphEdges[e].target);
      // Color edges by type: edited=brighter, read=dimmer
      if (graphEdges[e].type === 'edited') { line.style.stroke = '#fb923c'; line.style.strokeWidth = '2'; }
      else if (graphEdges[e].type === 'read') { line.style.stroke = '#444'; line.style.strokeDasharray = '4 3'; }
      svg.appendChild(line);
      edgeEls.push(line);

      // Edge label at midpoint
      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', (x1 + x2) / 2);
      label.setAttribute('y', (y1 + y2) / 2 - 6);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'edge-label-text');
      label.textContent = graphEdges[e].type;
      svg.appendChild(label);
      edgeLabelEls.push(label);
    }

    // Render nodes
    var nodeEls = [];
    for (var i = 0; i < n; i++) {
      var gn = graphNodes[i];
      var px = positions[i].x + offsetX;
      var py = positions[i].y + offsetY;
      var colors = NODE_COLORS[gn.type] || DEFAULT_NODE;

      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'graph-node');
      g.setAttribute('data-id', gn.id);
      g.setAttribute('transform', 'translate(' + (px - nodeW/2) + ',' + (py - nodeH/2) + ')');

      var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', nodeW); rect.setAttribute('height', nodeH);
      rect.setAttribute('fill', colors.fill); rect.setAttribute('stroke', colors.stroke);
      rect.setAttribute('stroke-width', '2');
      g.appendChild(rect);

      var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', nodeW / 2); txt.setAttribute('y', nodeH / 2 + 4);
      txt.setAttribute('text-anchor', 'middle');
      var truncLabel = gn.label.length > 22 ? gn.label.slice(0, 20) + '…' : gn.label;
      txt.textContent = truncLabel;
      g.appendChild(txt);

      svg.appendChild(g);
      nodeEls.push({ el: g, id: gn.id, idx: i });
    }

    // Hover: highlight node + connected edges, dim others
    function highlightNode(nodeId) {
      var connected = {};
      connected[nodeId] = true;
      for (var e = 0; e < graphEdges.length; e++) {
        if (graphEdges[e].source === nodeId) connected[graphEdges[e].target] = true;
        if (graphEdges[e].target === nodeId) connected[graphEdges[e].source] = true;
      }
      for (var i = 0; i < nodeEls.length; i++) {
        nodeEls[i].el.classList.toggle('dimmed', !connected[nodeEls[i].id]);
        nodeEls[i].el.classList.toggle('hovered', nodeEls[i].id === nodeId);
      }
      for (var e = 0; e < edgeEls.length; e++) {
        var src = edgeEls[e].getAttribute('data-source');
        var tgt = edgeEls[e].getAttribute('data-target');
        var isConn = (src === nodeId || tgt === nodeId);
        edgeEls[e].classList.toggle('dimmed', !isConn);
        edgeEls[e].classList.toggle('highlighted', isConn);
      }
    }

    function clearHighlight() {
      for (var i = 0; i < nodeEls.length; i++) {
        nodeEls[i].el.classList.remove('dimmed', 'hovered');
      }
      for (var e = 0; e < edgeEls.length; e++) {
        edgeEls[e].classList.remove('dimmed', 'highlighted');
      }
    }

    // Click: show detail sidebar
    function showDetail(nodeId) {
      var gn = null;
      for (var i = 0; i < graphNodes.length; i++) {
        if (graphNodes[i].id === nodeId) { gn = graphNodes[i]; break; }
      }
      if (!gn) return;
      detailTitle.textContent = gn.type + ': ' + gn.label;
      detailBody.textContent = JSON.stringify(gn.data, null, 2);
      detailPanel.classList.add('visible');
    }

    detailClose.addEventListener('click', function() {
      detailPanel.classList.remove('visible');
    });

    // Drag (node) + Pan (background) support
    var dragNode = null, dragOffset = { x: 0, y: 0 }, dragIdx = -1;
    var isPanning = false, panStart = { x: 0, y: 0 }, panVbStart = { x: 0, y: 0 };

    svg.addEventListener('mousedown', function(e) {
      var g = e.target.closest('.graph-node');
      if (g) {
        // Node drag
        e.preventDefault();
        var nodeId = g.getAttribute('data-id');
        for (var i = 0; i < nodeEls.length; i++) {
          if (nodeEls[i].id === nodeId) { dragIdx = nodeEls[i].idx; break; }
        }
        dragNode = g;
        var pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        var svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
        dragOffset.x = svgP.x - (positions[dragIdx].x + offsetX - nodeW / 2);
        dragOffset.y = svgP.y - (positions[dragIdx].y + offsetY - nodeH / 2);
        g.style.cursor = 'grabbing';
      } else {
        // Background pan
        isPanning = true;
        panStart.x = e.clientX; panStart.y = e.clientY;
        panVbStart.x = vbX; panVbStart.y = vbY;
        svg.style.cursor = 'grabbing';
      }
    });

    svg.addEventListener('mousemove', function(e) {
      if (isPanning) {
        var scale = vbCurW / svg.clientWidth;
        vbX = panVbStart.x - (e.clientX - panStart.x) * scale;
        vbY = panVbStart.y - (e.clientY - panStart.y) * scale;
        updateViewBox();
        return;
      }
      if (!dragNode) {
        // Hover detection
        var g = e.target.closest('.graph-node');
        if (g) highlightNode(g.getAttribute('data-id'));
        else clearHighlight();
        return;
      }
      var pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
      var newX = svgP.x - dragOffset.x;
      var newY = svgP.y - dragOffset.y;
      positions[dragIdx].x = newX - offsetX + nodeW / 2;
      positions[dragIdx].y = newY - offsetY + nodeH / 2;
      dragNode.setAttribute('transform', 'translate(' + newX + ',' + newY + ')');

      // Update connected edges
      var nodeId = dragNode.getAttribute('data-id');
      var ncx = newX + nodeW / 2, ncy = newY + nodeH / 2;
      var edgeIdx = 0;
      for (var ei = 0; ei < graphEdges.length; ei++) {
        var si = idToIdx[graphEdges[ei].source];
        var ti = idToIdx[graphEdges[ei].target];
        if (si === undefined || ti === undefined) continue;
        if (graphEdges[ei].source === nodeId) {
          edgeEls[edgeIdx].setAttribute('x1', ncx);
          edgeEls[edgeIdx].setAttribute('y1', ncy);
        }
        if (graphEdges[ei].target === nodeId) {
          edgeEls[edgeIdx].setAttribute('x2', ncx);
          edgeEls[edgeIdx].setAttribute('y2', ncy);
        }
        var lx1 = parseFloat(edgeEls[edgeIdx].getAttribute('x1'));
        var ly1 = parseFloat(edgeEls[edgeIdx].getAttribute('y1'));
        var lx2 = parseFloat(edgeEls[edgeIdx].getAttribute('x2'));
        var ly2 = parseFloat(edgeEls[edgeIdx].getAttribute('y2'));
        edgeLabelEls[edgeIdx].setAttribute('x', (lx1 + lx2) / 2);
        edgeLabelEls[edgeIdx].setAttribute('y', (ly1 + ly2) / 2 - 6);
        edgeIdx++;
      }
    });

    svg.addEventListener('mouseup', function() {
      if (dragNode) {
        dragNode.style.cursor = 'grab';
        dragNode = null; dragIdx = -1;
      }
      if (isPanning) {
        isPanning = false;
        svg.style.cursor = 'default';
      }
    });

    // Scroll to zoom (towards cursor)
    svg.addEventListener('wheel', function(e) {
      e.preventDefault();
      var zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;

      // Get cursor position in SVG coords
      var pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

      // Zoom viewBox around cursor point
      var newW = vbCurW * zoomFactor;
      var newH = vbCurH * zoomFactor;
      vbX = svgP.x - (svgP.x - vbX) * zoomFactor;
      vbY = svgP.y - (svgP.y - vbY) * zoomFactor;
      vbCurW = newW;
      vbCurH = newH;
      updateViewBox();
    }, { passive: false });

    // Click to show detail (only if not dragging)
    svg.addEventListener('click', function(e) {
      var g = e.target.closest('.graph-node');
      if (g) showDetail(g.getAttribute('data-id'));
    });
  }

  // ── Replay (Event Stream only) ────────────────
  var evRows = document.querySelectorAll('.ev-row');
  var replayBar = document.getElementById('replay-bar');
  var replayBtn = document.getElementById('btn-replay');
  var replayToggle = document.getElementById('btn-replay-toggle');
  var scrubber = document.getElementById('replay-scrubber');
  var replayLabel = document.getElementById('replay-label');
  var speedBtn = document.getElementById('replay-speed');
  var replayActive = false;
  var replayPlaying = false;
  var replayTimer = null;
  var replayIndex = 0;
  var speeds = [1, 2, 4, 0.5];
  var speedIndex = 0;

  replayBtn.addEventListener('click', function() {
    replayActive = !replayActive;
    replayBar.classList.toggle('visible', replayActive);
    if (replayActive) {
      switchTab('stream');
      replayIndex = 0;
      scrubber.value = 0;
      updateReplay();
      showToast('Replay mode — scrub or press play');
    } else {
      stopReplay();
      for (var i = 0; i < evRows.length; i++) {
        evRows[i].style.display = '';
        evRows[i].classList.remove('highlighted');
      }
    }
  });

  replayToggle.addEventListener('click', function() {
    replayPlaying ? stopReplay() : startReplay();
  });

  scrubber.addEventListener('input', function() {
    replayIndex = parseInt(this.value);
    updateReplay();
  });

  speedBtn.addEventListener('click', function() {
    speedIndex = (speedIndex + 1) % speeds.length;
    speedBtn.textContent = speeds[speedIndex] + '×';
    if (replayPlaying) { stopReplay(); startReplay(); }
  });

  function updateReplay() {
    replayLabel.textContent = (replayIndex + 1) + ' / ' + totalEvents;
    for (var i = 0; i < evRows.length; i++) {
      evRows[i].style.display = i <= replayIndex ? '' : 'none';
      evRows[i].classList.toggle('highlighted', i === replayIndex);
    }
    if (evRows[replayIndex]) evRows[replayIndex].scrollIntoView({ block: 'nearest' });
  }

  function startReplay() {
    replayPlaying = true;
    replayToggle.textContent = '⏸';
    advanceReplay();
  }

  function stopReplay() {
    replayPlaying = false;
    replayToggle.textContent = '▶';
    if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
  }

  function advanceReplay() {
    if (!replayPlaying || replayIndex >= totalEvents - 1) { stopReplay(); return; }
    replayIndex++;
    scrubber.value = replayIndex;
    updateReplay();
    replayTimer = setTimeout(advanceReplay, 200 / speeds[speedIndex]);
  }

  // ── Timeline View ─────────────────────────────
  var tlSvg = document.getElementById('timeline-svg');
  var tlDetailPanel = document.getElementById('tl-detail');
  var tlDetailTitle = document.getElementById('tl-detail-title');
  var tlDetailBody = document.getElementById('tl-detail-body');
  var tlDetailClose = document.getElementById('tl-detail-close');
  var tlMode = 'swim';
  var tlRendered = false;

  // Color map for timeline event types (matches stream colors)
  var TL_COLORS = {
    'ev-goal': '#4ade80', 'ev-read': '#2EA043', 'ev-write': '#E07020',
    'ev-bash': '#8B5CF6', 'ev-tool': '#60a5fa', 'ev-graph': '#88aaff',
    'ev-object': '#c084fc', 'ev-relation': '#22d3ee', 'ev-behavior': '#fbbf24',
    'ev-llm': '#3b82f6', 'ev-patch': '#f97316', 'ev-custom': '#888',
    'ev-default': '#666', 'ev-redundant': '#EF4444'
  };

  function renderTimeline() {
    if (timelineEvents.length === 0) return;
    // Clear SVG
    while (tlSvg.firstChild) tlSvg.removeChild(tlSvg.firstChild);

    // Add arrowhead marker
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'tl-arrowhead');
    marker.setAttribute('viewBox', '0 0 10 7');
    marker.setAttribute('refX', '10'); marker.setAttribute('refY', '3.5');
    marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto-start-reverse');
    var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0 0, 10 3.5, 0 7');
    poly.setAttribute('fill', '#555');
    marker.appendChild(poly);
    defs.appendChild(marker);
    tlSvg.appendChild(defs);

    if (tlMode === 'swim') renderSwimLanes();
    else if (tlMode === 'causal') renderCausalChain();
    else if (tlMode === 'waterfall') renderWaterfall();
    tlRendered = true;
  }

  // ── Swim Lanes ──────────────────────────────
  function renderSwimLanes() {
    if (useAggregation) return renderSwimLanesAggregated();
    return renderSwimLanesRaw();
  }

  // Raw event-level swim lanes (≤100 events)
  function renderSwimLanesRaw() {
    var actorOrder = [];
    var actorSet = {};
    for (var i = 0; i < timelineEvents.length; i++) {
      var a = timelineEvents[i].actor;
      if (!actorSet[a]) { actorSet[a] = true; actorOrder.push(a); }
    }
    var laneH = 50, circleR = 12, labelW = 100;
    var xSpacing = Math.max(30, 800 / Math.max(timelineEvents.length, 1));
    var svgW = labelW + timelineEvents.length * xSpacing + 40;
    var svgH = actorOrder.length * laneH + 20;
    tlSvg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
    var actorLane = {};
    for (var i = 0; i < actorOrder.length; i++) actorLane[actorOrder[i]] = i;
    drawLaneBgs(actorOrder, laneH, svgW, labelW);
    var posMap = {};
    for (var i = 0; i < timelineEvents.length; i++) {
      var ev = timelineEvents[i];
      posMap[ev.id] = { cx: labelW + i * xSpacing + xSpacing / 2, cy: (actorLane[ev.actor] || 0) * laneH + laneH / 2 };
    }
    // Causal arrows
    for (var i = 0; i < timelineEvents.length; i++) {
      var ev = timelineEvents[i];
      if (ev.causedBy && posMap[ev.causedBy]) {
        var from = posMap[ev.causedBy], to = posMap[ev.id];
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M' + from.cx + ',' + from.cy + ' Q' + (from.cx+to.cx)/2 + ',' + ((from.cy+to.cy)/2-15) + ' ' + to.cx + ',' + to.cy);
        path.setAttribute('class', 'tl-causal-arrow');
        tlSvg.appendChild(path);
      }
    }
    // Event circles
    for (var i = 0; i < timelineEvents.length; i++) {
      var ev = timelineEvents[i], pos = posMap[ev.id], color = TL_COLORS[ev.cssClass] || '#666';
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'tl-event'); g.setAttribute('data-tl-idx', i);
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.cx); circle.setAttribute('cy', pos.cy);
      circle.setAttribute('r', circleR); circle.setAttribute('fill', color);
      circle.setAttribute('stroke', '#111'); circle.setAttribute('stroke-width', '1.5');
      g.appendChild(circle);
      var iconTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      iconTxt.setAttribute('x', pos.cx); iconTxt.setAttribute('y', pos.cy + 4);
      iconTxt.setAttribute('text-anchor', 'middle'); iconTxt.setAttribute('fill', '#fff');
      iconTxt.setAttribute('font-size', '9'); iconTxt.setAttribute('pointer-events', 'none');
      iconTxt.textContent = ev.icon;
      g.appendChild(iconTxt);
      tlSvg.appendChild(g);
    }
    bindTlEvents(); setupTlZoomPan();
  }

  // Aggregated goal-level swim lanes (>100 events)
  function renderSwimLanesAggregated() {
    // Actors from all events
    var actorOrder = [];
    var actorSet = {};
    for (var i = 0; i < timelineEvents.length; i++) {
      var a = timelineEvents[i].actor;
      if (!actorSet[a]) { actorSet[a] = true; actorOrder.push(a); }
    }
    var laneH = 50, labelW = 100;
    var xSpacing = Math.max(50, 900 / Math.max(goalBuckets.length, 1));
    var svgW = labelW + goalBuckets.length * xSpacing + 40;
    var svgH = actorOrder.length * laneH + 20;
    tlSvg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
    var actorLane = {};
    for (var i = 0; i < actorOrder.length; i++) actorLane[actorOrder[i]] = i;
    drawLaneBgs(actorOrder, laneH, svgW, labelW);

    // Draw goal buckets — one rounded rect per goal in the dominant actor's lane
    // Size reflects event count, mini stacked bars show actor breakdown
    for (var bi = 0; bi < goalBuckets.length; bi++) {
      var b = goalBuckets[bi];
      var cx = labelW + bi * xSpacing + xSpacing / 2;
      var lane = actorLane[b.dominantActor] || 0;
      var cy = lane * laneH + laneH / 2;
      // Radius proportional to event count (min 8, max 22)
      var r = Math.min(22, Math.max(8, 4 + Math.sqrt(b.eventCount) * 2.5));

      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'tl-event'); g.setAttribute('data-bucket-idx', bi);

      // Main circle
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx); circle.setAttribute('cy', cy);
      circle.setAttribute('r', r); circle.setAttribute('fill', '#2B5CE6');
      circle.setAttribute('fill-opacity', '0.3'); circle.setAttribute('stroke', '#2B5CE6');
      circle.setAttribute('stroke-width', '1.5');
      g.appendChild(circle);

      // Event count label
      var countTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      countTxt.setAttribute('x', cx); countTxt.setAttribute('y', cy + 4);
      countTxt.setAttribute('text-anchor', 'middle'); countTxt.setAttribute('fill', '#fff');
      countTxt.setAttribute('font-size', r > 14 ? '10' : '8');
      countTxt.setAttribute('pointer-events', 'none'); countTxt.setAttribute('font-weight', '600');
      countTxt.textContent = b.eventCount;
      g.appendChild(countTxt);

      // Goal number below
      if (r > 10) {
        var numTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        numTxt.setAttribute('x', cx); numTxt.setAttribute('y', cy + r + 12);
        numTxt.setAttribute('text-anchor', 'middle'); numTxt.setAttribute('fill', '#555');
        numTxt.setAttribute('font-size', '9'); numTxt.setAttribute('pointer-events', 'none');
        numTxt.textContent = '#' + b.goalIdx;
        g.appendChild(numTxt);
      }

      // Mini actor-breakdown dots above the circle
      var actorEntries = Object.entries(b.actorCounts).sort(function(a,b) { return b[1] - a[1]; });
      var dotX = cx - (actorEntries.length - 1) * 4;
      for (var ai = 0; ai < actorEntries.length; ai++) {
        var actorName = actorEntries[ai][0];
        var actorCount = actorEntries[ai][1];
        if (actorCount === 0) continue;
        var dotR = Math.min(4, Math.max(2, Math.sqrt(actorCount)));
        var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        var ACTOR_COLORS = { user: '#4ade80', agent: '#60a5fa', runtime: '#c084fc', thinking: '#818cf8', llm: '#3b82f6', behavior: '#fbbf24', governance: '#f97316' };
        dot.setAttribute('cx', dotX + ai * 8); dot.setAttribute('cy', cy - r - 6);
        dot.setAttribute('r', dotR); dot.setAttribute('fill', ACTOR_COLORS[actorName] || '#666');
        dot.setAttribute('pointer-events', 'none');
        g.appendChild(dot);
      }

      // Causal arrow to next bucket (sequential flow)
      if (bi < goalBuckets.length - 1) {
        var nextCx = labelW + (bi + 1) * xSpacing + xSpacing / 2;
        var nextB = goalBuckets[bi + 1];
        var nextLane = actorLane[nextB.dominantActor] || 0;
        var nextCy = nextLane * laneH + laneH / 2;
        var arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        if (lane === nextLane) {
          arrow.setAttribute('d', 'M' + (cx + r + 2) + ',' + cy + ' L' + (nextCx - Math.min(22, Math.max(8, 4 + Math.sqrt(nextB.eventCount) * 2.5)) - 2) + ',' + nextCy);
        } else {
          var midXA = (cx + nextCx) / 2;
          arrow.setAttribute('d', 'M' + (cx + r + 2) + ',' + cy + ' Q' + midXA + ',' + ((cy + nextCy) / 2 - 10) + ' ' + (nextCx - Math.min(22, Math.max(8, 4 + Math.sqrt(nextB.eventCount) * 2.5)) - 2) + ',' + nextCy);
        }
        arrow.setAttribute('class', 'tl-causal-arrow');
        tlSvg.appendChild(arrow);
      }

      tlSvg.appendChild(g);
    }

    // Tooltip for buckets
    var tooltip = document.getElementById('tooltip');
    tlSvg.addEventListener('mouseover', function(e) {
      var g = e.target.closest('.tl-event');
      if (!g) { tooltip.style.display = 'none'; return; }
      var bIdx = g.getAttribute('data-bucket-idx');
      if (bIdx !== null) {
        var b = goalBuckets[parseInt(bIdx)];
        if (!b) return;
        var lines = ['Goal #' + b.goalIdx + ': ' + b.goalLabel, b.eventCount + ' events', ''];
        var entries = Object.entries(b.actorCounts).sort(function(a,b) { return b[1] - a[1]; });
        for (var j = 0; j < entries.length; j++) lines.push('  ' + entries[j][0] + ': ' + entries[j][1]);
        tooltip.textContent = lines.join('\\n');
        tooltip.style.display = 'block';
        return;
      }
      var idx = g.getAttribute('data-tl-idx');
      if (idx !== null) {
        var ev = timelineEvents[parseInt(idx)];
        if (!ev) return;
        var ts = new Date(ev.timestamp);
        var timeStr = String(ts.getHours()).padStart(2,'0') + ':' + String(ts.getMinutes()).padStart(2,'0') + ':' + String(ts.getSeconds()).padStart(2,'0');
        tooltip.textContent = timeStr + ' [' + ev.actor + '] ' + ev.type + '\\n' + ev.label;
        tooltip.style.display = 'block';
      }
    });
    tlSvg.addEventListener('mousemove', function(e) {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
      }
    });
    tlSvg.addEventListener('mouseout', function(e) {
      if (!e.target.closest('.tl-event') && !e.target.closest('.tl-node')) tooltip.style.display = 'none';
    });

    // Click bucket → show detail with event breakdown + option to drill in
    tlSvg.addEventListener('click', function(e) {
      var g = e.target.closest('.tl-event') || e.target.closest('.tl-node');
      if (!g) return;
      var bIdx = g.getAttribute('data-bucket-idx');
      if (bIdx !== null) {
        showBucketDetail(goalBuckets[parseInt(bIdx)]);
        return;
      }
      var idx = g.getAttribute('data-tl-idx');
      if (idx !== null) {
        showTlDetail(timelineEvents[parseInt(idx)]);
      }
    });

    setupTlZoomPan();
  }

  // Helper: draw lane backgrounds + labels
  function drawLaneBgs(actorOrder, laneH, svgW, labelW) {
    for (var i = 0; i < actorOrder.length; i++) {
      var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', 0); bg.setAttribute('y', i * laneH);
      bg.setAttribute('width', svgW); bg.setAttribute('height', laneH);
      bg.setAttribute('class', 'tl-lane-bg' + (i % 2 === 1 ? ' alt' : ''));
      tlSvg.appendChild(bg);
      var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', 12); txt.setAttribute('y', i * laneH + laneH / 2 + 4);
      txt.setAttribute('class', 'tl-lane-label');
      txt.textContent = actorOrder[i];
      tlSvg.appendChild(txt);
    }
  }

  // Bind tooltip + click for raw event nodes
  function bindTlEvents() {
    var tooltip = document.getElementById('tooltip');
    tlSvg.addEventListener('mouseover', function(e) {
      var g = e.target.closest('.tl-event') || e.target.closest('.tl-node');
      if (!g) { tooltip.style.display = 'none'; return; }
      var idx = parseInt(g.getAttribute('data-tl-idx'));
      var ev = timelineEvents[idx];
      if (!ev) return;
      var ts = new Date(ev.timestamp);
      var timeStr = String(ts.getHours()).padStart(2,'0') + ':' + String(ts.getMinutes()).padStart(2,'0') + ':' + String(ts.getSeconds()).padStart(2,'0');
      tooltip.textContent = timeStr + ' [' + ev.actor + '] ' + ev.type + '\\n' + ev.label;
      tooltip.style.display = 'block';
    });
    tlSvg.addEventListener('mousemove', function(e) {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
      }
    });
    tlSvg.addEventListener('mouseout', function(e) {
      if (!e.target.closest('.tl-event') && !e.target.closest('.tl-node')) tooltip.style.display = 'none';
    });
    tlSvg.addEventListener('click', function(e) {
      var g = e.target.closest('.tl-event') || e.target.closest('.tl-node');
      if (!g) return;
      var idx = parseInt(g.getAttribute('data-tl-idx'));
      var ev = timelineEvents[idx];
      if (ev) showTlDetail(ev);
    });
  }

  // ── Causal Chain ────────────────────────────
  function renderCausalChain() {
    if (useAggregation) return renderCausalChainAggregated();
    return renderCausalChainRaw();
  }

  // Raw event-level causal chain (≤100 events)
  function renderCausalChainRaw() {
    var idSet = {};
    for (var i = 0; i < timelineEvents.length; i++) idSet[timelineEvents[i].id] = i;
    var roots = [], childrenOf = {}, lastGoalId = null;
    for (var i = 0; i < timelineEvents.length; i++) {
      var ev = timelineEvents[i];
      var parentId = ev.causedBy;
      var isOrphan = !parentId || idSet[parentId] === undefined;
      if (ev.type === 'goal.set' || ev.type === 'goal_started') {
        roots.push(i); lastGoalId = ev.id;
      } else if (!isOrphan) {
        if (!childrenOf[parentId]) childrenOf[parentId] = [];
        childrenOf[parentId].push(i);
      } else if (lastGoalId) {
        if (!childrenOf[lastGoalId]) childrenOf[lastGoalId] = [];
        childrenOf[lastGoalId].push(i);
      } else { roots.push(i); }
    }
    var nodeW = 140, nodeH = 28, gapX = 30, gapY = 6;
    var positions = [], row = 0;
    function layoutNode(idx, depth) {
      var ev = timelineEvents[idx]; var y = row; row++;
      var kids = childrenOf[ev.id] || [];
      for (var c = 0; c < kids.length; c++) layoutNode(kids[c], depth + 1);
      positions[idx] = { x: depth * (nodeW + gapX) + 20, y: y * (nodeH + gapY) + 20 };
    }
    for (var r = 0; r < roots.length; r++) layoutNode(roots[r], 0);
    var maxX = 0, maxY = 0;
    for (var i = 0; i < timelineEvents.length; i++) {
      if (!positions[i]) continue;
      if (positions[i].x + nodeW > maxX) maxX = positions[i].x + nodeW;
      if (positions[i].y + nodeH > maxY) maxY = positions[i].y + nodeH;
    }
    tlSvg.setAttribute('viewBox', '0 0 ' + (maxX + 40) + ' ' + (maxY + 40));
    // Edges
    for (var i = 0; i < timelineEvents.length; i++) {
      var ev = timelineEvents[i], kids = childrenOf[ev.id] || [], pPos = positions[i];
      if (!pPos) continue;
      for (var c = 0; c < kids.length; c++) {
        var cPos = positions[kids[c]]; if (!cPos) continue;
        var midX = pPos.x + nodeW + (gapX / 2);
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M'+(pPos.x+nodeW)+','+(pPos.y+nodeH/2)+' H'+midX+' V'+(cPos.y+nodeH/2)+' H'+cPos.x);
        path.setAttribute('class', 'tl-edge'); tlSvg.appendChild(path);
      }
    }
    // Nodes
    for (var i = 0; i < timelineEvents.length; i++) {
      var ev = timelineEvents[i], pos = positions[i]; if (!pos) continue;
      var color = TL_COLORS[ev.cssClass] || '#666';
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'tl-node'); g.setAttribute('data-tl-idx', i);
      var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', pos.x); rect.setAttribute('y', pos.y);
      rect.setAttribute('width', nodeW); rect.setAttribute('height', nodeH);
      rect.setAttribute('rx', 4); rect.setAttribute('ry', 4);
      rect.setAttribute('fill', color); rect.setAttribute('fill-opacity', '0.2');
      rect.setAttribute('stroke', color); rect.setAttribute('stroke-width', '1');
      g.appendChild(rect);
      var iconTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      iconTxt.setAttribute('x', pos.x + 6); iconTxt.setAttribute('y', pos.y + nodeH/2 + 4);
      iconTxt.setAttribute('fill', color); iconTxt.setAttribute('font-size', '10');
      iconTxt.setAttribute('pointer-events', 'none'); iconTxt.textContent = ev.icon;
      g.appendChild(iconTxt);
      var labelTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelTxt.setAttribute('x', pos.x + 20); labelTxt.setAttribute('y', pos.y + nodeH/2 + 4);
      labelTxt.setAttribute('fill', '#ccc'); labelTxt.setAttribute('font-size', '10');
      labelTxt.setAttribute('pointer-events', 'none');
      labelTxt.setAttribute('font-family', "'SF Mono', Monaco, monospace");
      labelTxt.textContent = ev.label.length > 16 ? ev.label.slice(0, 14) + '…' : ev.label;
      g.appendChild(labelTxt);
      tlSvg.appendChild(g);
    }
    bindTlEvents(); setupTlZoomPan();
  }

  // Aggregated goal-level causal chain (>100 events)
  function renderCausalChainAggregated() {
    var nodeW = 200, nodeH = 36, gapX = 40, gapY = 10;
    var positions = [];
    // Simple vertical list with type-breakdown bars
    for (var i = 0; i < goalBuckets.length; i++) {
      positions.push({ x: 20, y: i * (nodeH + gapY) + 20 });
    }
    var svgH = goalBuckets.length * (nodeH + gapY) + 40;
    tlSvg.setAttribute('viewBox', '0 0 ' + (nodeW + 60) + ' ' + svgH);

    // Vertical connector line
    if (goalBuckets.length > 1) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 10); line.setAttribute('y1', 20 + nodeH / 2);
      line.setAttribute('x2', 10); line.setAttribute('y2', positions[positions.length - 1].y + nodeH / 2);
      line.setAttribute('class', 'tl-edge'); tlSvg.appendChild(line);
    }

    // Draw goal nodes with stacked type-breakdown bar
    var ACTOR_COLORS = { user: '#4ade80', agent: '#60a5fa', runtime: '#c084fc', llm: '#3b82f6', behavior: '#fbbf24', governance: '#f97316' };
    for (var i = 0; i < goalBuckets.length; i++) {
      var b = goalBuckets[i], pos = positions[i];

      // Connector dot on the left line
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', 10); dot.setAttribute('cy', pos.y + nodeH / 2);
      dot.setAttribute('r', 4); dot.setAttribute('fill', '#2B5CE6');
      tlSvg.appendChild(dot);

      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'tl-node'); g.setAttribute('data-bucket-idx', i);

      // Background rect
      var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', pos.x); rect.setAttribute('y', pos.y);
      rect.setAttribute('width', nodeW); rect.setAttribute('height', nodeH);
      rect.setAttribute('rx', 4); rect.setAttribute('ry', 4);
      rect.setAttribute('fill', '#1e1e38'); rect.setAttribute('stroke', '#2a2a4a');
      rect.setAttribute('stroke-width', '1');
      g.appendChild(rect);

      // Goal label
      var labelTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelTxt.setAttribute('x', pos.x + 8); labelTxt.setAttribute('y', pos.y + 14);
      labelTxt.setAttribute('fill', '#88aaff'); labelTxt.setAttribute('font-size', '11');
      labelTxt.setAttribute('font-weight', '600'); labelTxt.setAttribute('pointer-events', 'none');
      labelTxt.textContent = '#' + b.goalIdx + ' ' + (b.goalLabel.length > 22 ? b.goalLabel.slice(0,20) + '…' : b.goalLabel);
      g.appendChild(labelTxt);

      // Stacked bar showing actor breakdown
      var barY = pos.y + nodeH - 10, barH = 6, barMaxW = nodeW - 16;
      var totalE = b.eventCount;
      var barX = pos.x + 8;
      var entries = Object.entries(b.actorCounts).sort(function(a,b) { return b[1] - a[1]; });
      for (var j = 0; j < entries.length; j++) {
        var segW = (entries[j][1] / totalE) * barMaxW;
        if (segW < 1) segW = 1;
        var seg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        seg.setAttribute('x', barX); seg.setAttribute('y', barY);
        seg.setAttribute('width', segW); seg.setAttribute('height', barH);
        seg.setAttribute('rx', 1); seg.setAttribute('fill', ACTOR_COLORS[entries[j][0]] || '#666');
        seg.setAttribute('fill-opacity', '0.7'); seg.setAttribute('pointer-events', 'none');
        g.appendChild(seg);
        barX += segW;
      }

      // Event count on right
      var countTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      countTxt.setAttribute('x', pos.x + nodeW - 8); countTxt.setAttribute('y', pos.y + 14);
      countTxt.setAttribute('text-anchor', 'end'); countTxt.setAttribute('fill', '#555');
      countTxt.setAttribute('font-size', '10'); countTxt.setAttribute('pointer-events', 'none');
      countTxt.textContent = b.eventCount + ' ev';
      g.appendChild(countTxt);

      tlSvg.appendChild(g);
    }

    // Tooltip + click for buckets
    var tooltip = document.getElementById('tooltip');
    tlSvg.addEventListener('mouseover', function(e) {
      var g = e.target.closest('.tl-node');
      if (!g) { tooltip.style.display = 'none'; return; }
      var bIdx = g.getAttribute('data-bucket-idx');
      if (bIdx === null) return;
      var b = goalBuckets[parseInt(bIdx)];
      if (!b) return;
      var lines = ['Goal #' + b.goalIdx + ': ' + b.goalLabel, b.eventCount + ' events', ''];
      var entries = Object.entries(b.actorCounts).sort(function(a,b) { return b[1] - a[1]; });
      for (var j = 0; j < entries.length; j++) lines.push('  ' + entries[j][0] + ': ' + entries[j][1]);
      tooltip.textContent = lines.join('\\n');
      tooltip.style.display = 'block';
    });
    tlSvg.addEventListener('mousemove', function(e) {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 12) + 'px'; tooltip.style.top = (e.clientY + 12) + 'px';
      }
    });
    tlSvg.addEventListener('mouseout', function(e) {
      if (!e.target.closest('.tl-node')) tooltip.style.display = 'none';
    });
    tlSvg.addEventListener('click', function(e) {
      var g = e.target.closest('.tl-node');
      if (!g) return;
      var bIdx = g.getAttribute('data-bucket-idx');
      if (bIdx !== null) showBucketDetail(goalBuckets[parseInt(bIdx)]);
    });

    setupTlZoomPan();
  }

  // ── Waterfall (Phase Gantt per goal) ─────────
  function renderWaterfall() {
    if (goalBuckets.length === 0) return;
    var rowH = 32, labelW = 180, barMaxW = 500, gapY = 4;
    var svgW = labelW + barMaxW + 60;
    var svgH = goalBuckets.length * (rowH + gapY) + 40;
    tlSvg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);

    var PHASE_COLORS = { thinking: '#60a5fa', research: '#4ade80', implement: '#fb923c', verify: '#a78bfa', other: '#333' };

    // Header row
    var headerY = 10;
    var headers = [
      { label: 'Thinking', color: PHASE_COLORS.thinking, x: labelW },
      { label: 'Research', color: PHASE_COLORS.research, x: labelW + 90 },
      { label: 'Implement', color: PHASE_COLORS.implement, x: labelW + 180 },
      { label: 'Verify', color: PHASE_COLORS.verify, x: labelW + 280 },
    ];
    for (var h = 0; h < headers.length; h++) {
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', headers[h].x); dot.setAttribute('cy', headerY);
      dot.setAttribute('r', 4); dot.setAttribute('fill', headers[h].color);
      tlSvg.appendChild(dot);
      var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', headers[h].x + 8); txt.setAttribute('y', headerY + 4);
      txt.setAttribute('fill', '#888'); txt.setAttribute('font-size', '10');
      txt.textContent = headers[h].label;
      tlSvg.appendChild(txt);
    }

    var startY = 28;

    for (var i = 0; i < goalBuckets.length; i++) {
      var b = goalBuckets[i];
      var y = startY + i * (rowH + gapY);
      var toolEvents = b.phases.research + b.phases.implement + b.phases.verify + b.phases.other;

      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'tl-node'); g.setAttribute('data-bucket-idx', i);

      // Row background
      var bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('x', 0); bgRect.setAttribute('y', y);
      bgRect.setAttribute('width', svgW); bgRect.setAttribute('height', rowH);
      bgRect.setAttribute('fill', i % 2 === 0 ? '#16162e' : '#1a1a32');
      bgRect.setAttribute('class', 'tl-lane-bg');
      g.appendChild(bgRect);

      // Goal label
      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', 8); label.setAttribute('y', y + rowH / 2 + 4);
      label.setAttribute('fill', toolEvents > 0 ? '#88aaff' : '#555');
      label.setAttribute('font-size', '11');
      label.setAttribute('pointer-events', 'none');
      var labelStr = '#' + b.goalIdx + ' ' + b.goalLabel;
      label.textContent = labelStr.length > 24 ? labelStr.slice(0, 22) + '…' : labelStr;
      g.appendChild(label);

      // Phase bar (stacked horizontal)
      if (toolEvents > 0) {
        var barX = labelW;
        var scale = barMaxW / Math.max(toolEvents, 1);
        var phases = [
          { key: 'thinking', count: b.phases.thinking },
          { key: 'research', count: b.phases.research },
          { key: 'implement', count: b.phases.implement },
          { key: 'verify', count: b.phases.verify },
          { key: 'other', count: b.phases.other },
        ];
        for (var p = 0; p < phases.length; p++) {
          if (phases[p].count === 0) continue;
          var segW = Math.max(2, phases[p].count * scale);
          var seg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          seg.setAttribute('x', barX); seg.setAttribute('y', y + 6);
          seg.setAttribute('width', segW); seg.setAttribute('height', rowH - 12);
          seg.setAttribute('rx', 2);
          seg.setAttribute('fill', PHASE_COLORS[phases[p].key]);
          seg.setAttribute('fill-opacity', '0.7');
          seg.setAttribute('pointer-events', 'none');
          g.appendChild(seg);

          // Count label inside segment if wide enough
          if (segW > 18) {
            var cTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            cTxt.setAttribute('x', barX + segW / 2); cTxt.setAttribute('y', y + rowH / 2 + 4);
            cTxt.setAttribute('text-anchor', 'middle'); cTxt.setAttribute('fill', '#fff');
            cTxt.setAttribute('font-size', '9'); cTxt.setAttribute('pointer-events', 'none');
            cTxt.textContent = phases[p].count;
            g.appendChild(cTxt);
          }
          barX += segW;
        }

        // File count on right
        if (b.filesTouched.length > 0) {
          var fileTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          fileTxt.setAttribute('x', barX + 8); fileTxt.setAttribute('y', y + rowH / 2 + 4);
          fileTxt.setAttribute('fill', '#555'); fileTxt.setAttribute('font-size', '9');
          fileTxt.setAttribute('pointer-events', 'none');
          fileTxt.textContent = b.filesTouched.length + ' files';
          g.appendChild(fileTxt);
        }
      } else {
        // No tool events — show "(planning)" marker
        var planTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        planTxt.setAttribute('x', labelW + 4); planTxt.setAttribute('y', y + rowH / 2 + 4);
        planTxt.setAttribute('fill', '#444'); planTxt.setAttribute('font-size', '10');
        planTxt.setAttribute('font-style', 'italic'); planTxt.setAttribute('pointer-events', 'none');
        planTxt.textContent = 'planning / discussion';
        g.appendChild(planTxt);
      }

      tlSvg.appendChild(g);
    }

    // Tooltip + click
    var tooltip = document.getElementById('tooltip');
    tlSvg.addEventListener('mouseover', function(e) {
      var g = e.target.closest('.tl-node');
      if (!g) { tooltip.style.display = 'none'; return; }
      var bIdx = g.getAttribute('data-bucket-idx');
      if (bIdx === null) return;
      var b = goalBuckets[parseInt(bIdx)];
      if (!b) return;
      var lines = ['Goal #' + b.goalIdx + ': ' + b.goalLabel, ''];
      lines.push('Thinking: ' + b.phases.thinking + '  Research: ' + b.phases.research + '  Implement: ' + b.phases.implement + '  Verify: ' + b.phases.verify);
      if (b.filesTouched.length > 0) {
        lines.push(''); lines.push('Files:');
        for (var j = 0; j < Math.min(8, b.filesTouched.length); j++) lines.push('  ' + b.filesTouched[j]);
        if (b.filesTouched.length > 8) lines.push('  +' + (b.filesTouched.length - 8) + ' more');
      }
      tooltip.textContent = lines.join('\\n');
      tooltip.style.display = 'block';
    });
    tlSvg.addEventListener('mousemove', function(e) {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 12) + 'px'; tooltip.style.top = (e.clientY + 12) + 'px';
      }
    });
    tlSvg.addEventListener('mouseout', function(e) {
      if (!e.target.closest('.tl-node')) tooltip.style.display = 'none';
    });
    tlSvg.addEventListener('click', function(e) {
      var g = e.target.closest('.tl-node');
      if (!g) return;
      var bIdx = g.getAttribute('data-bucket-idx');
      if (bIdx !== null) showBucketDetail(goalBuckets[parseInt(bIdx)]);
    });

    setupTlZoomPan();
  }

  // ── Detail sidebar (shared) ─────────────────
  function showTlDetail(ev) {
    var ts = new Date(ev.timestamp);
    var timeStr = String(ts.getHours()).padStart(2,'0') + ':' + String(ts.getMinutes()).padStart(2,'0') + ':' + String(ts.getSeconds()).padStart(2,'0');
    tlDetailTitle.textContent = ev.icon + ' ' + ev.type;
    var lines = [];
    lines.push('Actor: ' + ev.actor);
    lines.push('Time: ' + timeStr);
    lines.push('ID: ' + ev.id);
    if (ev.causedBy) lines.push('Caused by: ' + ev.causedBy);
    lines.push('');
    lines.push(JSON.stringify(ev.payload, null, 2));
    tlDetailBody.textContent = lines.join('\\n');
    tlDetailPanel.classList.add('visible');
  }

  // Bucket detail: shows goal summary + event list
  function showBucketDetail(bucket) {
    tlDetailTitle.textContent = '★ Goal #' + bucket.goalIdx;
    var lines = [];
    lines.push(bucket.goalLabel);
    lines.push('');
    lines.push(bucket.eventCount + ' events');
    lines.push('');
    // Actor breakdown
    var entries = Object.entries(bucket.actorCounts).sort(function(a,b) { return b[1] - a[1]; });
    for (var j = 0; j < entries.length; j++) {
      lines.push('  ' + entries[j][0] + ': ' + entries[j][1]);
    }
    lines.push('');
    // Event list
    lines.push('─── Events ───');
    for (var j = 0; j < bucket.eventIndices.length; j++) {
      var ev = timelineEvents[bucket.eventIndices[j]];
      if (!ev) continue;
      var ts = new Date(ev.timestamp);
      var t = String(ts.getHours()).padStart(2,'0') + ':' + String(ts.getMinutes()).padStart(2,'0') + ':' + String(ts.getSeconds()).padStart(2,'0');
      lines.push(t + ' [' + ev.actor + '] ' + ev.type);
      if (ev.label !== ev.type) lines.push('  ' + ev.label);
    }
    tlDetailBody.textContent = lines.join('\\n');
    tlDetailPanel.classList.add('visible');
  }

  tlDetailClose.addEventListener('click', function() {
    tlDetailPanel.classList.remove('visible');
  });

  // ── Zoom + Pan (reused for both modes) ──────
  function setupTlZoomPan() {
    var vb = tlSvg.getAttribute('viewBox').split(' ').map(Number);
    var tlVbX = vb[0], tlVbY = vb[1], tlVbW = vb[2], tlVbH = vb[3];
    var tlPanning = false, tlPanStart = {x:0,y:0}, tlPanVbStart = {x:0,y:0};

    function updateTlVb() {
      tlSvg.setAttribute('viewBox', tlVbX + ' ' + tlVbY + ' ' + tlVbW + ' ' + tlVbH);
    }

    tlSvg.addEventListener('mousedown', function(e) {
      if (e.target.closest('.tl-event') || e.target.closest('.tl-node')) return;
      tlPanning = true;
      tlPanStart.x = e.clientX; tlPanStart.y = e.clientY;
      tlPanVbStart.x = tlVbX; tlPanVbStart.y = tlVbY;
      tlSvg.style.cursor = 'grabbing';
    });
    tlSvg.addEventListener('mousemove', function(e) {
      if (!tlPanning) return;
      var scale = tlVbW / tlSvg.clientWidth;
      tlVbX = tlPanVbStart.x - (e.clientX - tlPanStart.x) * scale;
      tlVbY = tlPanVbStart.y - (e.clientY - tlPanStart.y) * scale;
      updateTlVb();
    });
    tlSvg.addEventListener('mouseup', function() {
      tlPanning = false; tlSvg.style.cursor = 'default';
    });
    tlSvg.addEventListener('wheel', function(e) {
      e.preventDefault();
      var zf = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      var pt = tlSvg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var sp = pt.matrixTransform(tlSvg.getScreenCTM().inverse());
      tlVbX = sp.x - (sp.x - tlVbX) * zf;
      tlVbY = sp.y - (sp.y - tlVbY) * zf;
      tlVbW *= zf; tlVbH *= zf;
      updateTlVb();
    }, { passive: false });
  }

  // ── Mode toggle ─────────────────────────────
  var tlModeButtons = document.querySelectorAll('.tl-mode');
  for (var i = 0; i < tlModeButtons.length; i++) {
    tlModeButtons[i].addEventListener('click', function() {
      for (var j = 0; j < tlModeButtons.length; j++) tlModeButtons[j].classList.remove('active');
      this.classList.add('active');
      tlMode = this.getAttribute('data-mode');
      renderTimeline();
    });
  }

  // ── Download ──────────────────────────────────
  document.getElementById('btn-download').addEventListener('click', function() {
    var html = '<!DOCTYPE html>' + document.documentElement.outerHTML;
    var blob = new Blob([html], { type: 'text/html' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'operad-session.html';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Downloaded operad-session.html');
  });

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── Feedback panel ─────────────────────────────────────
  (function() {
    var overlay = document.getElementById('fb-overlay');
    var openBtn = document.getElementById('btn-feedback');
    var closeBtn = document.getElementById('fb-close');
    var textarea = document.getElementById('fb-text');
    var submitBtn = document.getElementById('fb-submit');
    var hint = document.getElementById('fb-hint');
    if (!overlay || !openBtn || !textarea || !submitBtn) return;

    var fbType = 'comment';
    var tabs = overlay.querySelectorAll('.fb-tab');

    openBtn.addEventListener('click', function() { overlay.classList.add('open'); textarea.focus(); });
    if (closeBtn) closeBtn.addEventListener('click', function() { overlay.classList.remove('open'); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.classList.remove('open'); });

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        fbType = tab.getAttribute('data-fb-type');
        if (fbType === 'comment') {
          textarea.placeholder = 'What do you think about this session?';
          hint.textContent = 'Comments are attached to this session.';
        } else {
          textarea.placeholder = 'Bug report, feature idea, or general thoughts about Operad...';
          hint.textContent = 'This opens a GitHub Discussion on the Operad repo.';
        }
      });
    });

    submitBtn.addEventListener('click', function() {
      var text = (textarea.value || '').trim();
      if (!text) { textarea.style.borderColor = '#ef4444'; return; }
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      fetch('https://operad.sh/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: fbType,
          message: text,
          sessionUrl: window.location.href,
        })
      }).then(function(res) {
        if (res.ok) {
          textarea.value = '';
          submitBtn.textContent = 'Sent!';
          setTimeout(function() {
            overlay.classList.remove('open');
            submitBtn.textContent = 'Send';
            submitBtn.disabled = false;
          }, 1500);
          showToast(fbType === 'comment' ? 'Comment saved.' : 'Feedback submitted to GitHub.');
        } else {
          submitBtn.textContent = 'Send';
          submitBtn.disabled = false;
          showToast('Something went wrong.');
        }
      }).catch(function() {
        submitBtn.textContent = 'Send';
        submitBtn.disabled = false;
        showToast('Network error.');
      });
    });
  })();

  // ─── Subscribe banner (shown after first interaction) ──
  (function() {
    var banner = document.getElementById('subscribe-banner');
    var emailInput = document.getElementById('subscribe-email');
    var btn = document.getElementById('subscribe-btn');
    var dismissBtn = document.getElementById('subscribe-dismiss');
    if (!banner || !emailInput || !btn) return;

    // Already handled — stay hidden forever
    if (localStorage.getItem('operad-subscribed') || localStorage.getItem('operad-dismiss-subscribe')) return;

    // Reveal on first meaningful interaction
    var revealed = false;
    function revealBanner() {
      if (revealed) return;
      revealed = true;
      banner.classList.remove('hidden');
    }

    // Listen on interactive elements: goals, replay, tree nodes, event rows, tabs
    document.querySelectorAll('.goal-item, .ev-row, .tab, .gt-goal-item').forEach(function(el) {
      el.addEventListener('click', revealBanner, { once: true });
    });
    var replayBtn = document.getElementById('btn-replay');
    if (replayBtn) replayBtn.addEventListener('click', revealBanner, { once: true });
    document.addEventListener('click', function(e) {
      if (e.target.closest && (e.target.closest('.tree-node') || e.target.closest('.tl-event'))) revealBanner();
    });

    if (dismissBtn) dismissBtn.addEventListener('click', function() {
      banner.classList.add('hidden');
      localStorage.setItem('operad-dismiss-subscribe', '1');
    });

    btn.addEventListener('click', function() {
      var email = (emailInput.value || '').trim();
      if (!email || email.indexOf('@') < 1) {
        emailInput.style.borderColor = '#ef4444';
        return;
      }
      btn.disabled = true;
      btn.textContent = '...';
      fetch('https://operad.sh/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function(res) {
        if (res.ok) {
          banner.innerHTML = '<span class="subscribe-ok">Thanks! We will let you know when Operad launches.</span>';
          localStorage.setItem('operad-subscribed', '1');
        } else {
          btn.textContent = 'Notify me';
          btn.disabled = false;
          showToast('Something went wrong.');
        }
      }).catch(function() {
        btn.textContent = 'Notify me';
        btn.disabled = false;
        showToast('Network error.');
      });
    });

    emailInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') btn.click();
      emailInput.style.borderColor = '#2a2a4a';
    });
  })();
})();
</script>
</body>
</html>`
}
