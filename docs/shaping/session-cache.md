---
shaping: true
---

# Operad Session Graph — Shaping

## Source

> the goal is to have an editable and replayable log right?

> yes and would love to have cost savings there

> can we not just graphify the jsonl?

> people will use claude code, codex and opencode in sandbox which contributes
> to autonomous agents in prod for end users

---

## Problem

Coding agents produce rich session logs (JSONL) containing everything: goals,
files read, edits made, commands run, test results, token usage. But these logs
are flat, unstructured, and write-only. You can't query them, branch them, replay
them, or see what they cost.

---

## Outcome

Import existing JSONL into Operad's event log. The session becomes an editable,
replayable graph with goals, cost tracking, branch/diff/checkout — the same
primitives developers need for building production autonomous agents.

---

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | Parse Claude Code JSONL into Operad events with zero agent code changes | Core goal |
| R1 | Extract goals from user messages as first-class graph objects with goal→action→outcome chains | Must-have |
| R2 | Track cost per goal and per session: input tokens, output tokens, cache hits, dollars spent | Must-have |
| R3 | Show waste: redundant file reads, tokens re-spent, cost that could have been avoided | Must-have |
| R4 | Editable — append new events, push goals, patch objects after import | Must-have |
| R5 | Replayable — checkout to any point, branch from any point, diff branches | Must-have |
| R6 | Same library usable for production autonomous agents (behaviors, reactive graph) | Must-have |
| R7 | 🟡 Live graph during session — survives context compaction, acts as persistent memory outside the context window | Must-have |
| R8 | 🟡 Shared graph across subagents — parent's reads available to children without re-reading | Must-have |

---

## D: JSONL Importer + Cost Tracker

Parse existing JSONL into Operad's event log. Everything else (graph, branch, diff,
checkout, behaviors) already exists in @operad/core.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **D1** | **JSONL parser** — reads Claude Code JSONL line by line. Maps `type:"user"` → `goal.set` event. Maps `tool_use` (Read, Edit, Bash, Write, Grep) → `tool.called` events. Maps `tool_result` → `tool.completed` events. Maps assistant text → `assistant.responded` events. Preserves uuid/parentUuid as causedBy chain. | |
| **D2** | **Cost extractor** — reads `message.usage` from assistant entries (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens). Computes cost per message using model pricing table. Aggregates per goal (sum between user messages). Tracks cache savings (cache_read tokens × discount rate). | |
| **D3** | **Graph projector** — from emitted events, creates typed objects: `goal` (text, cost, status), `file` (path, read_count, edit_count, tokens_spent), `patch` (file, old_string, new_string), `test_run` (command, exit_code). Adds relations: `goal→triggered→file`, `goal→produced→patch`, `patch→verified_by→test_run`. | |
| **D4** | **Waste detector** — walks tool.called events, flags redundant reads (same file path, content unchanged). Computes: tokens_wasted, redundant_reads, potential_savings. Attaches waste data to file objects. | |
| **D5** | 🟡 **Live session graph** — SQLite-backed graph that persists outside the context window. Updated in real-time as tool calls happen. Survives compaction. Agent can query "have I read this file? has it changed?" before issuing a Read. | |
| **D6** | 🟡 **Subagent graph sharing** — parent and child agents share the same SQLite graph. When subagent spawns, it inherits all file objects, patches, and goals from parent. Reads cached by parent are available to children without re-reading. | |

---

## Fit Check

| Req | Requirement | Status | D |
|-----|-------------|--------|---|
| R0 | Parse Claude Code JSONL into Operad events with zero agent code changes | Core goal | ✅ |
| R1 | Extract goals from user messages as first-class graph objects with goal→action→outcome chains | Must-have | ✅ |
| R2 | Track cost per goal and per session: input tokens, output tokens, cache hits, dollars spent | Must-have | ✅ |
| R3 | Show waste: redundant file reads, tokens re-spent, cost that could have been avoided | Must-have | ✅ |
| R4 | Editable — append new events, push goals, patch objects after import | Must-have | ✅ |
| R5 | Replayable — checkout to any point, branch from any point, diff branches | Must-have | ✅ |
| R6 | Same library usable for production autonomous agents (behaviors, reactive graph) | Must-have | ✅ |
| R7 | Live graph during session — survives context compaction, acts as persistent memory outside the context window | Must-have | ✅ |
| R8 | Shared graph across subagents — parent's reads available to children without re-reading | Must-have | ✅ |

**Notes:**
- R4 satisfied by Operad core (appendEvent, patchObject — already built)
- R5 satisfied by Operad core (checkout in replay.ts, branch in runtime.ts, diff in diff.ts — already built)
- R6 satisfied by Operad core (BehaviorRegistry — already built)
- R7 satisfied by D5 — SQLite graph persists outside context window, survives compaction
- R8 satisfied by D6 — shared SQLite file readable by parent + child agents
- D1-D4 are retroactive analysis. D5-D6 are live session integration.

---

## Decision

**Build D (JSONL Importer + Cost Tracker).** ~200-300 lines of new code. The parser
feeds into Operad's existing event log, which already supports graph projection,
branch, diff, checkout, and behaviors.

**Selected: D**

Next step: Build it. Test on real Claude Code session files in ~/.claude/projects/.
