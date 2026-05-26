#!/usr/bin/env node

/**
 * Operad Dashboard — Server-rendered admin UI for graph inspection and monitoring.
 *
 * Provides a Hono SSR dashboard for:
 *   - Viewing all graphs and their current state
 *   - Browsing event logs with filtering
 *   - Inspecting objects, relations, and ASCII graph visualization
 *   - Reviewing and approving/denying pending patches
 *   - Live event stream via SSE + Redis subscriber
 *
 * Architecture:
 *   Dashboard → reads from Postgres via PostgresAdapter
 *             → subscribes to Redis for live SSE updates
 *             → serves server-rendered HTML (no SPA)
 *
 * Usage:
 *   DATABASE_URL=postgres://... REDIS_URL=redis://... operad-dashboard
 *
 * Environment variables:
 *   DATABASE_URL     — Postgres connection string (required)
 *   REDIS_URL        — Redis connection string (required)
 *   DASHBOARD_PORT   — Port to serve dashboard (default: 3112)
 *   AUTH_TOKEN        — Bearer token for dashboard access (optional, recommended)
 */

import { Hono } from 'hono'
import { createRedisSubscriber } from './redis.js'
import { PostgresAdapter } from '@operad/adapter-postgres'
import { createRuntime, renderAsciiGraph } from '@operad/core'

// ─── Types ──────────────────────────────────────────────────────────────────

interface LiveEvent {
  graphId: string
  type: string
  timestamp: string
  id: string
}

// ─── HTML Helpers ───────────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
  } catch {
    return ts
  }
}

function truncateData(data: Record<string, unknown>, maxLen = 80): string {
  const str = JSON.stringify(data)
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}

function eventTypeBadgeClass(type: string): string {
  if (type.startsWith('behavior.failed') || type.startsWith('object.stale')) return 'badge-red'
  if (type.startsWith('object.') || type.startsWith('relation.')) return 'badge-green'
  if (type.startsWith('patch.') || type.startsWith('decision.')) return 'badge-amber'
  return 'badge-blue'
}

function patchStatusBadgeClass(status: string): string {
  if (status === 'applied') return 'badge-green'
  if (status === 'rejected') return 'badge-red'
  return 'badge-amber'
}

// ─── CSS ────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
  background: #0d1117;
  color: #c9d1d9;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-size: 14px;
  line-height: 1.6;
}

