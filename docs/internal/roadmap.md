# Roadmap

**Internal — MetaCTO team only.** Single source of truth for phased delivery. Not shown in the public docs site. Live status (shipped, in flight, decision log) lives in [`progress.md`](./progress.md). Forcing-function workflow list in [`use-case-catalog.md`](./use-case-catalog.md).

Phased to preserve MetaCTO revenue at every step; nothing ships that breaks live client work.

---

## Cross-cutting — shipped April 2026

Framing changes that aren't a "phase" but reorganized everything:

- [x] **Rebrand** from CoreContext → Compiles. `@compiles/core` on npm scope, `compiles-ai/compiles-core` on GitHub.
- [x] **Layered repo architecture** — `@compiles/core` (runtime), `@compiles/sdk` (stable contract), `@compiles/plugin-*` (connectors + skills), `compiles-starter` (forkable install), `<client>-compiles` (tenant). Spec: [`docs/reference/repo-architecture.md`](../reference/repo-architecture.md).
- [x] **Five primitives** vocabulary — Source, Object, Skill, Workflow, Agent. One page per primitive in public docs; canonical card shape in the dashboard catalog + drilldown pages.
- [x] **npm workspaces** (Phase B of repo architecture) — `packages/core`, `packages/sdk`, `packages/plugins/transcript-highlights`.
- [x] **Docs IA** — `docs/concepts/`, `docs/guides/`, `docs/reference/` (and `docs/api/` as of this phase).
- [x] **Git externalized from the app** — MCP `context_write_*` and the dashboard write to disk + apply to DB; commit + push is the user's responsibility. Dirty badge on primitive pages shows uncommitted state.

---

## Phase 1 — Context-as-Code ✓ (Q2 2026)

Pull hardcoded client data out of the app into `context/<org>/` — YAML + markdown, git-versioned.

- [x] `context/<org>/` scaffold + schema
- [x] Apply/reconcile job: repo → DB, idempotent
- [x] `context_version` table + `skill_run.context_sha` audit trail
- [x] First reference tenant extracted (MetaCTO Ziggy — see [`case-studies/`](./case-studies/README.md)); legacy seed scripts retired
- [x] Authoring guide ([`docs/guides/authoring-context.md`](../guides/authoring-context.md))

**Exit criteria met:** the reference tenant runs entirely from git-backed context. No client-specific strings in core.

---

## Phase 2 — Universal Interface Layer (Q3 2026) — partial ✓

Make Compiles reachable from wherever people already work. Skills, context, and review queues are shared across channels. *Channels* means both human-facing (Claude Code, Slack, ChatGPT, web) and machine-facing (HTTP API + A2A for agent handoff).

- [x] **MCP server (stdio)** — Claude Code, Claude app, Cursor, Zed, Continue (shipped 2026-04-14)
- [x] **Approve/reject surface** — `runtime_approve_draft` / `reject_draft` as MCP tools, plus web UI at `/dashboard/review`
- [x] **Auto-apply to DB** — MCP `context_write_*` + context:apply CLI. Git is external; commit is opt-in.
- [ ] **MCP HTTP + OAuth transport** — needed for cloud / multi-tenant
- [ ] **ChatGPT Actions + listed GPT** — OAuth, OpenAPI spec auto-generated from oRPC
- [ ] **Slack bot** — slash commands, DMs, interactive approval messages
- [ ] **Teams bot** — Bot Framework adapter
- [ ] **A2A protocol server (inbound)** — serve our agents via Google's A2A spec so external agents can hand off tasks to a Compiles agent. Task lifecycle, capability discovery, auth.

**Exit criteria:** a skill run started from any channel shows up in the same review queue. External agents can invoke a Compiles agent via A2A and get a task id back.

---

## Phase 2.5 — Public API for primitives + runs (Q3 2026) — **NEW**

The non-agent, non-chat integration story: a tenant has their own system (construction field-notes app, loan-origination platform, ERP event bus) and wants to POST an object, trigger a workflow, and poll for the result. We need a first-class REST API for that — narrower than MCP (no auth-less stdio, no free-form agent chat) and broader than A2A (no requirement to speak agent protocols).

