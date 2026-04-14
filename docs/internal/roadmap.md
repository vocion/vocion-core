# Roadmap

**Internal — MetaCTO team only.** Single source of truth for phased delivery. Not shown in the public docs site. Live status (shipped, in flight, decision log) lives in [`progress.md`](./progress.md).

Phased to preserve MetaCTO revenue at every step; nothing ships that breaks live client work.

## Phase 1 — Context-as-Code ✓ (Q2 2026)

Pull hardcoded client data out of the app into `context/<org>/` — YAML + markdown, git-versioned.

- [x] `context/<org>/` scaffold + schema
- [x] Apply/reconcile job: repo → DB, idempotent
- [x] `context_version` table + `skill_run.context_sha` audit trail
- [x] First reference tenant extracted (MetaCTO Ziggy — see [`case-studies/`](./case-studies/README.md)); legacy seed scripts retired
- [x] Authoring guide ([`context/README.md`](../../context/README.md))

**Exit criteria met:** the reference tenant runs entirely from git-backed context. No client-specific strings in core.

## Phase 2 — Universal Interface Layer (Q3 2026) — partial ✓

Make CoreContext accessible from wherever you already work. Skills, context, and review queues are shared across channels. *Channels* means both human-facing (Claude Code, Slack, ChatGPT, web) and agent-facing (A2A protocol for agent-to-agent handoff).

- [x] **MCP server (stdio)** — Claude Code, Claude app, Cursor, Zed, Continue (shipped 2026-04-14)
- [x] **Auto-apply + versioning** — MCP writes to `context/<org>/`, auto-commits, applies; every write creates a `context_version` row
- [x] **Approve/reject surface** — `runtime_approve_draft` / `reject_draft` as MCP tools, plus web UI at `/dashboard/review`
- [ ] **MCP HTTP + OAuth transport** — needed for cloud / multi-tenant
- [ ] **ChatGPT Actions + listed GPT** — OAuth, OpenAPI spec auto-generated from oRPC
- [ ] **Slack bot** — slash commands, DMs, interactive approval messages
- [ ] **Teams bot** — Bot Framework adapter
- [ ] **A2A protocol server (inbound)** — serve our agents via Google's A2A spec + compatible emerging standards so Claude / ChatGPT / LangGraph / other-platform agents can hand off tasks to a CoreContext agent. Task lifecycle, capability discovery, auth.

**Exit criteria:** Chris can build + modify Ziggy from Claude Code via MCP (done ✓). A skill run started in Slack shows up in the same review queue as one started in the web UI (pending Slack adapter). External agents can invoke a CoreContext agent via A2A and get a task id back.

## Phase 3 — Plugin SDK v1 (Q4 2026)

Extract skills and sources from the monorepo into a publishable plugin contract. Prerequisite for ecosystem + for a meta-agent that composes them.

- [x] v0.1 — Skill contract, registry, loader, dual-path execution, sample plugin (shipped 2026-04-14)
- [x] Pluggable LLM provider on plugin skills (`openai | anthropic | vertex | azure-openai`) — openai + anthropic shipped; vertex + azure placeholders
- [ ] v0.2 — Extract to `@corecontext/sdk` npm package
- [ ] Source contract for connectors (Teams, HubSpot, DocuSign, Gamma as first plugins)
- [ ] Review UI components shipped via plugins
- [ ] Plugin hot-reload in dev, semver resolution in prod
- [ ] Eval harness runs plugin evals on CI for every PR

**Exit criteria:** a partner can publish a skill or source without a core PR.

## Phase 4 — Feedback + Self-Improvement Loop (Q1 2027)

Make every skill and workflow learnable. Platform-wide, not per-agent — applies equally to Ziggy's email drafts, Algren's NINJIO prep packs, any future skill. Closes the loop on human review so prompts improve without becoming opaque.

- [ ] `skill_run.feedback` column: rating (thumb up/down), note, submitted_by, submitted_at
- [ ] UI hooks in review queue + post-hoc feedback surface (email "was this useful?" link)
- [ ] `workflow_run.feedback` equivalent
- [ ] `improve_skill` meta-skill: aggregates last N runs + feedback, proposes prompt diff as a PR-style context change (branch, not main)
- [ ] Eval harness runs proposed prompt vs current on held-out fixtures before merge
- [ ] Weekly `skill_improvement_review` workflow — scheduled, surfaces candidates for human review

