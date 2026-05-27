# Operad API — Getting Started

Try the live API in 2 minutes. Copy-paste each curl command.

## Setup

```bash
# Set your API URL and key (get these from the team)
export OPERAD_URL="https://api.useoperad.sh"
export OPERAD_KEY="your-api-key-here"
```

## 1. Health check

```bash
curl $OPERAD_URL/
```

## 2. Create a graph

```bash
curl -X POST $OPERAD_URL/graphs \
  -H "Authorization: Bearer $OPERAD_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": "claim-9281"}'
```

## 3. Add objects (nodes)

```bash
# Add a claim
curl -X POST $OPERAD_URL/graphs/claim-9281/objects \
  -H "Authorization: Bearer $OPERAD_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "claim", "data": {"amount": 47200, "type": "auto-collision"}}'

# Add a claimant
curl -X POST $OPERAD_URL/graphs/claim-9281/objects \
  -H "Authorization: Bearer $OPERAD_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "claimant", "data": {"name": "M. Torres", "priorClaims": 2}}'
```

## 4. Add a relation (edge)

Use the object IDs from the responses above:

```bash
curl -X POST $OPERAD_URL/graphs/claim-9281/relations \
  -H "Authorization: Bearer $OPERAD_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sourceId": "CLAIMANT_ID", "targetId": "CLAIM_ID", "type": "filed"}'
```

## 5. Record a decision

```bash
curl -X POST $OPERAD_URL/graphs/claim-9281/decisions \
  -H "Authorization: Bearer $OPERAD_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "selectedAction": "escalate-to-human",
    "alternatives": ["auto-approve", "auto-deny"],
    "confidence": 0.34,
    "reasoning": "Risk score 0.34 exceeds auto-approve threshold of 0.30"
  }'
```

## 6. View the event log

Every action above generated events. View the full causal chain:

```bash
curl $OPERAD_URL/graphs/claim-9281/events \
  -H "Authorization: Bearer $OPERAD_KEY"
```

## 7. Trace a causal chain

Pick any event ID from the log and trace what caused it:

```bash
curl $OPERAD_URL/events/EVENT_ID/chain \
  -H "Authorization: Bearer $OPERAD_KEY"
```

## 8. Query objects

```bash
# All objects in the graph
curl "$OPERAD_URL/graphs/claim-9281/objects" \
  -H "Authorization: Bearer $OPERAD_KEY"

# Filter by type
curl "$OPERAD_URL/graphs/claim-9281/objects?type=claim" \
  -H "Authorization: Bearer $OPERAD_KEY"
```

---

## What just happened?

You created an **event-sourced knowledge graph** with full provenance:

- Every mutation (add object, add relation, record decision) → immutable event
- Every event has a `causedBy` link → causal chain
- Every decision records alternatives + confidence + reasoning → audit trail
- You can trace backward from any event to understand *why* it happened

This is what makes Operad different from a regular database. The event log IS the system of record.
