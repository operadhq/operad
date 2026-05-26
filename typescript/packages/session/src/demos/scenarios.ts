/**
 * Agent demo scenarios — domain-specific synthetic sessions.
 *
 * Each scenario generates JSONL that goes through the full commit pipeline,
 * producing goals, tool calls, thinking traces, and causal chains
 * to exercise the Timeline tab (swim lanes, causal chain, waterfall).
 */

import type { ScenarioConfig } from './session-builder.js'

// ─── Coding Agent ──────────────────────────────────────────────────────────

export const coding: ScenarioConfig = {
  sessionId: 'demo-coding-agent',
  goals: [
    {
      instruction: 'Add JWT authentication to the Express API',
      thinking: [
        'I need to understand the current auth setup. Let me read the existing middleware and routes.',
        'The app uses Express with no auth currently. I should add jsonwebtoken, create a middleware, and protect the routes.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/src/server.ts' } },
        { name: 'Read', input: { file_path: '/src/routes/api.ts' } },
        { name: 'Read', input: { file_path: '/src/middleware/index.ts' } },
        { name: 'Bash', input: { command: 'npm install jsonwebtoken @types/jsonwebtoken' } },
        { name: 'Write', input: { file_path: '/src/middleware/auth.ts', content: 'export function verifyToken(req, res, next) { ... }' } },
        { name: 'Edit', input: { file_path: '/src/routes/api.ts', old_string: 'router.get("/users"', new_string: 'router.get("/users", verifyToken,' } },
        { name: 'Edit', input: { file_path: '/src/server.ts', old_string: "import { apiRouter }", new_string: "import { apiRouter } from './routes/api'\nimport { authRouter } from './routes/auth'" } },
        { name: 'Bash', input: { command: 'npx vitest run src/middleware/auth.test.ts' } },
      ],
    },
    {
      instruction: 'The tests are failing — fix the token verification',
      thinking: [
        'The test output shows JWT_SECRET is undefined. I need to load it from environment variables.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/src/middleware/auth.ts' } },
        { name: 'Read', input: { file_path: '/.env.example' } },
        { name: 'Edit', input: { file_path: '/src/middleware/auth.ts', old_string: 'process.env.SECRET', new_string: "process.env.JWT_SECRET ?? 'dev-fallback'" } },
        { name: 'Bash', input: { command: 'npx vitest run src/middleware/auth.test.ts' } },
      ],
    },
    {
      instruction: 'Add refresh token rotation',
      thinking: [
        'Refresh token rotation is important for security. When a refresh token is used, the old one should be invalidated and a new one issued.',
        'I should store refresh tokens in the database and check them on use. Expired or reused tokens should trigger a security alert.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/src/db/schema.ts' } },
        { name: 'Write', input: { file_path: '/src/db/migrations/003_refresh_tokens.sql', content: 'CREATE TABLE refresh_tokens (...)' } },
        { name: 'Write', input: { file_path: '/src/services/token.ts', content: 'export class TokenService { ... }' } },
        { name: 'Edit', input: { file_path: '/src/routes/auth.ts', old_string: 'router.post("/refresh"', new_string: 'router.post("/refresh", async (req, res) => { await tokenService.rotate(...)' } },
        { name: 'Bash', input: { command: 'npx vitest run src/services/token.test.ts' } },
        { name: 'Bash', input: { command: 'npx vitest run --reporter=verbose' } },
      ],
    },
    {
      instruction: 'Add rate limiting to the auth endpoints',
      thinking: [
        'Rate limiting on auth endpoints prevents brute force attacks. I should use express-rate-limit with stricter limits on login/register.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'npm install express-rate-limit' } },
        { name: 'Write', input: { file_path: '/src/middleware/rate-limit.ts', content: 'export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 })' } },
        { name: 'Edit', input: { file_path: '/src/routes/auth.ts', old_string: "router.post('/login'", new_string: "router.post('/login', authLimiter," } },
        { name: 'Bash', input: { command: 'npx vitest run' } },
      ],
    },
    {
      instruction: 'Now add API key authentication for service-to-service calls',
      thinking: [
        'Service accounts need API keys, not JWTs. I should create a separate middleware that checks the X-API-Key header against stored keys.',
        'The API keys should be hashed in the database, and we need a CLI command to generate them.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/src/db/schema.ts' } },
        { name: 'Write', input: { file_path: '/src/db/migrations/004_api_keys.sql', content: 'CREATE TABLE api_keys (...)' } },
        { name: 'Write', input: { file_path: '/src/middleware/api-key.ts', content: 'export function verifyApiKey(req, res, next) { ... }' } },
        { name: 'Write', input: { file_path: '/src/cli/generate-key.ts', content: 'const key = crypto.randomBytes(32).toString("hex")' } },
        { name: 'Edit', input: { file_path: '/src/routes/api.ts', old_string: 'verifyToken', new_string: 'authenticate /* verifyToken || verifyApiKey */' } },
        { name: 'Write', input: { file_path: '/src/middleware/authenticate.ts', content: 'export function authenticate(req, res, next) { /* try JWT first, then API key */ }' } },
        { name: 'Bash', input: { command: 'npx vitest run --reporter=verbose' } },
      ],
    },
    {
      instruction: 'Write the README section for authentication',
      thinking: [
        'I should document both JWT and API key flows, including how to generate keys and the refresh token rotation.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/README.md' } },
        { name: 'Edit', input: { file_path: '/README.md', old_string: '## API', new_string: '## Authentication\n\n### JWT Flow\n...\n\n### API Keys\n...\n\n## API' } },
      ],
    },
  ],
}