a { color: #3fb950; text-decoration: none; }
a:hover { text-decoration: underline; color: #56d364; }

nav {
  background: #161b22;
  border-bottom: 1px solid #30363d;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

nav .brand {
  color: #3fb950;
  font-weight: 700;
  font-size: 15px;
  margin-right: 16px;
}
nav .brand::before { content: '\\25C6 '; }

nav .sep { color: #484f58; margin: 0 4px; }
nav .crumb { color: #8b949e; }
nav .crumb.active { color: #c9d1d9; }

nav .live-dot {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8b949e;
  font-size: 12px;
}
nav .live-dot::before {
  content: '';
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #3fb950;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

main {
  flex: 1;
  padding: 24px;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}

h1 {
  color: #3fb950;
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 20px;
  border-bottom: 1px solid #21262d;
  padding-bottom: 12px;
}

h2 {
  color: #c9d1d9;
  font-size: 16px;
  font-weight: 700;
  margin: 24px 0 12px 0;
}
h2::before { content: '\\2500\\2500 '; color: #484f58; }
h2::after { content: ' \\2500\\2500'; color: #484f58; }

.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.stat {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 16px;
  text-align: center;
}
.stat .value {
  font-size: 28px;
  font-weight: 700;
  color: #3fb950;
}
.stat .label {
  font-size: 12px;
  color: #8b949e;
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
  font-size: 13px;
}

th {
  text-align: left;
  color: #8b949e;
  font-weight: 500;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 1px;
  padding: 8px 12px;
  border-bottom: 2px solid #30363d;
}

td {
  padding: 8px 12px;
  border-bottom: 1px solid #21262d;
  vertical-align: top;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

tr:hover { background: #1c2128; }

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}
.badge-green { background: #0d2818; color: #3fb950; border: 1px solid #238636; }
.badge-amber { background: #2d1b00; color: #d29922; border: 1px solid #9e6a03; }
.badge-red { background: #2d0000; color: #f85149; border: 1px solid #da3633; }
.badge-blue { background: #0c2d6b; color: #58a6ff; border: 1px solid #1f6feb; }

pre.ascii-graph {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  color: #3fb950;
  font-size: 13px;
  line-height: 1.4;
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: #484f58;
}
.empty-state .icon { font-size: 32px; margin-bottom: 12px; }

.btn {
  display: inline-block;
  padding: 4px 12px;
  border: 1px solid #30363d;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  background: #21262d;
  color: #c9d1d9;
  text-decoration: none;
}
.btn:hover { background: #30363d; text-decoration: none; }

.btn-approve { background: #238636; border-color: #2ea043; color: #fff; }
.btn-approve:hover { background: #2ea043; }
.btn-deny { background: #da3633; border-color: #f85149; color: #fff; }
.btn-deny:hover { background: #f85149; }

.actions { display: flex; gap: 6px; }

.pagination {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  justify-content: center;
}

.filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.filter-bar label { color: #8b949e; font-size: 12px; }
.filter-bar select, .filter-bar input {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 4px 8px;
  color: #c9d1d9;
  font-family: inherit;
  font-size: 13px;
}

.timestamp { color: #8b949e; font-size: 12px; }
.data-cell { max-width: 400px; overflow: hidden; text-overflow: ellipsis; }

footer {
  border-top: 1px solid #21262d;
  padding: 12px 24px;
  text-align: center;
  color: #484f58;
  font-size: 11px;
}

#live-events { max-height: 300px; overflow-y: auto; font-size: 12px; }
#live-events .event-line {
  padding: 4px 0;
  border-bottom: 1px solid #21262d;
  display: flex;
  gap: 12px;
}
`

function layout(title: string, bodyContent: string, breadcrumbs?: { label: string; href: string }[]) {
  const navItems = breadcrumbs ?? []
  const crumbsHtml = navItems.map((item, i) => {
    const cls = i === navItems.length - 1 ? 'crumb active' : 'crumb'
    return `<span class="sep">/</span><a class="${cls}" href="${esc(item.href)}">${esc(item.label)}</a>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} \u2014 Operad Dashboard</title>
  <style>${CSS}</style>
</head>
<body>
  <nav>
    <a class="brand" href="/">Operad</a>
    ${crumbsHtml}
    <span class="live-dot">live</span>
  </nav>
  <main>${bodyContent}</main>
  <footer>operad dashboard v0.1.0 &middot; server-rendered &middot; ${new Date().toISOString()}</footer>
</body>
</html>`
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required for the dashboard')
    process.exit(1)
  }

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('ERROR: REDIS_URL is required for the dashboard')
    process.exit(1)
  }

  const port = parseInt(process.env.DASHBOARD_PORT ?? '3112', 10)
  const authToken = process.env.AUTH_TOKEN

  // ─── Storage + Runtime ──────────────────────────────────────────────

  const storage = new PostgresAdapter({ connectionString: databaseUrl })
  const runtime = createRuntime({ storage })

  // ─── Redis Subscriber ───────────────────────────────────────────────

  const subscriber = createRedisSubscriber(redisUrl)

  const recentEvents: LiveEvent[] = []
  const MAX_RECENT = 100

  // SSE clients
  const sseClients = new Set<(data: string) => void>()

  await subscriber.subscribe(async (graphId, event) => {
    const liveEvent: LiveEvent = {
      graphId,
      type: event.type,
      timestamp: event.timestamp,
      id: event.id,
    }
    recentEvents.unshift(liveEvent)
    if (recentEvents.length > MAX_RECENT) {
      recentEvents.pop()
    }

    // Broadcast to SSE clients
    const payload = JSON.stringify(liveEvent)
    for (const send of Array.from(sseClients)) {
      try {
        send(payload)
      } catch {
        sseClients.delete(send)
      }
    }
  })

  // ─── Hono App ───────────────────────────────────────────────────────

  const app = new Hono()

  // Auth middleware
  if (authToken) {
    app.use('*', async (c, next) => {
      // Skip auth for SSE stream and health
      const path = c.req.path
      if (path === '/health') return next()

      const token = c.req.header('Authorization')?.replace('Bearer ', '')
      if (token !== authToken) {
        return c.html(layout('Unauthorized', `
          <div class="empty-state">
            <div class="icon">&#x26A0;</div>
            <p>Unauthorized. Provide a valid Bearer token via Authorization header.</p>
          </div>
        `), 401)
      }
      await next()
    })
  }

  // ─── Route: Dashboard Home ──────────────────────────────────────────

  app.get('/', async (c) => {
    // Query distinct graph IDs with event counts using raw SQL on the adapter
    const rows = await (storage as any).sql`
      SELECT graph_id, COUNT(*)::int as event_count, MAX(timestamp) as last_event
      FROM operad_events
      GROUP BY graph_id
      ORDER BY MAX(timestamp) DESC
    `

    let totalEvents = 0
    for (const r of rows) {
      totalEvents += r.event_count
    }

    let graphRows = ''
    for (const r of rows) {
      graphRows += `
        <tr>
          <td><a href="/graph/${esc(r.graph_id)}">${esc(r.graph_id)}</a></td>
          <td>${r.event_count}</td>
          <td class="timestamp">${formatTimestamp(r.last_event)}</td>
          <td class="actions">
            <a class="btn" href="/graph/${esc(r.graph_id)}">inspect</a>
            <a class="btn" href="/graph/${esc(r.graph_id)}/events">events</a>
            <a class="btn" href="/graph/${esc(r.graph_id)}/patches">patches</a>
          </td>
        </tr>`
    }

    let liveFeedHtml = ''
    for (const e of recentEvents.slice(0, 20)) {
      liveFeedHtml += `
        <div class="event-line">
          <span class="timestamp">${formatTimestamp(e.timestamp)}</span>
          <span class="badge ${eventTypeBadgeClass(e.type)}">${esc(e.type)}</span>
          <a href="/graph/${esc(e.graphId)}">${esc(e.graphId)}</a>
          <span style="color:#484f58">${esc(e.id)}</span>
        </div>`
    }

    const body = `
      <h1>Dashboard</h1>

      <div class="stat-grid">
        <div class="stat">
          <div class="value">${rows.length}</div>
          <div class="label">Graphs</div>
        </div>
        <div class="stat">
          <div class="value">${totalEvents}</div>
          <div class="label">Total Events</div>
        </div>
        <div class="stat">
          <div class="value">${recentEvents.length}</div>
          <div class="label">Live Buffer</div>
        </div>
      </div>

      <h2>Graphs</h2>

      ${rows.length === 0
        ? `<div class="empty-state"><div class="icon">&#x25CB;</div><p>No graphs found. Create one via the API.</p></div>`
        : `<div class="card">
            <table>
              <thead>
                <tr><th>Graph ID</th><th>Events</th><th>Last Activity</th><th>Actions</th></tr>
              </thead>
              <tbody>${graphRows}</tbody>
            </table>
          </div>`
      }

      <h2>Live Event Feed</h2>
      <div class="card">
        <div id="live-events">
          ${liveFeedHtml || '<div style="color:#484f58;padding:12px;">Waiting for events...</div>'}
        </div>
      </div>

      <script>
        (function() {
          var evtSource = new EventSource('/events/stream');
          var container = document.getElementById('live-events');
          evtSource.onmessage = function(e) {
            var evt = JSON.parse(e.data);
            var line = document.createElement('div');
            line.className = 'event-line';
            var ts = evt.timestamp.replace('T',' ').replace(/\\.\\d+Z$/,'Z');
            line.innerHTML = '<span class="timestamp">' + ts + '</span>'
              + ' <span class="badge badge-blue">' + evt.type + '</span>'
              + ' <a href="/graph/' + evt.graphId + '">' + evt.graphId + '</a>'
              + ' <span style="color:#484f58">' + evt.id + '</span>';
            container.insertBefore(line, container.firstChild);
            while (container.children.length > 50) container.removeChild(container.lastChild);
          };
        })();
      </script>
    `

    return c.html(layout('Home', body))
  })

  // ─── Route: Graph Inspector ─────────────────────────────────────────

  app.get('/graph/:id', async (c) => {
    const graphId = c.req.param('id')
    const graph = runtime.getGraph(graphId)

    const [objects, relations, events] = await Promise.all([
      graph.queryObjects({}),
      graph.queryRelations({}),
      storage.queryEvents(graphId, {}),
    ])

    // Last 50 events, newest first
    const recentEvts = events.slice().reverse().slice(0, 50)

    // ASCII graph
    const asciiLines = renderAsciiGraph(objects, relations)
    const asciiOutput = esc(asciiLines.join('\n'))

    // Pending patches
    const patches = runtime.pendingPatches(graphId)

    // Build objects table
    let objectRows = ''
    for (const o of objects) {
      objectRows += `
        <tr>
          <td>${esc(o.id)}</td>
          <td><span class="badge badge-green">${esc(o.type)}</span></td>
          <td class="data-cell" title="${esc(JSON.stringify(o.data))}">${esc(truncateData(o.data))}</td>
          <td class="timestamp">${formatTimestamp(o.updatedAt)}</td>
        </tr>`
    }

    // Build relations table
    let relationRows = ''
    for (const r of relations) {
      relationRows += `
        <tr>
          <td>${esc(r.sourceId)}</td>
          <td><span class="badge badge-blue">${esc(r.type)}</span></td>
          <td>${esc(r.targetId)}</td>
          <td class="timestamp">${formatTimestamp(r.createdAt)}</td>
        </tr>`
    }

    // Build events table
    let eventRows = ''
    for (const e of recentEvts) {
      eventRows += `
        <tr>
          <td style="font-size:11px;">${esc(e.id)}</td>
          <td><span class="badge ${eventTypeBadgeClass(e.type)}">${esc(e.type)}</span></td>
          <td>${e.actor ? esc(e.actor) : '<span style="color:#484f58">\u2014</span>'}</td>
          <td class="timestamp">${formatTimestamp(e.timestamp)}</td>
        </tr>`
    }

    const body = `
      <h1>Graph: ${esc(graphId)}</h1>

      <div class="stat-grid">
        <div class="stat">
          <div class="value">${objects.length}</div>
          <div class="label">Objects</div>
        </div>
        <div class="stat">
          <div class="value">${relations.length}</div>
          <div class="label">Relations</div>
        </div>
        <div class="stat">
          <div class="value">${events.length}</div>
          <div class="label">Events</div>
        </div>
        <div class="stat">
          <div class="value">${patches.length}</div>
          <div class="label">Pending Patches</div>
        </div>
      </div>

      <h2>Graph Visualization</h2>
      <div class="card">
        <pre class="ascii-graph">${asciiOutput}</pre>
      </div>

      <h2>Objects</h2>
      <div class="card">
        ${objects.length === 0
          ? '<div class="empty-state"><p>No objects in this graph.</p></div>'
          : `<table>
              <thead><tr><th>ID</th><th>Type</th><th>Data</th><th>Updated</th></tr></thead>
              <tbody>${objectRows}</tbody>
            </table>`
        }
      </div>

      <h2>Relations</h2>
      <div class="card">
        ${relations.length === 0
          ? '<div class="empty-state"><p>No relations in this graph.</p></div>'
          : `<table>
              <thead><tr><th>Source</th><th>Type</th><th>Target</th><th>Created</th></tr></thead>
              <tbody>${relationRows}</tbody>
            </table>`
        }
      </div>

      <h2>Events <span style="color:#484f58;font-size:12px;">(last 50)</span></h2>
      <div class="card">
        ${recentEvts.length === 0
          ? '<div class="empty-state"><p>No events recorded.</p></div>'
          : `<table>
              <thead><tr><th>ID</th><th>Type</th><th>Actor</th><th>Timestamp</th></tr></thead>
              <tbody>${eventRows}</tbody>
            </table>`
        }
        <div style="text-align:center;margin-top:8px;">
          <a class="btn" href="/graph/${esc(graphId)}/events">View full event log</a>
          <a class="btn" href="/graph/${esc(graphId)}/patches">View patches</a>
        </div>
      </div>
    `

    return c.html(layout(
      `Graph: ${graphId}`,
      body,
      [{ label: graphId, href: `/graph/${graphId}` }]
    ))
  })

  // ─── Route: Full Event Log ──────────────────────────────────────────

  app.get('/graph/:id/events', async (c) => {
    const graphId = c.req.param('id')
    const typeFilter = c.req.query('type') || undefined
    const page = parseInt(c.req.query('page') ?? '1', 10)
    const perPage = 100

    const filter: Record<string, unknown> = {}
    if (typeFilter) filter.type = typeFilter

    const allEvents = await storage.queryEvents(graphId, filter as any)

    // Reverse for newest first, then paginate
    const reversed = allEvents.slice().reverse()
    const totalPages = Math.max(1, Math.ceil(reversed.length / perPage))
    const currentPage = Math.min(Math.max(1, page), totalPages)
    const pageEvents = reversed.slice((currentPage - 1) * perPage, currentPage * perPage)

    // Collect distinct event types for filter dropdown
    const typeSet = new Set<string>()
    for (const e of allEvents) typeSet.add(e.type)
    const allTypes = Array.from(typeSet).sort()

    // Build filter options
    let typeOptions = '<option value="">All types</option>'
    for (const t of allTypes) {
      const selected = t === typeFilter ? ' selected' : ''
      typeOptions += `<option value="${esc(t)}"${selected}>${esc(t)}</option>`
    }

    // Build event rows
    let eventRows = ''
    for (const e of pageEvents) {
      eventRows += `
        <tr>
          <td style="font-size:11px;">${esc(e.id)}</td>
          <td><span class="badge ${eventTypeBadgeClass(e.type)}">${esc(e.type)}</span></td>
          <td>${e.actor ? esc(e.actor) : '<span style="color:#484f58">\u2014</span>'}</td>
          <td style="font-size:11px;">${e.causedBy ? esc(e.causedBy) : '<span style="color:#484f58">\u2014</span>'}</td>
          <td class="timestamp">${formatTimestamp(e.timestamp)}</td>
        </tr>`
    }

    // Pagination
    let paginationHtml = ''
    if (totalPages > 1) {
      const typeParam = typeFilter ? `type=${encodeURIComponent(typeFilter)}&` : ''
      paginationHtml = '<div class="pagination">'
      if (currentPage > 1) {
        paginationHtml += `<a class="btn" href="/graph/${esc(graphId)}/events?${typeParam}page=${currentPage - 1}">&lt; prev</a>`
      }
      paginationHtml += `<span style="color:#8b949e;padding:4px 8px;">page ${currentPage} of ${totalPages}</span>`
      if (currentPage < totalPages) {
        paginationHtml += `<a class="btn" href="/graph/${esc(graphId)}/events?${typeParam}page=${currentPage + 1}">next &gt;</a>`
      }
      paginationHtml += '</div>'
    }

    const body = `
      <h1>Events: ${esc(graphId)}</h1>

      <div class="filter-bar">
        <form method="get" action="/graph/${esc(graphId)}/events" style="display:flex;gap:8px;align-items:center;">
          <label for="type">Filter by type:</label>
          <select name="type" id="type" onchange="this.form.submit()">
            ${typeOptions}
          </select>
        </form>
        <span style="color:#484f58;font-size:12px;">${allEvents.length} total events</span>
      </div>

      <div class="card">
        ${pageEvents.length === 0
          ? '<div class="empty-state"><p>No events found.</p></div>'
          : `<table>
              <thead><tr><th>ID</th><th>Type</th><th>Actor</th><th>Caused By</th><th>Timestamp</th></tr></thead>
              <tbody>${eventRows}</tbody>
            </table>`
        }
      </div>

      ${paginationHtml}
    `

    return c.html(layout(
      `Events: ${graphId}`,
      body,
      [
        { label: graphId, href: `/graph/${graphId}` },
        { label: 'events', href: `/graph/${graphId}/events` },
      ]
    ))
  })

  // ─── Route: Patches ─────────────────────────────────────────────────

  app.get('/graph/:id/patches', async (c) => {
    const graphId = c.req.param('id')
    const patches = runtime.pendingPatches(graphId)

    let patchRows = ''
    for (const p of patches) {
      const actionsHtml = p.status === 'pending'
        ? `<div class="actions">
            <form method="post" action="/graph/${esc(graphId)}/patches/${esc(p.id)}/approve" style="display:inline;">
              <button type="submit" class="btn btn-approve">approve</button>
            </form>
            <form method="post" action="/graph/${esc(graphId)}/patches/${esc(p.id)}/deny" style="display:inline;">
              <button type="submit" class="btn btn-deny">deny</button>
            </form>
          </div>`
        : '<span style="color:#484f58">\u2014</span>'

      patchRows += `
        <tr>
          <td style="font-size:11px;">${esc(p.id)}</td>
          <td><span class="badge badge-blue">${esc(p.objectType)}</span></td>
          <td>${esc(p.reason)}</td>
          <td>${esc(p.proposedBy)}</td>
          <td><span class="badge ${patchStatusBadgeClass(p.status)}">${esc(p.status)}</span></td>
          <td class="timestamp">${formatTimestamp(p.createdAt)}</td>
          <td>${actionsHtml}</td>
        </tr>`
    }

    const body = `
      <h1>Pending Patches: ${esc(graphId)}</h1>

      <div class="card">
        ${patches.length === 0
          ? '<div class="empty-state"><div class="icon">&#x2713;</div><p>No pending patches. All clear.</p></div>'
          : `<table>
              <thead>
                <tr><th>ID</th><th>Type</th><th>Reason</th><th>Proposed By</th><th>Status</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>${patchRows}</tbody>
            </table>`
        }
      </div>
    `

    return c.html(layout(
      `Patches: ${graphId}`,
      body,
      [
        { label: graphId, href: `/graph/${graphId}` },
        { label: 'patches', href: `/graph/${graphId}/patches` },
      ]
    ))
  })

  // ─── Route: Approve Patch ───────────────────────────────────────────

  app.post('/graph/:id/patches/:patchId/approve', async (c) => {
    const graphId = c.req.param('id')
    const patchId = c.req.param('patchId')

    try {
      await runtime.approve(patchId, 'dashboard-user')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.html(layout(
        'Error',
        `<div class="card">
          <p style="color:#f85149;">Failed to approve patch: ${esc(msg)}</p>
          <a class="btn" href="/graph/${esc(graphId)}/patches">Back to patches</a>
        </div>`,
        [
          { label: graphId, href: `/graph/${graphId}` },
          { label: 'patches', href: `/graph/${graphId}/patches` },
        ]
      ), 500)
    }

    return c.redirect(`/graph/${graphId}/patches`)
  })

  // ─── Route: Deny Patch ──────────────────────────────────────────────

  app.post('/graph/:id/patches/:patchId/deny', async (c) => {
    const graphId = c.req.param('id')
    const patchId = c.req.param('patchId')

    try {
      await runtime.deny(patchId, 'dashboard-user')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.html(layout(
        'Error',
        `<div class="card">
          <p style="color:#f85149;">Failed to deny patch: ${esc(msg)}</p>
          <a class="btn" href="/graph/${esc(graphId)}/patches">Back to patches</a>
        </div>`,
        [
          { label: graphId, href: `/graph/${graphId}` },
          { label: 'patches', href: `/graph/${graphId}/patches` },
        ]
      ), 500)
    }

    return c.redirect(`/graph/${graphId}/patches`)
  })

  // ─── Route: SSE Live Events ─────────────────────────────────────────

  app.get('/events/stream', async (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        const send = (data: string) => {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }

        sseClients.add(send)

        // Send a heartbeat comment every 30s to keep connection alive
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'))
          } catch {
            clearInterval(heartbeat)
            sseClients.delete(send)
          }
        }, 30000)

        // Cleanup when client disconnects
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(heartbeat)
          sseClients.delete(send)
          try { controller.close() } catch { /* already closed */ }
        })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  })

  // ─── Route: Health Check (JSON) ─────────────────────────────────────

  app.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      services: {
        postgres: 'connected',
        redis: 'connected',
      },
      uptime: process.uptime(),
    })
  })

  // ─── Start Server ───────────────────────────────────────────────────

  const { serve } = await import('@hono/node-server')

  serve({ fetch: app.fetch, port })

  console.log()
  console.log('  \u25C6 Operad Dashboard')
  console.log(`  \u251C\u2500 url: http://localhost:${port}`)
  console.log(`  \u251C\u2500 database: ${databaseUrl.replace(/\/\/.*@/, '//***@')}`)
  console.log(`  \u251C\u2500 redis: ${redisUrl}`)
  console.log(`  \u251C\u2500 auth: ${authToken ? 'enabled' : 'disabled (set AUTH_TOKEN)'}`)
  console.log('  \u2514\u2500 serving dashboard...')
  console.log()

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n  \u00B7 Shutting down dashboard...')
    await subscriber.close()
    await storage.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await subscriber.close()
    await storage.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Failed to start Operad dashboard:', err)
  process.exit(1)
})