- [ ] **Tenant-scoped API tokens** — generated per org, scoped to primitive CRUD + run triggering. Stored hashed. Rotate/revoke via dashboard.
- [ ] **OpenAPI 3.1 spec** auto-generated from oRPC + hand-written route surfaces
- [ ] **Primitive CRUD** — `GET/POST/PATCH /api/v1/{agents,skills,workflows,objects,sources}`, `GET /api/v1/{kind}/:slug`
- [ ] **Object ingest** — `POST /api/v1/objects/:slug/instances` accepts a document payload, returns object id. Use case: construction app pushes field notes.
- [ ] **Run triggers** — `POST /api/v1/skills/:slug/runs`, `POST /api/v1/workflows/:slug/runs` start a run, return `run_id` + status
- [ ] **Run polling** — `GET /api/v1/runs/:id` returns status + output (or null while pending)
- [ ] **Run streaming** — optional SSE endpoint for long-running workflows
- [ ] **Webhooks out** — tenant can register URL + filter; Compiles POSTs on skill-run completion, workflow-approval-needed, workflow-completed
- [ ] **Docs site** — `docs/api/` peer to concepts/guides/reference with auth, primitive CRUD, run lifecycle, webhooks, idempotency keys, rate limits

**Exit criteria:** a backend engineer with zero Compiles knowledge can, in 30 minutes: issue a token, POST an object, trigger a workflow, poll for the result, and receive a webhook when a human approves an intermediate draft.

---

## Phase 3 — Plugin SDK v1 (Q4 2026)

Extract skills and sources from the monorepo into a publishable plugin contract. Prerequisite for ecosystem + for a meta-agent that composes them.

- [x] v0.1 — Skill contract, registry, loader, dual-path execution, sample plugin (shipped 2026-04-14)
- [x] Pluggable LLM provider on plugin skills (`openai | anthropic | vertex | azure-openai`) — openai + anthropic shipped; vertex + azure placeholders
- [x] v0.2 — Extracted to `@compiles/sdk` as an npm workspace (`packages/sdk`). Public npm publish pending.
- [ ] `@compiles/sdk` published to npm (placeholder `@compiles/core@0.0.0` reserves scope)
- [ ] Source contract for connectors (Teams, HubSpot, DocuSign, Gamma as first plugins)
- [ ] Review UI components shipped via plugins
- [ ] Plugin hot-reload in dev, semver resolution in prod
- [ ] Eval harness runs plugin evals on CI for every PR

**Exit criteria:** a partner can publish a skill or source without a core PR.

---

## Phase 4 — Native Retrieval (Q1 2027)

**Moved up from Q2 2027.** The 12-container Onyx stack is the single biggest friction in every install; the quickstart's "10 minutes" is aspirational until this ships. Smaller scope than the feedback loop and higher operational payoff.

Replace Onyx with a pgvector-native pipeline. Also introduce `backend:` in `retrieval.yaml` so enterprise customers can point at Vertex AI Search or Azure AI Search instead of native — without changing platform abstractions.

- [ ] pgvector schema + HNSW index (native default)
- [ ] Postgres FTS layer
- [ ] RRF hybrid ranker
- [ ] Pluggable embedder + reranker interfaces + default implementations
- [ ] `retrieval.yaml` config: `backend: native | vertex-search | azure-search`
- [ ] Vertex + Azure backends as source plugins (opt-in, enterprise)
- [ ] Migration tool: existing Onyx index → pgvector
- [ ] Deprecate Onyx containers

**Exit criteria:** zero Onyx dependency in new deployments; feature parity on search quality. Fresh-install quickstart actually runs in 10 minutes on a laptop.

---

## Phase 5 — Feedback + Self-Improvement Loop (Q2 2027)

**Moved down from Q1 2027**, now that native retrieval unblocks the "10-minute install" story and makes eval-driven improvement cheap.

Make every skill and workflow learnable. Platform-wide, not per-agent. Closes the loop on human review so prompts improve without becoming opaque.

- [ ] `skill_run.feedback` column: rating (thumb up/down), note, submitted_by, submitted_at
- [ ] UI hooks in review queue + post-hoc feedback surface (email "was this useful?" link)
- [ ] `workflow_run.feedback` equivalent
- [ ] `improve_skill` meta-skill: aggregates last N runs + feedback, proposes prompt diff as a PR-style context change (branch, not main)
- [ ] Eval harness runs proposed prompt vs current on held-out fixtures before merge
- [ ] Weekly `skill_improvement_review` workflow — scheduled, surfaces candidates for human review