// ─── Financial Analyst ─────────────────────────────────────────────────────

export const financialAnalyst: ScenarioConfig = {
  sessionId: 'demo-financial-analyst',
  goals: [
    {
      instruction: 'Analyze Q3 revenue trends for the SaaS portfolio',
      thinking: [
        'I need to pull the revenue data from our analytics database and compare it against Q2 and year-over-year.',
        'The key metrics to look at are MRR, ARR, churn rate, and expansion revenue.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/data/q3-revenue.csv' } },
        { name: 'Read', input: { file_path: '/data/q2-revenue.csv' } },
        { name: 'Bash', input: { command: 'python3 scripts/revenue-analysis.py --quarter Q3 --compare Q2' } },
        { name: 'Read', input: { file_path: '/output/q3-comparison.json' } },
      ],
      responses: [undefined, undefined, undefined, undefined, 'Q3 MRR grew 12% QoQ to $2.4M. Churn decreased from 4.2% to 3.1%. Net revenue retention is 118%.'],
    },
    {
      instruction: 'Break down the churn — which segments are losing customers?',
      thinking: [
        'I should segment by plan tier and company size. SMB churn is typically higher than enterprise.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'python3 scripts/churn-segmentation.py --quarter Q3' } },
        { name: 'Read', input: { file_path: '/output/churn-by-segment.json' } },
        { name: 'Bash', input: { command: 'python3 scripts/cohort-analysis.py --metric churn --groupby plan_tier' } },
      ],
      responses: [undefined, undefined, undefined, 'SMB churn is 6.8% (down from 7.2%). Enterprise churn is 0.9%. The "Starter" plan has the highest churn at 11.2% — most cancel within 60 days.'],
    },
    {
      instruction: 'Create a financial model for the next 4 quarters with these trends',
      thinking: [
        'I should build a cohort-based revenue model that accounts for: new MRR, expansion, contraction, and churn.',
        'Using current growth rate of 12% QoQ with seasonal adjustment for Q1 dip.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/models/base-model.xlsx' } },
        { name: 'Write', input: { file_path: '/models/q4-forecast.py', content: 'class RevenueModel: ...' } },
        { name: 'Bash', input: { command: 'python3 models/q4-forecast.py --scenarios base,optimistic,pessimistic' } },
        { name: 'Read', input: { file_path: '/output/forecast-scenarios.json' } },
        { name: 'Write', input: { file_path: '/output/forecast-summary.md', content: '# Revenue Forecast Q4-Q3 FY26\n\n## Base Case: $3.8M ARR...' } },
      ],
    },
    {
      instruction: 'What would happen if we increased prices 15% on the Pro plan?',
      thinking: [
        'Price elasticity analysis — I need to estimate how many customers we would lose vs. the revenue gain from remaining customers.',
        'Historical data shows our last price increase (10%) caused 3% incremental churn in the first quarter.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/data/price-change-history.csv' } },
        { name: 'Bash', input: { command: 'python3 scripts/price-elasticity.py --plan pro --increase 0.15' } },
        { name: 'Read', input: { file_path: '/output/price-impact.json' } },
      ],
      responses: [undefined, undefined, undefined, 'A 15% price increase on Pro would net +$180K ARR after accounting for 4.5% incremental churn. Break-even in 2 months. Recommend phasing: existing customers get 90-day notice, new customers immediately.'],
    },
  ],
}

