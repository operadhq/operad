#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Use Case: Understand Where Your AI Spend Goes
#
# You've been running Claude Code sessions and want to know:
# - Which goals cost the most?
# - What work was wasted (redundant reads, dead-end exploration)?
# - How much did caching save you?
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "=== Step 1: Import a session ==="

operad-session commit ~/.claude/projects/myapp/session.jsonl
GRAPH_ID="session_1716000000000"

echo ""
echo "=== Step 2: Blame — cost per goal ==="
# Like git blame, but for money. Which goal burned the most tokens?

operad-session blame --graph "$GRAPH_ID"
# Output:
#   Goal                              Input    Output   Cache     Total
#   ─────────────────────────────────────────────────────────────────────
#   "Add user authentication"         1.2M     340K    $18.20    $42.10
#   "Fix failing tests"               890K     210K    $12.50    $28.40
#   "Refactor middleware"             450K     120K    $8.30     $15.20
#   ─────────────────────────────────────────────────────────────────────
#   Total                             2.5M     670K    $39.00    $85.70

echo ""
echo "=== Step 3: Stash — wasted work ==="
# Files read multiple times, exploration that went nowhere

operad-session stash --graph "$GRAPH_ID"
# Output:
#   Redundant Reads: 12
#   Tokens Wasted:   45K
#   Potential Savings: $3.20
#
#   Top offenders:
#     src/middleware/auth.ts  — read 4 times (3 redundant)
#     src/types/user.ts      — read 3 times (2 redundant)

echo ""
echo "=== Step 4: Inspect tail events ==="
# What happened at the end? Did Claude get stuck?

operad-session inspect --graph "$GRAPH_ID"
# Shows summary: events, goals, cost, and the last few events

echo ""
echo "=== Step 5: Time-travel to expensive point ==="
# Replay to the point where cost spiked

operad-session replay --graph "$GRAPH_ID" --to-event evt_expensive_point
# Rebuilds graph state at that moment — see what Claude was working with