**Exit criteria:** a skill that underperforms shows up on a weekly report with auto-drafted prompt improvements ready for human approval.

## Phase 5 — Native Retrieval (Q2 2027)

Replace Onyx with the pgvector-native pipeline. Also introduce `backend:` in `retrieval.yaml` so enterprise customers can point at Vertex AI Search or Azure AI Search instead of native — without changing the platform abstractions.

- [ ] pgvector schema + HNSW index (native default)
- [ ] Postgres FTS layer
- [ ] RRF hybrid ranker
- [ ] Pluggable embedder + reranker interfaces + default implementations
- [ ] `retrieval.yaml` config: `backend: native | vertex-search | azure-search`
- [ ] Vertex + Azure backends as source plugins (opt-in, enterprise)
- [ ] Migration tool: existing Onyx index → pgvector
- [ ] Deprecate Onyx containers

**Exit criteria:** zero Onyx dependency in new deployments; feature parity on search quality. Enterprise customers can pick managed backend at deploy.

## Phase 6 — Auto-Generated Deliverables (Q3 2027)

Turn the 5 standard artifacts into platform output.

- [ ] Workflow Blueprint generator (renders from `workflows/*.md`)
- [ ] Context Map PDF export
- [ ] Economics Baseline dashboard from skill_run aggregates
- [ ] Launch Scorecard (monthly) — SQL + templated deck, exports to Gamma
- [ ] Monthly Review runner (computes the 6-section agenda automatically)

**Exit criteria:** a MetaCTO ops lead generates the monthly review deck with one click.

## Phase 7 — Conversational Bootstrap / WOW (Q4 2027)

The magic moment. User connects sources, describes a workflow in natural language, and CoreContext builds it — skill YAML, prompt MD, workflow YAML, all PR-reviewable. Sits after Plugin SDK + Native Retrieval + Feedback Loop so the meta-agent has a clean, composable, self-correcting substrate underneath.

- [x] **Workflow primitive** — trigger → steps → action, composes skills/objects (shipped 2026-04-14 — pulled forward)
- [ ] **Meta-agent** — a special skill with write access to `context/<org>/`; takes NL intent, emits manifests, uses all the MCP write tools
- [ ] **Event bus wiring** — workflow triggers: event, schedule, webhook (schema exists; bus doesn't)
- [ ] **New workflow step type `agent_call` (outbound A2A)** — invoke an external A2A-speaking agent as a step; long-running tasks polled until complete; output flows to subsequent steps. Complements the Phase 2 inbound A2A server so workflows can orchestrate external agents, not just our own skills.
- [ ] **Self-service OAuth** — users connect Gmail/HubSpot/DocuSign themselves (no admin config)
- [ ] **Onboarding stepper** — connect → ingest → chat → build, with live progress
- [ ] **Sample workflow library** — import templates (Ziggy-style skills as starting points)
- [ ] **Preview-on-real-data** — "I just built this. Here's what it would do on your last 5 discovery calls. Keep?"

**Exit criteria:** a prospect goes from cold to running their first AI workflow in under 10 minutes. Workflows can call external A2A agents alongside our own skills, making us orchestration-neutral.

## Phase 8 — OSS Launch + MetaCTO Cloud (Q1 2028)

- [ ] Public repo + Apache 2.0 license
- [ ] Docs site, getting-started, contributor guide
- [ ] MetaCTO Cloud beta: hosted Postgres + pgvector, managed evals, SSO
- [ ] Reference installs: 3 external clients running OSS in production
- [ ] Launch blog + conference talk

**Exit criteria:** OSS stars trending; first non-MetaCTO contributor PR merged; first paid cloud customer.

## Phase 9 — Ecosystem + Enterprise (Q2 2028+)

- [ ] Plugin marketplace (listings, signing, permission scopes)
- [ ] SSO/SAML, SCIM, audit export, data residency regions
- [ ] Document-level RBAC at retrieval + agent layers
- [ ] Role-based skill access + multi-step approval chains
- [ ] Community plugin incentives (bounties for top connectors)