// ─── Insurance Agent ───────────────────────────────────────────────────────

export const insurance: ScenarioConfig = {
  sessionId: 'demo-insurance-agent',
  goals: [
    {
      instruction: 'Process the new homeowner claim #HC-2025-4471 — water damage from burst pipe',
      thinking: [
        'I need to pull the policy details, verify coverage, and check for any red flags before assigning an adjuster.',
        'Water damage from burst pipes is typically covered under HO-3 policies. Need to check the deductible and coverage limits.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/claims/HC-2025-4471.json' } },
        { name: 'Read', input: { file_path: '/policies/POL-881234.json' } },
        { name: 'Bash', input: { command: 'curl -s https://api.internal/fraud-check?claim=HC-2025-4471' } },
        { name: 'Bash', input: { command: 'curl -s https://api.internal/adjuster-availability?region=northeast&specialty=water' } },
        { name: 'Write', input: { file_path: '/claims/HC-2025-4471-assignment.json', content: '{ "adjuster": "ADJ-112", "priority": "standard" }' } },
      ],
    },
    {
      instruction: 'The fraud check flagged this claim — investigate the policyholder history',
      thinking: [
        'Fraud flag triggered. I need to check: prior claims history, policy age, claim timing relative to policy changes.',
        'Also check if the policyholder recently increased coverage limits.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'curl -s https://api.internal/claims-history?policyholder=PH-5521' } },
        { name: 'Read', input: { file_path: '/policies/POL-881234-amendments.json' } },
        { name: 'Bash', input: { command: 'curl -s https://api.internal/property-records?address=142+Oak+St' } },
        { name: 'Read', input: { file_path: '/data/fraud-patterns/water-damage.json' } },
      ],
      responses: [undefined, undefined, undefined, undefined, 'Findings: Policyholder filed 2 water damage claims in 3 years. Coverage was increased 30 days before this claim. Property records show no major plumbing work permits. Recommend SIU referral.'],
    },
    {
      instruction: 'Generate the SIU referral document with all evidence',
      thinking: [
        'Special Investigations Unit referral needs: claim details, policy history, fraud indicators, and supporting documentation.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/claims/HC-2025-4471.json' } },
        { name: 'Read', input: { file_path: '/templates/siu-referral.md' } },
        { name: 'Write', input: { file_path: '/output/SIU-REF-2025-0891.md', content: '# SIU Referral\n\n## Claim: HC-2025-4471\n\n### Fraud Indicators\n- 2 prior water claims in 36 months\n- Coverage increase 30 days pre-loss\n- No plumbing permits on record\n\n### Recommendation: Full investigation' } },
        { name: 'Bash', input: { command: 'curl -X POST https://api.internal/siu/referrals -d @/output/SIU-REF-2025-0891.md' } },
      ],
    },
    {
      instruction: 'Now process the batch of 5 auto claims from yesterday',
      thinking: [
        'Batch processing — I need to triage each claim, run fraud checks, and auto-assign adjusters for clean claims.',
        'Most auto claims are straightforward fender-benders that can be fast-tracked.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/claims/batch-2025-06-14.json' } },
        { name: 'Bash', input: { command: 'python3 scripts/batch-triage.py --date 2025-06-14 --type auto' } },
        { name: 'Read', input: { file_path: '/output/triage-results.json' } },
        { name: 'Bash', input: { command: 'python3 scripts/auto-assign.py --triage /output/triage-results.json' } },
        { name: 'Write', input: { file_path: '/output/batch-report-2025-06-14.md', content: '# Auto Claims Batch Report\n\n5 claims processed. 4 auto-assigned. 1 flagged for manual review (claim amount > $50K threshold).' } },
      ],
    },
  ],
}

// ─── Customer Support ──────────────────────────────────────────────────────

