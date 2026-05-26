#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Use Case: Explore Multiple Alternatives from One Decision Point
#
# You hit a key architectural decision and want to see how 3 different
# approaches play out — all branching from the same point.
# ─────────────────────────────────────────────────────────────────────────────

set -e

GRAPH_ID="session_1716000000000"
FORK_POINT="evt_17160000"

echo "=== Step 1: See the decision point in context ==="

operad-session inspect --graph "$GRAPH_ID" --event "$FORK_POINT"
# Shows the full event payload — what Claude decided and why

echo ""
echo "=== Step 2: Fork 3 alternatives ==="

# Approach A: Redis caching
operad-session fork --graph "$GRAPH_ID" \
  --at-event "$FORK_POINT" \
  --run "Implement caching with Redis. Use ioredis client with connection pooling." \
  --model claude-sonnet-4 \
  --max-budget 3.00 \
  --label "redis" \
  --no-diff

# Approach B: In-memory LRU
operad-session fork --graph "$GRAPH_ID" \
  --at-event "$FORK_POINT" \
  --run "Implement caching with an in-memory LRU cache. Use lru-cache package." \
  --model claude-sonnet-4 \
  --max-budget 3.00 \
  --label "lru" \
  --no-diff

# Approach C: SQLite as cache
operad-session fork --graph "$GRAPH_ID" \
  --at-event "$FORK_POINT" \
  --run "Implement caching with SQLite using better-sqlite3. Store cached values with TTL." \
  --model claude-sonnet-4 \
  --max-budget 3.00 \
  --label "sqlite" \
  --no-diff

echo ""
echo "=== Step 3: Compare all three ==="

echo "--- Redis vs Original ---"
operad-session diff "$GRAPH_ID" "${GRAPH_ID}_redis"

echo ""
echo "--- LRU vs Original ---"
operad-session diff "$GRAPH_ID" "${GRAPH_ID}_lru"

echo ""
echo "--- SQLite vs Original ---"
operad-session diff "$GRAPH_ID" "${GRAPH_ID}_sqlite"

echo ""
echo "=== Step 4: Cost comparison ==="

echo "Redis:"
operad-session blame --graph "${GRAPH_ID}_redis" --json | jq '.totalCost'

echo "LRU:"
operad-session blame --graph "${GRAPH_ID}_lru" --json | jq '.totalCost'

echo "SQLite:"
operad-session blame --graph "${GRAPH_ID}_sqlite" --json | jq '.totalCost'

echo ""
echo "=== Step 5: Visual comparison ==="
# Open the interactive timeline to see all branches

operad-session view --graph "$GRAPH_ID"
# Opens browser with timeline showing parent + all forks
