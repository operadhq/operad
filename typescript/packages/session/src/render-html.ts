/**
 * HTML graph renderer — Timeline + Tree split-panel visualization.
 *
 * Generates a self-contained HTML file (~18KB) with no external dependencies.
 * Left panel: chronological goal list with replay controls.
 * Right panel: selected goal's tree with fork markers.
 *
 * Pure function — no I/O. Caller writes the file and opens the browser.
 */
import type { RenderableObject, RenderableRelation } from '@operad/core'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RenderHtmlOptions {
  /** Title shown in the page header */
  title?: string
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

  return buildHtml(title, goals, goalChildren, nodeData, stats)
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

  /* Responsive */
  @media (max-width: 768px) {
    .main { flex-direction: column; }
    .left-panel { width: 100%; max-width: none; height: 40%; min-width: auto; border-right: none; border-bottom: 1px solid #2a2a4a; }
    .right-panel { height: 60%; }
    .toolbar { padding: 0 8px; }
    .toolbar .session-info { display: none; }
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
  </div>
</div>

<div class="tooltip" id="tooltip"></div>
<div class="toast" id="toast"></div>

<script>
(function() {
  var goalChildren = ${JSON.stringify(goalChildren)};
  var nodeData = ${JSON.stringify(nodeData)};
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

  // ─── Fork Point ─────────────────────────────────────────
  function setForkPoint(goalId) {
    if (forkPointId === goalId) {
      // Toggle off
      forkPointId = null;
      for (var i = 0; i < goalItems.length; i++) {
        goalItems[i].classList.remove('forked', 'dimmed');
      }
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
    showToast('Fork point set at goal #' + (parseInt(document.querySelector('[data-id="' + goalId + '"]').getAttribute('data-index')) + 1));
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
})();
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