export const customerSupport: ScenarioConfig = {
  sessionId: 'demo-customer-support',
  goals: [
    {
      instruction: 'Customer reports they cannot access their dashboard after upgrading to Pro plan',
      thinking: [
        'This could be a provisioning delay, a permissions issue, or a billing sync problem. Let me check their account status.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'curl -s https://api.internal/users/usr_8812/subscription' } },
        { name: 'Bash', input: { command: 'curl -s https://api.internal/users/usr_8812/permissions' } },
        { name: 'Read', input: { file_path: '/logs/provisioning/usr_8812.log' } },
      ],
      responses: [undefined, undefined, undefined, 'Found the issue: the Stripe webhook for payment confirmation was delayed. The user\'s plan shows "pro" in billing but permissions still reflect "free". Triggering manual sync.'],
    },
    {
      instruction: 'Fix the permissions and make sure this doesn\'t happen again',
      thinking: [
        'I need to manually sync the permissions now, then investigate why the webhook was delayed and add a reconciliation job.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'curl -X POST https://api.internal/users/usr_8812/sync-permissions' } },
        { name: 'Read', input: { file_path: '/src/webhooks/stripe.ts' } },
        { name: 'Read', input: { file_path: '/src/jobs/index.ts' } },
        { name: 'Write', input: { file_path: '/src/jobs/reconcile-permissions.ts', content: 'export async function reconcilePermissions() { /* check all users where plan != permissions */ }' } },
        { name: 'Edit', input: { file_path: '/src/jobs/index.ts', old_string: 'scheduleJob("cleanup"', new_string: 'scheduleJob("reconcile-permissions", "*/15 * * * *", reconcilePermissions)\nscheduleJob("cleanup"' } },
        { name: 'Bash', input: { command: 'npx vitest run src/jobs/reconcile-permissions.test.ts' } },
      ],
    },
    {
      instruction: 'Customer asks about bulk seat pricing for their 50-person team',
      thinking: [
        'Enterprise pricing with volume discounts. I should check our pricing tiers and see if they qualify for custom pricing.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/data/pricing-tiers.json' } },
        { name: 'Bash', input: { command: 'curl -s https://api.internal/users/usr_8812/org' } },
        { name: 'Read', input: { file_path: '/templates/enterprise-quote.md' } },
        { name: 'Write', input: { file_path: '/output/quote-ORG-441.md', content: '# Enterprise Quote\n\n50 seats × $39/mo = $1,950/mo\nVolume discount (20%): -$390/mo\nAnnual commitment (10%): -$156/mo\n\n**Total: $1,404/mo ($16,848/yr)**' } },
      ],
    },
    {
      instruction: 'Handle the escalated ticket about data export taking too long',
      thinking: [
        'Data export timeouts are usually caused by large datasets hitting our 30-second API timeout. Need to check the export queue and potentially switch to async processing.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'curl -s https://api.internal/exports?user=usr_9921&status=failed' } },
        { name: 'Read', input: { file_path: '/src/services/export.ts' } },
        { name: 'Edit', input: { file_path: '/src/services/export.ts', old_string: 'await generateExport(data)', new_string: 'const jobId = await queueExport(data)\nreturn { jobId, status: "processing" }' } },
        { name: 'Bash', input: { command: 'npx vitest run src/services/export.test.ts' } },
      ],
      responses: [undefined, undefined, undefined, undefined, 'Switched export to async processing. User will receive an email when export is ready. Fixed the root cause for future exports.'],
    },
    {
      instruction: 'Write the post-mortem for the permissions sync outage',
      thinking: [
        'The post-mortem should cover: impact, timeline, root cause, and action items. The permissions sync affected ~12 users over 2 hours.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/logs/webhooks/2025-06-14.log' } },
        { name: 'Bash', input: { command: 'python3 scripts/impact-analysis.py --incident permissions-sync --date 2025-06-14' } },
        { name: 'Write', input: { file_path: '/postmortems/2025-06-14-permissions-sync.md', content: '# Post-Mortem: Permissions Sync Delay\n\n**Impact:** 12 users, 2 hours\n**Root Cause:** Stripe webhook delivery delay (Stripe status page confirmed)\n**Fix:** Added 15-minute reconciliation job\n**Action Items:**\n- [ ] Add webhook retry monitoring\n- [ ] Add user-facing "sync now" button' } },
      ],
    },
  ],
}

// ─── Hedge Fund Research ───────────────────────────────────────────────────