**Exit criteria:** a skill that underperforms shows up on a weekly report with auto-drafted prompt improvements ready for human approval.

---

## Phase 6 — Auto-Generated Deliverables (Q3 2027)

Turn the 5 standard artifacts (Workflow Blueprint, Context Map, Economics Baseline, Live Review, Launch Scorecard) into platform output.

- [ ] Workflow Blueprint generator (renders from `workflows/*.md`)
- [ ] Context Map PDF export
- [ ] Economics Baseline dashboard from skill_run aggregates
- [ ] Launch Scorecard (monthly) — SQL + templated deck, exports to Gamma
- [ ] Monthly Review runner (computes the 6-section agenda automatically)

**Exit criteria:** a MetaCTO ops lead generates the monthly review deck with one click.

---

## Phase 7 — Conversational Bootstrap / WOW (Q4 2027)

The magic moment. User connects sources, describes a workflow in natural language, and Compiles builds it — skill YAML, prompt MD, workflow YAML, all PR-reviewable. Sits after Plugin SDK + Native Retrieval + Feedback Loop so the meta-agent has a clean, composable, self-correcting substrate underneath.

- [x] **Workflow primitive** — trigger → steps → action, composes skills/objects (shipped 2026-04-14 — pulled forward)
- [ ] **Meta-agent** — a special skill with write access to `context/<org>/`; takes NL intent, emits manifests, uses the MCP write tools
- [ ] **Event bus wiring** — workflow triggers: event, schedule, webhook
- [ ] **New workflow step type `agent_call` (outbound A2A)** — invoke an external A2A-speaking agent as a step; long-running tasks polled until complete; output flows to subsequent steps. Complements the Phase 2 inbound A2A server so workflows can orchestrate external agents, not just our own skills.
- [ ] **Self-service OAuth** — users connect Gmail/HubSpot/DocuSign themselves (no admin config)
- [ ] **Onboarding stepper** — connect → ingest → chat → build, with live progress
- [ ] **Sample workflow library** — import from [`use-case-catalog.md`](./use-case-catalog.md) as starting templates
- [ ] **Preview-on-real-data** — "I just built this. Here's what it would do on your last 5 discovery calls. Keep?"

**Exit criteria:** a prospect goes cold → running their first AI workflow in under 10 minutes. Workflows can call external A2A agents alongside our own skills.

---

## Phase 8 — OSS Launch + MetaCTO Cloud (Q1 2028)

- [ ] Public repo + Apache 2.0 license
- [x] Tenant extraction path documented ([`docs/guides/extract-tenant.md`](../guides/extract-tenant.md))
- [ ] Actually split `context/metacto/` → `metacto-compiles` repo via `git subtree split`
- [ ] MetaCTO Cloud beta: hosted Postgres + pgvector, managed evals, SSO
- [ ] Reference installs: 3 external clients running OSS in production
- [ ] Launch blog + conference talk

**Exit criteria:** OSS stars trending; first non-MetaCTO contributor PR merged; first paid cloud customer.

---

## Phase 9 — Ecosystem + Enterprise (Q2 2028+)

- [ ] Plugin marketplace (listings, signing, permission scopes)
- [ ] SSO/SAML, SCIM, audit export, data residency regions
- [ ] Document-level RBAC at retrieval + agent layers
- [ ] Role-based skill access + multi-step approval chains
- [ ] Community plugin incentives (bounties for top connectors)

---

## First-12 workflows to prove the roadmap

Pulled from [`use-case-catalog.md`](./use-case-catalog.md) — selected for breadth across industry, department, and platform capability:

1. Sales proposal decks from call transcripts (L4, review + audit)
2. Support reply drafting with exception review (L4, conditional routing)
3. Weekly business reporting with signoff (L4, scheduled + approval)
4. Feature request → PRD draft (L3, structured output)
5. Client intake → SOW draft (L5, plugin orchestration)
6. RFP response workflow (L5, owner routing)
7. Incident summary → customer update workflow (L5, multi-output)
8. Candidate interview summary workflow (L2)
9. Executive reporting packet (L4, cross-channel approval)
10. Procurement decision pack (L5, audit + multi-input)
11. Underwriting recommendation workflow (L5, external API + exception queue)
12. Prior authorization packet drafting (L4, evidence-gated approval)

Each one, once shipped, also becomes a public marketing case study on `/use-cases`.
