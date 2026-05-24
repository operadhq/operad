# Operad Platform Strategy

## Vision

**Give AI agents memory they can prove.**

Every agent framework gives agents skills — tool calling, streaming, prompt chaining. None of them give agents *provenance*: the ability to remember, explain, and self-correct.

Operad is the provenance layer for AI agents. Three products, one foundation.

---

## The Three Products

### 1. Operad Core (open source, MIT)
**What:** Event-sourced graph runtime with causal chains, decision records, and staleness tracking.

**For:** Developers building agents in regulated industries (insurance, finance, healthcare, legal) who need audit trails and explainability.

**Differentiator:** No one else has causal chains + decision records + staleness detection in a single TypeScript library. This is the foundation everything else builds on.

**Status:** Built. Ships first.

### 2. Operad Memory (open source core, managed service)
**What:** Persistent agent memory across sessions — like Mem0, but built on Operad Core.

**For:** Any AI agent that needs to remember users, preferences, and context across conversations.

**Differentiator:** Every memory has provenance. You can trace when it was learned, what caused it, and whether it's still fresh. Mem0 stores memories. Operad Memory stores memories *with audit trails*.

**Revenue:** Managed service (hosted memory with guaranteed uptime, analytics dashboard, team features). Open source self-host option always available.

### 3. Operad Know (open source core, managed service)
**What:** Knowledge extraction + SOPs + procedural memory. Like Cognee, but with video/SOP support and full provenance.

**For:** Organizations that need agents to learn from documents, SOPs, training videos, and institutional knowledge — then explain where any piece of knowledge came from.

**Key capability:** Video/SOP ingestion. Insurance agencies, banks, and enterprises run on SOPs — step-by-step procedures documented in videos and PDFs. Operad Know turns these into structured, queryable, traceable knowledge that agents can follow and audit.

**Differentiator:** Cognee extracts knowledge from text. Operad Know extracts knowledge from text *and video SOPs*, stores it with full provenance (which SOP? which section? when was it last verified?), and flags when procedures are outdated.

**Revenue:** Same model — managed service + open source self-host.

---

## Why This Order

```
Phase 1: Core          → Establish credibility. Open source. Community.
Phase 2: Memory        → Monetize. Managed service. First revenue.
Phase 3: Know          → Enterprise. SOPs + video. Bigger contracts.
```

**Core first** because:
- It's the hardest thing to replicate (event sourcing + causal chains is non-trivial)
- It builds community trust (MIT, no vendor lock-in)
- It's the foundation Memory and Know build on
- EU AI Act (August 2026) mandates immutable audit logs — Core is exactly this

**Memory second** because:
- Mem0 proved the market ($24M raise)
- Easiest path to revenue (managed service, usage-based pricing)
- Developers already understand "agent memory" as a concept

**Know third** because:
- Requires more infrastructure (video processing, SOP parsing)
- Enterprise sales cycle is longer
- But contracts are bigger and stickier

---

## Competitive Landscape

| Product | Layer | What they have | What they lack |
|---------|-------|---------------|----------------|
| **Mem0** | Memory | User memory across sessions | Causal chains, decision records, staleness detection, TypeScript-native |
| **Cognee** | Knowledge | Knowledge extraction from docs | Video/SOP support, provenance, audit trails |
| **Nia** | Retrieval | Codebase indexing for coding agents | General agent memory, provenance, not just for code |
| **Hyperspell** | Orchestration | AI workflows with context | Not a memory system, no event sourcing |
| **Nozomi** | Observability | Agent execution tracing | Observes agents, doesn't give them memory |
| **LangChain Memory** | Memory | Conversation buffers | No structure, no persistence, no provenance |
| **Vector DBs** | Retrieval | Semantic search | No relations, no causal chains, no staleness |

**Operad's moat:** Provenance is the foundation. Memory without provenance is a database. Knowledge without provenance is a guess. By building provenance first, every product we ship has audit trails, causal chains, and freshness tracking *by default*.

---

## Market Signals

- **$6.27B** projected AI agent memory market by 2030
- **EU AI Act** (August 2026): mandates immutable audit logs for high-risk AI systems
- **Mem0** raised $24M validating agent memory as a category
- **87%** of enterprise agents fail at multi-turn memory tasks (Gartner 2025)
- Bank fraud detection teams can't explain AI decisions to regulators
- Insurance agencies need audit trails for every AI-processed claim

---

## Revenue Model

### Open Source (Core)
- MIT license, always free
- Community contributions, ecosystem growth
- Establishes trust and adoption

### Managed Service (Memory + Know)
- **Usage-based:** per-event or per-object pricing
- **Team features:** collaboration, role-based access, shared graphs
- **Analytics:** decision dashboards, compliance reports, staleness alerts
- **SLA:** guaranteed uptime, support, data residency options

### Enterprise (Know + SOPs)
- **Video/SOP ingestion:** custom pipeline for institutional knowledge
- **Compliance packages:** pre-built behaviors for HIPAA, SOX, state insurance regulations
- **On-premise deployment:** for organizations that can't use cloud
- **Professional services:** custom behavior development, integration support

---

## Key Bets

1. **Provenance is table stakes for enterprise AI.** The EU AI Act makes this law. US regulation will follow. Building provenance-first means we're ready.

2. **TypeScript wins for AI agents.** Most production agents run on Node.js (Vercel AI SDK, LangChain.js, serverless). Being TypeScript-native is a real advantage over Python-first competitors.

3. **SOPs are the unlock for enterprise.** Every large organization runs on procedures. The company that can turn SOPs (including videos) into agent-executable, auditable knowledge wins enterprise AI.

4. **Open source builds trust in regulated industries.** Insurance companies and banks won't send agent memory to a third-party cloud they can't inspect. Open source + self-host is the right model.

---

## GitHub

Organization: [github.com/operadhq](https://github.com/operadhq)