export const hedgeFund: ScenarioConfig = {
  sessionId: 'demo-hedge-fund',
  goals: [
    {
      instruction: 'Screen the biotech sector for potential long positions — focus on Phase 3 catalysts in Q4',
      thinking: [
        'I should scan the FDA calendar for upcoming PDUFA dates, then cross-reference with our fundamental screens (market cap > $500M, cash runway > 18 months).',
        'Phase 3 readouts in Q4 are the highest-conviction trades if the trial data is clean.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'python3 screens/fda-catalyst.py --phase 3 --quarter Q4-2025' } },
        { name: 'Read', input: { file_path: '/output/fda-catalysts-q4.json' } },
        { name: 'Bash', input: { command: 'python3 screens/fundamentals.py --sector biotech --min-mcap 500M --min-cash-runway 18' } },
        { name: 'Read', input: { file_path: '/output/biotech-fundamentals.json' } },
        { name: 'Bash', input: { command: 'python3 screens/merge.py --left fda-catalysts-q4 --right biotech-fundamentals --on ticker' } },
      ],
      responses: [undefined, undefined, undefined, undefined, undefined, '12 candidates identified. Top 3 by conviction: MRNA (RSV booster PDUFA 10/15), VRTX (pain NDA 11/2), REGN (obesity Phase 3 readout 12/1).'],
    },
    {
      instruction: 'Deep dive on VRTX — build the thesis',
      thinking: [
        'Vertex pain program (VX-548) is the key catalyst. Need to analyze: trial design, competitive landscape, peak sales estimates, and options market implied move.',
        'The sell-side is split on this one. Bull case: $4B peak sales. Bear case: safety signal kills it.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/research/VRTX/trial-design.md' } },
        { name: 'Bash', input: { command: 'python3 analysis/competitive-landscape.py --indication pain --mechanism NaV1.8' } },
        { name: 'Read', input: { file_path: '/output/pain-competitive.json' } },
        { name: 'Bash', input: { command: 'python3 analysis/peak-sales.py --ticker VRTX --program VX-548 --scenarios bull,base,bear' } },
        { name: 'Bash', input: { command: 'python3 analysis/options-implied-move.py --ticker VRTX --event-date 2025-11-02' } },
        { name: 'Read', input: { file_path: '/output/VRTX-implied-move.json' } },
        { name: 'Write', input: { file_path: '/theses/VRTX-long.md', content: '# VRTX Long Thesis\n\n## Catalyst: VX-548 NDA (Nov 2)\n\n### Bull: $4.2B peak sales → $480 PT\n### Base: $2.8B peak sales → $420 PT\n### Bear: Safety signal → $320\n\nOptions imply ±18% move. Risk/reward is asymmetric: 2.5:1.' } },
      ],
    },
    {
      instruction: 'Size the position and set up the risk parameters',
      thinking: [
        'Position sizing: Kelly criterion suggests 8% of portfolio, but I should cap at 4% given the binary catalyst. Stop loss at -25%, profit target at +40%.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/portfolio/current-positions.json' } },
        { name: 'Bash', input: { command: 'python3 risk/kelly.py --win-prob 0.6 --win-size 0.40 --loss-size 0.25' } },
        { name: 'Bash', input: { command: 'python3 risk/var-impact.py --ticker VRTX --size 0.04 --portfolio current' } },
        { name: 'Write', input: { file_path: '/orders/VRTX-entry.json', content: '{ "ticker": "VRTX", "side": "buy", "size_pct": 4.0, "entry": "limit", "stop_loss": -25, "take_profit": 40 }' } },
      ],
    },
    {
      instruction: 'Run the end-of-day risk report',
      thinking: [
        'Daily risk metrics: portfolio VaR, sector exposures, largest drawdowns, and correlation matrix update.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'python3 risk/daily-report.py --date 2025-06-15' } },
        { name: 'Read', input: { file_path: '/output/risk-report-2025-06-15.json' } },
        { name: 'Bash', input: { command: 'python3 risk/correlation-update.py --window 60d' } },
        { name: 'Write', input: { file_path: '/reports/daily-2025-06-15.md', content: '# Daily Risk Report\n\nPortfolio VaR (95%): -2.1%\nNet exposure: 72% long\nSector tilt: +15% biotech vs benchmark\nLargest single-name risk: VRTX at 4.0%' } },
      ],
    },
  ],
}

// ─── Research Agent ────────────────────────────────────────────────────────

