#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Use Case: Debug Why a Claude Session Went Wrong
#
# Your Claude session burned $50 and produced broken code. What happened?
# Use operad-session like a flight recorder black box.
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "=== Step 1: Import the problematic session ==="

operad-session commit ~/.claude/projects/myapp/expensive-session.jsonl
GRAPH_ID="session_1716000000000"

echo ""
echo "=== Step 2: Get the overview ==="

operad-session inspect --graph "$GRAPH_ID"
# Quick summary: how many events, goals, total cost, last events

echo ""
echo "=== Step 3: Find the expensive stretch ==="

operad-session log --graph "$GRAPH_ID"
# Scroll through events — look for repeated patterns or long stretches
# of tool calls without goal progress

echo ""
echo "=== Step 4: Check for wasted work ==="

operad-session stash --graph "$GRAPH_ID"
# Shows redundant reads — Claude re-reading files it already read
# This is often a sign of lost context or circular exploration

echo ""
echo "=== Step 5: Visualize the event graph ==="

operad-session graph --graph "$GRAPH_ID"
# ASCII turn-based view — see the structure of the conversation
# Look for: long tool-call chains, repeated patterns, dead ends

echo ""
echo "=== Step 6: Inspect a suspicious event ==="

operad-session inspect --graph "$GRAPH_ID" --event evt_suspicious
# Full payload — see exactly what Claude was thinking/doing

echo ""
echo "=== Step 7: Revert to before things went wrong ==="

operad-session revert evt_last_good_point --graph "$GRAPH_ID"
# Creates compensating events that undo everything after that point
# The graph now reflects the state before the expensive mistake

echo ""
echo "=== Step 8: Re-run from the good point ==="

operad-session fork --graph "$GRAPH_ID" \
  --at-event evt_last_good_point \
  --run "Continue from here but DO NOT modify the database schema. Only change the API layer." \
  --model claude-sonnet-4 \
  --max-budget 5.00 \
  --label "take-2"

# Compare the two attempts
operad-session diff "$GRAPH_ID" "${GRAPH_ID}_take-2"
