#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Use Case: Compare Two Approaches to the Same Problem
#
# You started implementing auth with JWT tokens. Now you want to see what
# session cookies would look like instead — without losing the JWT work.
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "=== Step 1: Import your Claude Code session ==="
# After a Claude Code session, your JSONL is at:
#   ~/.claude/projects/<project-hash>/<session-id>.jsonl

operad-session commit ~/.claude/projects/myapp/abc123.jsonl
# Output:
#   Committed session abc123 → graph session_1716000000000
#   Goals: 3 | Tools: 47 | Cost: $4.20 | Cache saved: $12.50

GRAPH_ID="session_1716000000000"

echo ""
echo "=== Step 2: Find the decision point ==="
# Use log to find where the auth approach was decided

operad-session log --graph "$GRAPH_ID"
# Output shows events chronologically — find the decision event ID

echo ""
echo "=== Step 3: Fork and run alternative ==="
# Fork at the decision point, run Claude with different instructions

operad-session fork --graph "$GRAPH_ID" \
  --at-event evt_17160000 \
  --run "Use session cookies with httpOnly flag instead of JWT tokens" \
  --model claude-sonnet-4 \
  --max-budget 3.00 \
  --label "session-cookies"

# Output:
#   Forked session_1716000000000 at event evt_17160000
#     Branch: session_1716000000000_session-cookies
#
#   Running Claude (claude-sonnet-4, budget: $3.00)...
#     Prompt: "Use session cookies with httpOnly flag instead of JWT tokens"
#     ⏳ Executing...
#     [Claude's output streams here...]
#     ✅ Done — 31 tool calls, $2.10
#
#   Diff: session_1716000000000 ↔ session_1716000000000_session-cookies
#     +8 added, -12 removed
#     Original: 47 events | Fork: 31 events

echo ""
echo "=== Step 4: Deep comparison ==="
# See exactly what differs between the two approaches

operad-session diff "$GRAPH_ID" "${GRAPH_ID}_session-cookies"

echo ""
echo "=== Step 5: Cost analysis ==="
# Which approach was cheaper?

operad-session blame --graph "$GRAPH_ID"
operad-session blame --graph "${GRAPH_ID}_session-cookies"