export const researchAgent: ScenarioConfig = {
  sessionId: 'demo-research-agent',
  goals: [
    {
      instruction: 'Survey the current state of retrieval-augmented generation (RAG) techniques — focus on what changed in 2025',
      thinking: [
        'I should look at the major developments: dense retrieval improvements, hybrid search, agentic RAG, and the move toward graph-based knowledge representations.',
        'Key papers to find: ColBERT v3, RAPTOR, GraphRAG (Microsoft), and any new chunking strategies.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'python3 search/arxiv.py --query "retrieval augmented generation 2025" --limit 20' } },
        { name: 'Read', input: { file_path: '/output/arxiv-results.json' } },
        { name: 'Bash', input: { command: 'python3 search/semantic-scholar.py --query "agentic RAG" --year 2025 --limit 10' } },
        { name: 'Bash', input: { command: 'python3 search/github-trending.py --topic "RAG" --language python --since monthly' } },
        { name: 'Read', input: { file_path: '/output/github-trending-rag.json' } },
      ],
    },
    {
      instruction: 'Summarize the top 5 papers and their key contributions',
      thinking: [
        'I should extract: problem addressed, method, key results, and practical implications for each paper.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'python3 analysis/paper-download.py --ids 2501.12345,2502.67890,2503.11111,2504.22222,2505.33333' } },
        { name: 'Read', input: { file_path: '/papers/2501.12345.txt' } },
        { name: 'Read', input: { file_path: '/papers/2502.67890.txt' } },
        { name: 'Read', input: { file_path: '/papers/2503.11111.txt' } },
        { name: 'Read', input: { file_path: '/papers/2504.22222.txt' } },
        { name: 'Read', input: { file_path: '/papers/2505.33333.txt' } },
        { name: 'Write', input: { file_path: '/output/rag-survey-2025.md', content: '# RAG in 2025: Key Developments\n\n## 1. Graph-Augmented RAG\n...\n## 2. Agentic RAG\n...' } },
      ],
    },
    {
      instruction: 'Compare the retrieval accuracy benchmarks across these approaches',
      thinking: [
        'I need to normalize the benchmark results across papers. Most report on BEIR, NQ, or HotpotQA. I should build a comparison table.',
      ],
      tools: [
        { name: 'Bash', input: { command: 'python3 analysis/extract-benchmarks.py --papers /papers/*.txt --benchmarks BEIR,NQ,HotpotQA' } },
        { name: 'Read', input: { file_path: '/output/benchmark-comparison.json' } },
        { name: 'Bash', input: { command: 'python3 analysis/plot-benchmarks.py --input benchmark-comparison.json --output benchmark-chart.png' } },
        { name: 'Write', input: { file_path: '/output/benchmark-analysis.md', content: '# Benchmark Comparison\n\n| Method | BEIR | NQ | HotpotQA |\n|--------|------|----|---------|\n| Dense (baseline) | 0.42 | 0.55 | 0.38 |\n| Graph-RAG | 0.51 | 0.62 | 0.49 |\n| Agentic RAG | 0.48 | 0.68 | 0.52 |' } },
      ],
    },
    {
      instruction: 'What are the practical recommendations for a production RAG system?',
      thinking: [
        'Based on the survey, I should synthesize actionable recommendations: chunking strategy, retrieval method, reranking, and when to use graph vs. vector approaches.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/output/rag-survey-2025.md' } },
        { name: 'Read', input: { file_path: '/output/benchmark-analysis.md' } },
        { name: 'Write', input: { file_path: '/output/rag-recommendations.md', content: '# Production RAG Recommendations (2025)\n\n## 1. Use hybrid retrieval (dense + sparse)\n## 2. Implement adaptive chunking\n## 3. Add a reranker (ColBERT v3)\n## 4. Consider GraphRAG for multi-hop questions\n## 5. Use agentic RAG for complex queries\n\n### Decision Matrix\n...' } },
      ],
    },
    {
      instruction: 'Draft a blog post summarizing our findings for the engineering team',
      thinking: [
        'The blog post should be accessible to engineers who know RAG basics but want to understand the 2025 landscape.',
      ],
      tools: [
        { name: 'Read', input: { file_path: '/output/rag-survey-2025.md' } },
        { name: 'Read', input: { file_path: '/output/rag-recommendations.md' } },
        { name: 'Write', input: { file_path: '/blog/rag-2025-landscape.md', content: '# The RAG Landscape in 2025: What Changed and What to Use\n\n## TL;DR\nGraph-RAG wins on multi-hop. Agentic RAG wins on complex queries. Hybrid retrieval is table stakes.\n\n## The Evolution\n...' } },
      ],
    },
  ],
}
