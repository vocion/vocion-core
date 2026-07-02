# Roadmap

**Internal — MetaCTO team only.** Single source of truth for phased delivery. Not shown in the public docs. Live status lives in [`changelog.md`](./changelog.md); forcing-function workflow list in [`use-cases/catalog.md`](./use-cases/catalog.md). **The route to 1.0** — defined by the FirstHQ 1.0 layer + the Daylyte (PPC/CRO reporting) and Metacto RevOps reference deployments — is in [`vocion-1.0-path.md`](./vocion-1.0-path.md).

Phased to preserve MetaCTO revenue at every step; nothing ships that breaks live client work.

---

## Contents

1. [Snapshot — what's already shipped](#snapshot--whats-already-shipped)
2. [**Activation sprint (V-act) — current**](#activation-sprint-v-act----current)
3. [Pipeline-green track](#pipeline-green-track-engineering-health--unblocks-semantic-release)
4. [Phase 2 — Interface layer (finish)](#phase-2--interface-layer-finish)
   - [Phase 2.5 — Agent tool layer + skill contract (Agent → Skill → Tool)](#phase-25--agent-tool-layer--skill-contract-agent--skill--tool)
3. [Phase 3 — Native retrieval](#phase-3--native-retrieval)
4. [Phase 4 — Self-improvement loop (finish)](#phase-4--self-improvement-loop-finish)
5. [Phase 5 — Plugin SDK v1 + connector pack](#phase-5--plugin-sdk-v1--connector-pack)
6. [Phase 6 — Triggers + durable runner](#phase-6--triggers--durable-runner)
7. [Phase 7 — Public API (write side)](#phase-7--public-api-write-side)
8. [Phase 8 — Conversational bootstrap](#phase-8--conversational-bootstrap)
9. [Phase 9 — Measurement + economics](#phase-9--measurement--economics)
10. [Phase 10 — OSS launch](#phase-10--oss-launch)
11. [Phase 11 — Vocion Cloud (proprietary)](#phase-11--vocion-cloud-proprietary)
12. [Phase 12 — Ecosystem](#phase-12--ecosystem)
13. [Phase 13 — Enterprise (proprietary)](#phase-13--enterprise-proprietary)
14. [Missions — open-ended team work (feature track)](#missions--open-ended-team-work-feature-track)
15. [First-12 workflows as forcing functions](#first-12-workflows-as-forcing-functions)

---

## Snapshot — what's already shipped

Everything here is live on `main`.

### Foundation
- [x] Workspace-as-code loop — `workspace/<org>/` (YAML + markdown), idempotent apply, `workspace_version` audit, `skill_run.workspace_sha` stamping
- [x] Reference tenant (MetaCTO / Ziggy) runs entirely from git-backed context
- [x] `WORKSPACE_PATH` makes tenant extraction trivial; extraction playbook documented
- [x] Native pgvector retrieval ([Phase 3](#phase-3--native-retrieval) pipeline) — HNSW cosine + Postgres FTS + RRF fusion + optional rerank; Onyx engine removed

### Interface layer (partial)
- [x] MCP server over stdio — Claude Code, Claude app, Cursor, Zed, Continue
- [x] Auto-apply to DB on MCP `context_write_*`; git is external (commit opt-in)
- [x] Approve/reject surface — MCP tools + web `/dashboard/review`
- [x] Tenant-scoped REST API (read side): `GET /api/v1/{agents,skills,workflows,objects/types,runs,runs/:id}` with auth.js session auth

### Plugin SDK
- [x] v0.1 — typed Skill contract, registry, loader, dual-path execution, sample plugin
- [x] v0.2 — extracted to `@vocion/sdk` npm workspace
- [x] Pluggable LLM providers (OpenAI, Anthropic live; Vertex + Azure placeholder)
- [x] JS postprocess sidecar — `scriptFile:` in skill.yaml imports + runs a per-skill transform after the LLM call

### Feedback + logs loop (capture side)
- [x] `skill_run` + `workflow_run` schema: `rating`, `feedbackNote`, `feedbackBy`, `feedbackAt`
- [x] Review queue captures rating + note on approve/reject
- [x] `/dashboard/logs` — browsable timeline, filter by kind/status/rating
- [x] Inline `FeedbackButtons` in audit rows + every chat skill-run output
- [x] `POST /api/v1/runs/:id/feedback` endpoint (idempotent)

### Workflow primitive (pulled forward from later phase)
- [x] `trigger → steps → action`, composes skills + objects
- [x] Approve gates persist state, resumable from any interface
- [x] Step results JSONB, `{{steps.x.output}}` interpolation

### In-app editing
- [x] `PrimitiveFiles` viewer with CodeMirror edit for YAML / Markdown / JavaScript
- [x] `context.writeFile` oRPC route — path-traversal guarded, extension allowlist, re-applies after save
- [x] Dirty badge when the workspace repo has uncommitted changes

### Built-in agent tools (v1.24.0 — partial [Phase 2.5](#phase-25--agent-tool-layer--skill-contract-agent--skill--tool))
- [x] `web_search` — Tavily (default) / Brave, provider-pluggable via `VOCION_WEBSEARCH_PROVIDER`
- [x] Browse — `fetch_url` + `crawl_site` (reuses the `web` connector extractor; Firecrawl opt-in)
- [x] `run_code` — built-in **safe calculator** (allowlisted identifiers via `Object.hasOwn`, no eval); E2B sandbox reserved
- [x] `generate_image` (OpenAI gpt-image-1) + `create_artifact` (CSV / SVG chart / doc) → artifact store at `/artifacts`
- [x] `/dashboard/tools` catalog (provider + key status) reading `libs/tools/catalog.ts`
- [ ] Remaining Phase 2.5 contract — `defineTool` registry, per-skill `tools:` allowlist + enforcement, `http_request`, `sql_query`, outbound MCP client, per-tool budgets (still open)

### Missions — third work mode (v1.25.0, MVP — see [feature track](#missions--open-ended-team-work-feature-track))
- [x] `mission` + `mission_run` schema; migration `0024`; one Agent framework, three modes (structured / mission / team)
- [x] `MissionService` + `services/missions/{planner,runtime,autonomy}` — brief → task graph, dispatch per-task via `runAgentDeep`, autonomy ladder gates external actions (pause → `awaiting_review`), artifacts, resumable state, promote-to-workflow stub
- [x] oRPC `missions.*` + MCP `mission_*` + workspace authoring (`MissionManifestSchema`, loader, applier) + 2 seed templates
- [x] **Mission Room** dashboard (`/dashboard/missions`) — list, brief form, run detail (Brief/Plan/Team/Artifacts/Coaching)

### UX + framing (cross-cutting)
- [x] Rebrand Vocion → Vocion (repo, npm scope, docs, marketing, domain)
- [x] Layered repo architecture — `@vocion/core` + sdk + plugins + starter + tenant
- [x] Five-resource authoring vocabulary (Source, Object, Skill, Workflow, Agent); "primitives" is internal code-only. **Tools** are the sixth, lower-level primitive that skills call — the canonical model is **Agent → Skill → Tool** (a skill is an agent's *role*: logic + acceptance evals + tool access; it is not itself a tool). The marketing site + public docs were refactored to this model; formalizing it in code is [Phase 2.5](#phase-25--agent-tool-layer--skill-contract-agent--skill--tool).
- [x] Dashboard canonical shape — TitleBar + stats + instance grid + Activity strip + PrimitiveFiles editor
- [x] Sidebar consolidation — Workspace (Chat/Search/Reviews/Logs), Context (the five resources), admin in the user menu
- [x] Docs IA — Get started / Concepts / Guides / API / Reference; public vs internal split
- [x] Use-case catalog — 50 workflows across 5 complexity levels, 12 featured, filterable on `/use-cases`

### Control plane + connectors + actions + teams (v1.26–v1.43 — audited 2026-07-01)

*The V-control and V-connect milestones landed here; several phase sections below predate them —
their status blockquotes have been corrected in the 2026-07-01 audit pass.*

- [x] Scoped retrieval + document ACL (v1.26); permission model — discovery vs mutation (v1.27); unified review queue + `enforce()` (v1.28); durable ingestion — checkpoints + incremental (v1.29)
- [x] Tenant Bearer tokens `vcn_live_…` (v1.30) + write API on reviews/events through authz (v1.33) + **MCP over HTTP** on Bearer (v1.34) — OAuth sign-in flow still open
- [x] **Connector pack in core** — HubSpot (v1.31); Google Ads, GA4, Gmail, Slack (v1.32); Drive (v1.35); credentials decrypted from the vault into sync (v1.36). All real APIs, incremental via `source_sync_checkpoint`
- [x] Scheduled syncs on Temporal — `sourceSyncWorkflow` + `SourceScheduleService` (v1.37) — **but see Activation: nothing calls `ensureSourceSchedule` yet**
- [x] Multi-user review routing — assign / snooze / per-person queues (v1.38)
- [x] Actions framework — gated connector writes, `action_run` + review-queue integration (v1.39); `gmail.send` (v1.39); `hubspot.update` (v1.41)
- [x] Event-trigger runner — `emitEvent` dedupe + fan-out to subscribed workflows, `POST /api/v1/events` (v1.40)
- [x] Teams — `role: lead|specialist`, `agentType`, `team` grouping; `/dashboard/teams` (v1.42)
- [x] White-label brand slot + chat-runtime skills fix (v1.43)

---

## What's next — ordered by dependency

Targets are soft; order is the commitment. Each phase title flags `(OSS)` for open-source work or `(proprietary)` for `vocion-cloud` work. The repo split is summarized [below](#repo-split-oss-vs-proprietary).

### Activation sprint (V-act) — ⟵ CURRENT

*2026-07-01 audit conclusion: the capability gap is closed; the **activation** gap is not. The live
RevOps box has 5 agents, 4 sources, 4 missions authored — and 0 credentials, 0 documents, 0 runs,
no worker container. Everything below makes shipped capability reachable without psql or SSH.*

- [ ] **Credential onboarding** — `/dashboard/sources/<slug>` credential form (paste API key / run OAuth) → `source_credential` via the vault; per-source "test connection" + "sync now"; CLI fallback (`npm run creds:set -- --source hubspot`) for headless installs
- [ ] **Schedule dispatch wiring** — `workspace:apply` + the sources oRPC route call `ensureSourceSchedule` on upsert (and delete the schedule on source removal) so authored `schedule:` crons become live Temporal schedules; same for workflow `trigger: schedule`
- [ ] **Worker deploy target** — `worker` build stage in `packages/core/Dockerfile` (standalone output trims `src/scripts/*` today, so the compose `worker`/`temporal-worker` commands crash); compose profiles enabled in the reference deploy; feedback worker + Temporal worker run as first-class containers
- [ ] **Model refresh — Fable 5** — default `main` role `claude-sonnet-4-6` → **`claude-fable-5`** (env-overridable as today); keep `claude-haiku-4-5-20251001` classifier; align workspace defaults (RevOps `workspace.yaml` still declares `gpt-5.4-mini`); re-run evals + Langfuse pricing bootstrap for the new model
- [ ] **Token issuance UI** — `/dashboard/admin` page to issue/revoke `vcn_live_…` tokens (service exists; issuance is a manual DB path today)
- [ ] **Onboarding-to-project routing** — a second sign-up currently lands in an empty second project (prod has `projects=2`, one dark); default new members into the account's existing project, invites flow later
- [ ] **Measurement slice (Phase 9 pull-forward)** — approval rate, time-to-approve, runs/day, cost per run on `/dashboard/metrics`; enough to prove ROI on the reference deployments, full Phase 9 stays put

**Exit:** a fresh deployment goes `terraform apply` → sign in → paste credentials → first scheduled
sync lands documents → an agent proposes a gated action → it's approved from the review queue —
zero SSH, zero psql.

### Pipeline-green track (engineering health — unblocks semantic-release)

*Git tags are stuck at `vocion-v0.5.5` while `main` has accumulated `feat:` commits (v0.6.0-worthy);
`release.yml` only fires on CI success and CI is red. Audited 2026-07-01:*

- [ ] CI `build` job runs `npm run build-local` from the repo root, but the script lives in `packages/core/package.json` → fails with "Missing script"; point it at the workspace (`npm run build-local -w @vocion/core`) or add a root alias
- [ ] Unit-test env — provide `DATABASE_URL` + `AUTH_SECRET` in the CI test job (T3 env validation currently throws "Invalid environment variables"; vitest already stubs the LLM keys)
- [ ] Fix the 2 real `WorkflowService.test.ts` failures — assertion shape drift on action-step output (`input.text` / `input.body`)
- [ ] Delete stray `auth.js` at repo root (it contains a commit-message fragment, not code) — unblocks knip
- [ ] Crowdin — add `CROWDIN_PROJECT_ID` + `CROWDIN_PERSONAL_TOKEN` secrets or gate the job on secret presence
- [ ] Re-test `drizzle-kit generate` — the 0021/0022 "snapshot collision" folklore didn't reproduce in audit (snapshots chain cleanly); if it generates, retire hand-written migrations
- [ ] Confirm `release.yml` cuts `v0.6.0` on the next green main

**Exit:** every PR runs green CI; semantic-release cuts tags again; hand-written migrations retired.

### Phase 2 — Interface layer (finish)

Skills, context, and review queues reachable from wherever people already work. Delivers on the landing page's "run from web, Slack, Teams, CLI, your own app" promise. Inbound *and* outbound — a draft that needs review pings the right channel instead of waiting for someone to refresh the dashboard.

**Inbound channels**
- [x] MCP over HTTP transport — multi-tenant via Bearer token (`/api/mcp`, Streamable HTTP) *(v1.34)*; **OAuth sign-in flow still open**
- [ ] ChatGPT Actions + listed GPT — OAuth, OpenAPI autogenerated from oRPC
- [ ] Slack bot — slash commands, DMs, interactive approval messages
- [ ] Teams bot — Bot Framework adapter
- [ ] A2A protocol server (inbound) — external agents can hand off tasks to a Vocion agent

**Outbound notifications** (closes the review-queue loop — no one keeps a dashboard open)
- [ ] Notification dispatcher — `notify.yaml` per workflow declaring channel + condition + recipient
- [ ] Email (SMTP / SES / SendGrid) — review-needed digests, run-complete summaries, post-hoc feedback links
- [ ] Slack DM + channel post — interactive approve/reject buttons inline
- [ ] Teams adaptive cards — same as Slack pattern
- [ ] SMS via Twilio — high-urgency only (escalations, breaches)
- [ ] Webhook (generic) — push to customer's notification stack
- [ ] User notification preferences — per-user channel choice + quiet hours

**Exit:** a skill run started from any channel lands in the same review queue *and* pings the right reviewer on their preferred channel. External A2A agents can invoke a Vocion agent and poll for task completion.

### Phase 2.5 — Agent tool layer + skill contract (Agent → Skill → Tool)

> **Status: partially shipped (v1.24.0).** The built-in general toolbelt landed — `web_search`,
> `fetch_url`/`crawl_site`, `run_code` (safe calculator), plus `generate_image` + `create_artifact`,
> with a `/dashboard/tools` catalog. **Still open:** the `defineTool` SDK registry, the per-skill
> `tools:` allowlist + runtime enforcement (the only `tools:` field today is per-*subagent*, a
> deepagents construct — not the skill contract), `http_request`, `sql_query`, the outbound MCP
> client, and per-tool/per-egress budgets. Checkboxes below reflect this.

*Formalizes the canonical model the marketing site + public docs now describe, and closes the audit's #1 gap: agents have no general toolbelt.* Today an agent's reach is a fixed runtime tool set (`search_knowledge`, `lookup_objects`, `run_operation`, `request_human_review`, learnings/runs tools) plus the v1.24 built-in tools (`web_search`, browse, `run_code`, `generate_image`, `create_artifact`) and whatever a plugin skill calls via `ctx`. There is still no `defineTool` primitive, no per-skill declaration of *which* tools a skill may use, and no general HTTP/SQL capability — so the contract that makes tool access governed + traced per skill remains the open work.

The model: **agents are composed of skills; a skill bundles its logic + acceptance evals + the tools it may call; tools are atomic, traced, budgeted capabilities.** This phase makes that real in code.

**Skill contract**
- [ ] `tools:` allowlist in `skill.yaml` / the `Operation` manifest — a skill explicitly declares the tools it may call; runtime enforces the grant and records it in the trace
- [ ] An agent's effective toolset = the union of its skills' declared tools (no more global ambient tool set)
- [ ] Acceptance-first: surface a "skill has no `evals.yaml`" warning in the dashboard; treat acceptance evals as part of the contract, not optional decoration
- [ ] Migrate the existing runtime tools (`search_knowledge`, `lookup_objects`, `run_operation`, `request_human_review`, learnings/runs) onto the new registry so built-ins and custom tools are uniform

**Tool registry (SDK)**
- [ ] `defineTool({ name, inputSchema, outputSchema, run })` in `@vocion/sdk` — atomic, typed, traced, budget-accounted; like an operation but single-action and not eval-graded
- [ ] Loader + registry mirrors the plugin-skill path (per-tool error isolation, Langfuse span, budget charge)
- [ ] Tool calls appear in the run trace alongside inputs, workspace_sha, and cost

**Built-in general toolbelt** (the capabilities buyers assume exist)
- [x] `web_search` — provider-pluggable (Tavily default / Brave), result snippets + URLs *(v1.24.0)*
- [x] `fetch_url` + `crawl_site` — fetch + readability extraction reusing the `web` connector extractor; Firecrawl opt-in for JS-heavy pages *(v1.24.0)*
- [x] `run_code` — built-in **safe calculator** (allowlisted identifiers, no eval); E2B sandbox reserved as the opt-in path to full sandboxed JS/Python *(v1.24.0)*
- [x] `generate_image` + `create_artifact` — beyond the original list; image gen + CSV/SVG-chart/doc artifacts to the artifact store *(v1.24.0)*
- [ ] `http_request` — arbitrary REST call against a per-tenant **egress allowlist**
- [ ] `sql_query` — read-only query against a connected Postgres source
- [ ] Outbound **MCP client** — skills can call tools exposed by external MCP servers (mirror of our MCP server); MCP tools participate in the same `tools:` grant + trace

**Governance** (ties to existing `BudgetService` + the enterprise egress story in Phase 13)
- [ ] Per-tool and per-egress-domain budgets + rate limits
- [ ] Write-actions are tools too: unify the workflow `action` step (today a `send-stub` that records intent but does nothing — `libs/cards/firstParty/sendStub.tsx`) with the tool registry, so a connector's write call (Stripe/Salesforce/email in [Phase 5](#phase-5--plugin-sdk-v1--connector-pack)) is just a governed tool a skill or action step invokes

**Exit:** a skill declares the tools it may call; an agent's reach is exactly the union of its skills' grants; new built-in tools (web search, fetch, HTTP, code, SQL) and external MCP tools are available, budgeted, and traced; and a workflow `action` step actually performs a side effect instead of emitting a stub.

### Phase 3 — Native retrieval

*Highest operational payoff.* Replace Onyx with a pgvector-native pipeline. Onyx's 12 containers are the single biggest friction in every install — and the "self-host anywhere" promise is hollow until they're gone. Also lights up workflow-scoped retrieval primitives so multi-step workflows stop re-retrieving overlapping evidence at every step.

> **Status: pipeline rewrite shipped.** Native retrieval is the live stack (`RetrievalService` —
> pgvector HNSW cosine + Postgres FTS + RRF fusion, k=60, optional LLM rerank; `IngestionService`
> chunks + embeds via OpenAI `text-embedding-3-small`). The Onyx engine is gone — only a vestigial
> `onyx_document_id` column name lingers as a v0.2 fossil pending rename. **Still open:** the
> pluggable `retrieval.yaml` backends (Vertex / Azure search), an Onyx→pgvector migration tool
> (moot — cutover was clean, no legacy index to migrate), and the entire workflow-scoped retrieval
> subsection below.

**Pipeline rewrite**
- [x] pgvector schema + HNSW index
- [x] Postgres FTS layer (`tsvector` + `ts_rank`, GIN)
- [x] RRF hybrid ranker (reciprocal rank fusion across vector + keyword arms)
- [x] Pluggable embedder + reranker interfaces + default implementations (`libs/retrieval/reranker.ts`)
- [ ] `retrieval.yaml` config: `backend: native | vertex-search | azure-search`
- [ ] Vertex + Azure backends as source plugins
- [ ] ~~Migration tool: existing Onyx index → pgvector~~ — moot; cutover was clean (no legacy index)
- [x] Deprecate Onyx containers (engine removed; only the `onyx_document_id` column name remains)

**Workflow-scoped retrieval** (avoid raw RAG at every step)
- [ ] Workflow-scoped retrieval cache — same `retrieve(query)` inside the same `workflow_run` returns cached chunks; cache key includes `workflow_run_id` + query + filters
- [ ] First-class `retrieve` step type — `kind: retrieve, query: '{{input.deal}}', limit: 20` produces `{{steps.fetch.output.chunks}}` for downstream skills to interpolate as evidence instead of re-retrieving
- [ ] Per-step `freshness: '5m'` opt-in — bypasses cache when stale (matters for long-running durable workflows, see [Phase 6](#phase-6--triggers--durable-runner))
- [ ] Retrieval audit — every `retrieve` call (cached or fresh) recorded against `workflow_run` for reproducibility

**Exit:** zero Onyx dependency in new deployments; feature parity on search quality; fresh-install quickstart actually runs in 10 minutes on a laptop. A 5-step workflow with overlapping evidence needs makes one retrieval pass, not five.

### Phase 4 — Self-improvement loop (finish)

*Capture side partially shipped (rating + note), improvement side open.* Closes the Iteration arc of the operating loop (Feedback → Audit → Evals → **Iteration** → Measurement). Measurement is its own phase later — see [Phase 9](#phase-9--measurement--economics). Improvement runs across all five resources (skill, agent, workflow, object type, evals), not just skill prompts.

**Capture every signal, not just thumbs**

The signal worth most is what humans actually *did* with the draft, not what they rated it.

- [ ] `skill_run.editedOutput` — when a reviewer approves with edits, capture both the LLM output and the edited version sent. The diff is the single highest-quality training signal we get.
- [ ] Existing rating (`up`/`down`) + free-text note — already shipped
- [ ] Post-hoc feedback link in outbound emails — recipient rates the result days later from a unique URL
- [ ] Conversational correction extractor — when a user follows up in chat with "no, the budget was 50k not 100k" or "rewrite shorter," parse the correction against the prior turn's skill output; record as implicit feedback
- [ ] Workflow-level feedback rollup — `workflow_run` aggregates feedback from every `skill_run` it composed, so improvements can target the workflow shape, not just individual skills
- [ ] Reviewer-attribution metadata — feedback carries who, when, on what workspace_sha, with which channel (web / Slack / chat / email)

**Improvement meta-skills** (same pattern across resources: read runs + feedback + evals → propose diff on a branch → human approves PR → merge re-applies context)

- [ ] `improve_skill` — reads last N runs + ratings + edit-diffs + chat corrections, proposes `prompt.md` diff
- [ ] `improve_agent` — proposes `system-prompt.md` changes when an agent's voice/scope drifts from feedback
- [ ] `improve_workflow` — proposes step reorder, missing approval gates, or removed steps when reviewers consistently bypass / reject the same step
- [ ] `improve_object_type` — proposes classification-prompt changes when objects get misclassified
- [ ] `improve_evals` — turns failed runs + edit-diffs into new `evals.yaml` fixtures so today's regression becomes tomorrow's CI gate

**Cross-resource feedback router**

- [ ] `classify_feedback` skill — for each thumb-down or edit, classifies whether the root cause sits in the skill prompt, the agent prompt, the workflow shape, the object classification, or missing evals; routes to the right `improve_*` meta-skill
- [ ] Per-resource improvement candidates queue — `/dashboard/review/improvements` shows pending PR-style proposals grouped by resource

**Eval + harness**

- [ ] Eval harness auto-walks `workspace/**/evals.yaml`, grades substring/regex/JSON-field/rubric assertions, fails PR on regression
- [ ] Fixture promotion — failed runs (with reviewer's edited output as expected) one-click promote into `evals.yaml`
- [ ] `skill_improvement_review` workflow — weekly scheduled run that surfaces candidates across all resources

**Exit:** a thumb-down with note (or an edit, or a chat correction) on any resource produces a classified, routed improvement PR within a week, with a generated eval fixture so the regression can't recur silently.

### Phase 5 — Plugin SDK v1 + connector pack

> **Status update (2026-07-01 audit):** the **1.0-blocking connector pack shipped in core** —
> HubSpot, Gmail, Slack, Drive, Google Ads, GA4 (v1.31–v1.36): real APIs, incremental sync with
> checkpoints, credentials from the encrypted vault. What remains of this phase is the *plugin
> packaging* story (connectors as npm plugins, SDK publish) and the broader pack below.

The plugin contract validated by shipping the connectors the landing page names. "Real business systems, not toy demos" requires the connectors actually exist.

**SDK v1**
- [ ] Publish `@vocion/sdk` + `@vocion/plugin-transcript-highlights` to npm (placeholder reserved today)
- [ ] Source contract — connectors as plugins
- [ ] Review UI components shipped via plugins (custom draft cards, approval widgets)
- [ ] Plugin hot-reload in dev; semver resolution in prod
- [ ] Eval harness runs plugin evals on CI for every PR

**First connector pack** (shipped as plugins, not core):
- [ ] Stripe (read-only — customers, subs, invoices)
- [ ] Zendesk (tickets, comments, bidirectional draft)
- [ ] Notion (pages, databases)
- [ ] Salesforce (accounts, opportunities, activities — read + write)
- [ ] Postgres generic (configurable schema, read-only)
- [ ] Custom REST source — `source.yaml` declaring base URL, auth, paginated endpoints, mapping to objects
- [ ] Inbound webhook source — tenant-registered endpoint + signature verification + payload→object mapping
- [ ] **Transcript connectors — Zoom, Loom, Granola** (meeting/video transcripts as retrievable docs; feeds Revenue Insights' objection/quote mining + Proposal Writer's discovery grounding — RevOps P3)
- [ ] Existing in-core connectors (HubSpot, Gmail, Slack, Drive, Google Ads, GA4 — shipped v1.31–v1.36) repackaged as plugins

**Exit:** an outside developer can publish a skill or source plugin to npm without a core PR; the 12 connectors named on the landing page either ship in core or have a published plugin.

### Phase 6 — Triggers + durable runner

> **Status update (2026-07-01 audit):** partially pulled forward. **Event triggering shipped** —
> `EventService.emitEvent` dedupes + fans out to workflows subscribed via `trigger: { type: event }`,
> with `POST /api/v1/events` as the webhook-shaped inbound (v1.40). **Temporal is live for source
> syncs** (`sourceSyncWorkflow`, v1.37) and `vocionWorkflow` + `approvalSignal` exist for durable
> step execution — but workflow dispatch still defaults in-process, and `SourceScheduleService`
> has **no callers** (schedule dispatch wiring is in the Activation sprint). The rest below is open.

Workflows today only run on manual + event invocation against a Postgres-backed sequential runner. This phase lights up every trigger source the landing page implies ("scheduled jobs, API triggers, your own app") and swaps the runner under the hood for a durable one without changing `workflow.yaml`.

**Trigger sources** (each as a source plugin where it makes sense)
- [~] Schedule (cron) — `workflow.yaml` `trigger: { kind: schedule, cron: '0 9 * * MON' }` — **partial:** Temporal schedule mechanism shipped for sources (v1.37); dispatch wiring for both sources + workflows is the Activation-sprint item
- [~] Webhook (inbound HTTP) — **partial:** `POST /api/v1/events` (Bearer-authed, dedupe-keyed) covers the generic case (v1.40); tenant-registered endpoints + signature verification still open
- [x] Event bus (in-app) — workflows publish + subscribe via `emitEvent`; chains run-to-run without external infra *(v1.40)*
- [ ] Queue subscriber — SQS, Pub/Sub, Kafka, Redis Streams; message → workflow input
- [ ] Postgres CDC — `LISTEN/NOTIFY` or `pg_logical` row-watch; insert/update fires a workflow
- [ ] SMS / voice — Twilio inbound message + call as trigger source
- [ ] Email inbound — SES / SendGrid inbound parse → workflow with the email as input object
- [ ] A2A inbound (already in Phase 2) wired to workflow trigger, not just skill run
- [ ] `agent_call` step type — workflows invoke external A2A agents (outbound; previously slated for Phase 7)

**Durable runner**
- [ ] Swap Postgres-sequential runner for a durable execution engine (Temporal-compatible interface; default backend Temporal OSS, pluggable to Inngest / Restate / DBOS)
- [ ] Existing `workflow.yaml` API unchanged — runner is an implementation detail
- [ ] Long-running step support — hours/days, survives process restart
- [ ] Retry policy per step (exponential backoff, max attempts, dead-letter)
- [ ] `workflow_run` records get a runner-side correlation id for cross-system tracing

**Exit:** a webhook from Stripe → Postgres CDC notification → workflow runs across an SQS queue subscriber and a scheduled re-check three days later, all observable as a single resumable workflow run; when the OS restarts mid-run, it picks up exactly where it left off.

### Phase 7 — Public API (write side)

> **Status update (2026-07-01 audit):** the 1.0-blocking slice shipped — Bearer tokens (v1.30),
> the reviews write API (list / assign / snooze / decide, v1.33 + v1.38), and `POST /api/v1/events`
> (v1.40), all through `authz`. Token *issuance* is still a manual path (UI in the Activation
> sprint). The full write surface below remains open.

*Read side shipped; write side shipped for reviews + events.* Delivers on "run from your own app" + "API triggers" promises.

- [x] Tenant-scoped Bearer tokens (`vcn_live_...`) — hashed at rest (SHA-256), per-token grants + last-used audit *(v1.30)*; **dashboard issuance UI still open (Activation sprint)**
- [ ] `POST` / `PATCH` on all resource CRUD — equivalent to workspace-as-code writes
- [ ] `POST /api/v1/objects/:slug/instances` — object ingest
- [ ] `POST /api/v1/skills/:slug/runs` + `/workflows/:slug/runs` — run triggers (same path the trigger sources call internally)
- [ ] SSE streaming for long workflows
- [ ] Outgoing webhooks — tenant-registered URL + filter + HMAC-signed delivery
- [ ] OpenAPI 3.1 spec auto-generated
- [ ] Generated client SDKs — JS/TS (already via `@vocion/sdk` interface) and **Python** (`vocion-py`) generated from the OpenAPI spec; covers the data-science / notebook embedding case

**Exit:** a backend engineer with zero Vocion knowledge can, in 30 min, issue a token, POST an object, trigger a workflow, poll for the result, and receive a webhook when a human approves.

### Phase 8 — Conversational bootstrap

User describes a workflow in natural language, Vocion builds it. Sits after Plugin SDK + retrieval + triggers + feedback so the meta-agent works on a clean, composable, self-correcting substrate.

- [ ] Meta-agent — privileged skill with write access to `workspace/<org>/`; takes NL intent, emits manifests, uses MCP write tools
- [ ] Self-service OAuth — users connect Gmail/HubSpot/DocuSign without admin config
- [ ] Onboarding stepper — connect → ingest → chat → build with live progress
- [ ] Sample workflow library — import from `use-cases/catalog.md` as starting templates
- [ ] Preview-on-real-data — "here's what this would've done on your last 5 calls; keep?"

**Exit:** a cold prospect goes from sign-up to running their first workflow in under 10 minutes.

### Phase 9 — Measurement + economics

Closes the operating loop the landing page promises ("track run volume, approval rate, latency, and cost so the workflow can be improved, not just admired"). The data already exists in `skill_run` + `workflow_run`; this phase surfaces it.

**Operations metrics**
- [ ] `/dashboard/metrics` — run volume, approval rate, latency p50/p95, error rate; broken down by skill / workflow / channel / tenant
- [ ] Per-skill quality trend — rolling rating average over time, regression alerts
- [ ] HITL throughput — review queue depth, time-to-approve, reviewer leaderboard
- [ ] Real-time alerting — webhooks fire on threshold breaches (latency spike, approval-rate drop, error surge)

**Economics**
- [ ] Token + dollar cost attribution — per skill × workflow × tenant × model × provider
- [ ] Unit economics per workflow — cost per run, cost per output, cost per approved output
- [ ] ROI calculator — workflow declares baseline ("manual takes 30 min @ $80/hr"); dashboard shows realized savings vs compute spend
- [~] Budget caps — **partial:** agent-level caps shipped (`BudgetService` + `agent_budget` table, per-period token/dollar, pre-flight hard-stop in `runAgentDeep`). Per-tenant / per-skill scope + soft-warn still open.
- [ ] Customer-facing economics report — monthly Markdown export: spend, savings, top workflows, anomalies

**Observability + tracing** (delivers on landing-page "trace spans" promise)

> **Status: partial.** Self-hosted **Langfuse** is integrated (`libs/Langfuse.ts`,
> `/dashboard/observability`) — every LLM call is traced with `feature` / `org` / `slug` / `userId`
> / `sessionId` tags. **Still open:** OTEL spans across the full run (not just LLM calls), the OTLP
> exporter to a customer's APM, the in-app per-`workflow_run` flame-graph viewer, and PII scrubbing
> on export.

- [ ] OpenTelemetry instrumentation — every skill run + workflow step + retrieval call + LLM call emits a span with `tenant_id`, `skill_slug`, `workspace_sha`, `cost_usd`, `tokens_in/out`
- [ ] OTLP exporter — push spans + metrics to customer's APM (Datadog / Honeycomb / Jaeger / Grafana Tempo / Splunk)
- [ ] Per-tenant trace sampling config — head/tail-based sampling rules in `observability.yaml`
- [ ] In-app trace viewer — flame graph for any `workflow_run` showing nested skill + retrieval + LLM spans, links out to the customer's APM if configured
- [ ] PII scrubbing on span export — content-bearing attributes redacted before export, configurable per object type

**Exit:** any workflow has a one-click view of run volume, quality trend, cost per run, and ROI; spans flow into the customer's APM with tenant + context tags so engineers debug failures in the tools they already use.

### Phase 10 — OSS launch
*Open-source under Apache 2.0.*

- [ ] Public repo + Apache 2.0 license
- [x] Tenant extraction path documented ([`docs/guides/extract-tenant.md`](../guides/extract-tenant.md))
- [ ] Split `workspace/metacto/` → `metacto-vocion` repo via `git subtree split`
- [ ] Strip billing + auth-provider lock-in from core (Stripe code moves to the proprietary Cloud module — see Phase 11)
- [ ] 3 external reference installs running OSS in production
- [ ] Launch blog + conference talk

**Exit:** OSS stars trending; first non-MetaCTO contributor PR merged; the OSS repo is fully self-hostable with zero MetaCTO-proprietary dependencies.

---

## Repo split (OSS vs proprietary)

The remaining phases interleave OSS and proprietary work. The split:

| Concern | Where it lives |
|---|---|
| Multi-tenant orchestration, oRPC, plugins, retrieval, UI | `vocion` (OSS, Apache 2.0) |
| Hosting infra, billing, seat management, customer console | `vocion-cloud` (private) |
| SSO/SAML, SCIM, doc-level RBAC, BYOM, BYOK, audit export, compliance posture | `vocion-cloud/enterprise` (private, paid tier) |
| Plugin marketplace, signing, leaderboards | `vocion` (OSS) |

**Default OSS install never includes billing, seat management, or enterprise auth/governance** — those are commercial-only. Core stays a free, self-hostable substrate. Cloud + Enterprise are how MetaCTO monetizes without forking the OSS.

---

### Phase 11 — Vocion Cloud *(proprietary)*

*Ships alongside OSS launch.* Hosted offering. Extracts hosting and billing from core into a private module so the OSS install stays clean.

**Hosting + ops**
- [ ] Stand up `vocion-cloud` private repo (git subtree split from current `packages/core` Stripe + tenant-billing code)
- [ ] Multi-region hosted Postgres + pgvector (initial: us-east + eu-west)
- [ ] Per-tenant container isolation (Fly Machines or Cloud Run, one app per workspace)
- [ ] Managed evals — scheduled eval harness runs across all tenant skills, surfaced in customer console
- [ ] Backup + point-in-time-restore for tenant DBs
- [ ] Status page + SLA reporting
- [ ] Operator console — per-tenant resource usage, debug tools, support impersonation with audit trail

**Account model + billing** (extracted from OSS)
- [ ] Account / workspace / seat hierarchy (auth.js stays in OSS for auth — the optional `VOCION_AUTH_PROVIDER=clerk` path serves Cloud; seat-based billing logic moves out)
- [ ] Stripe subscription module — per-seat pricing, usage-based metering for skill runs / tokens / storage
- [ ] Customer-facing billing console — invoices, payment method, plan upgrade, seat add/remove
- [ ] Usage metering pipeline — `skill_run` + `workflow_run` token counts → Stripe metered billing
- [ ] Plan gates — feature flags driven by `tenant.plan` (free / team / business / enterprise)
- [ ] Trial + dunning + grace-period logic
- [ ] Tax (Stripe Tax) + invoicing for non-card customers

**Onboarding**
- [ ] Self-service signup → workspace provisioning in <60s
- [ ] Sample-data starter workflows on first login
- [ ] Connector OAuth flows wired to managed credential vault

**Exit:** first paid Cloud customer self-serves through signup → connector → first skill run → invoiced — without MetaCTO touching the workspace.

### Phase 12 — Ecosystem

Plugin marketplace + community incentives. Sits after Cloud because the marketplace needs both an OSS user base *and* paying customers to drive plugin demand.

- [ ] Plugin marketplace — listings, signing, permission scopes
- [ ] Plugin signing + attestation — npm-published plugins carry a verifiable manifest
- [ ] Community plugin incentives — bounties for top-N connectors
- [ ] Plugin compatibility matrix in dashboard (versions tested against current core)
- [ ] Public eval leaderboard for skills (opt-in, anonymized)

**Exit:** an outside developer ships a connector plugin to the marketplace and a separate org installs it without MetaCTO involvement.

### Phase 13 — Enterprise *(proprietary)*

*Paid tier on top of Cloud (or self-hosted with commercial license).* Identity, access control, BYOM, BYOK, compliance. Sold as an add-on to Cloud or as a self-hosted enterprise license.

**Identity**
- [ ] SSO/SAML 2.0 (Okta, Azure AD, Google Workspace, OneLogin, Ping)
- [ ] OIDC for modern IdPs
- [ ] SCIM 2.0 user + group provisioning + deprovisioning
- [ ] Just-in-time user provisioning on first SSO login
- [ ] Session policies — max session length, IP-bound sessions, MFA enforcement

**Access control**
- [ ] Document-level RBAC at the retrieval layer — `source.acl` filters chunks by user/group at query time
- [ ] Document-level RBAC at the agent layer — agents respect the calling user's permissions when invoking sources
- [ ] Role-based skill access — `skill.yaml` allowed-roles allowlist
- [ ] Multi-step approval chains — `workflow.yaml` `approval: [eng_manager, director, vp]` tied to org hierarchy
- [ ] Per-role observability scopes — log/audit visibility filtered by role
- [ ] Custom roles + permissions matrix in admin UI

**BYOM (bring your own model)**
- [ ] Amazon Bedrock provider — Claude, Llama, Titan via tenant's AWS account
- [ ] Vertex AI private endpoints — Gemini in tenant's GCP project, no data leaves
- [ ] Azure OpenAI private endpoints — GPT-4 in tenant's Azure subscription
- [ ] Self-hosted endpoints — vLLM, TGI, Ollama; OpenAI-compatible interface
- [ ] Per-skill model override — `skill.yaml` `provider: bedrock-claude-sonnet`
- [ ] Routing policies — fallback chains (primary → fallback on rate-limit / error)
- [ ] Per-tenant model allowlist — admin restricts which models any skill can use

**BYOK / data residency**
- [ ] Customer-managed encryption keys (CMEK) via AWS KMS / GCP KMS / Azure Key Vault
- [ ] Per-region tenant pinning (us-east, eu-west, ap-southeast, ca-central)
- [ ] VPC peering / AWS PrivateLink for Cloud customers
- [ ] Air-gapped install profile — fully offline, no telemetry, no model API calls (forces self-hosted LLM)

**Compliance**
- [ ] SOC 2 Type II audit (Cloud)
- [ ] HIPAA BAA available (Cloud + self-hosted enterprise)
- [ ] Audit log export to SIEM (Splunk, Datadog, Elastic) — streaming or scheduled
- [ ] Configurable retention policies per object type (e.g., delete `skill_run` payloads after 30 days)
- [ ] PII detection + redaction filters on ingest (Microsoft Presidio or AWS Comprehend)
- [ ] DLP integration — block egress of classified content through skill outputs

**Network + governance**
- [ ] IP allow-list per Bearer token
- [ ] Webhook outbound IP pinning (whitelist Vocion's egress IPs for customer firewall rules)
- [ ] Per-tenant rate limits + quotas
- [ ] Customer-defined egress allowlist — restrict which connectors a tenant can install

**Exit:** first enterprise customer signed with SSO + SCIM + BYOM + audit-export wired into their existing security stack; passes their security review without core platform changes.

---

## Missions — open-ended team work (feature track)

*Orthogonal to the linear platform phases above.* Missions add the **third work mode** on the one
Agent framework: **Structured** (Workflow) · **Mission** (open-ended) · **Team** (multi-agent).
A mission is a goal-driven assignment a team plans and works under human review —
**Hire → Brief → Work → Review → Coach → Learn → Promote** — and what proves repeatable gets
*promoted* into a Workflow. This is the runtime FirstHQ's "AI team room" is built on. Concept docs:
public `docs/features/missions.md` (vocion-www); buyer narrative in `firsthq/docs/product-plan.md`.

- [x] **Phase 1 — MVP (v1.25.0).** Schema (`mission` + `mission_run`, migration `0024`),
  `MissionService` + planner/runtime/autonomy, oRPC `missions.*`, MCP `mission_*`, workspace authoring
  + 2 seed templates, the **Mission Room** dashboard, the autonomy ladder gating external actions,
  and a promote-to-workflow stub. Reuses subagents (team), `write_todos` (task graph),
  `request_human_review` (gates), learnings (coaching), budgets, the `workspace_sha` stamp.
- [ ] **Phase 2 — Durable agent sessions.** Promote mission execution onto Temporal
  (`vocionWorkflow` + `approvalSignal`) for crash-safe, multi-day pause/resume; `agent_session` state
  + checkpoints. *(Depends on [Phase 6 — durable runner](#phase-6--triggers--durable-runner).)*
- [ ] **Phase 3 — Capability registry.** `capability` as a first-class object —
  tools + playbooks + evals + approval + examples, **plus `criticalRules` (guardrails),
  `successMetrics` (targets), and `deliverableTemplates`** — + per-agent capability lists.
  *(Ties to [Phase 2.5](#phase-25--agent-tool-layer--skill-contract-agent--skill--tool)'s `defineTool` + `tools:` contract. Schema shape validated against real public agency-agent rosters — see note below.)*
- [ ] **Phase 4 — Capability proposals.** Agent-proposed upgrades (new access / capability / learning)
  → owner approval queue. *(Ties to [Phase 4](#phase-4--self-improvement-loop-finish)'s improvement router.)*
- [ ] **Phase 5 — Team runtime depth.** Agent-to-agent messaging, debate/synthesis, direct
  human→teammate steering mid-run, **and a declared agent collaboration graph
  (handoff-from / collaborates-with / delivers-to / escalates-to) with runtime handoff + escalation
  routing.** *(Newly motivated: public agency-agent rosters declare exactly these edges per role.)*
- [ ] **Phase 6 — Promotion engine.** Detect repeatable missions → auto-draft a reusable Workflow +
  schedule (full version of the v1.25 stub). *(Ties to [Phase 6 — triggers](#phase-6--triggers--durable-runner) for the schedule.)*

**Exit (track complete):** a mission briefed in plain language runs as a durable, crash-safe team
session; teammates carry governed capabilities they can propose to extend; repeatable missions
auto-promote into scheduled Workflows.

> **Capability sourcing note.** Public agency-agent rosters (e.g. the MIT-licensed `agency-agents`
> project, ~35 marketing specialists) are a strong real-world reference for the Capability schema
> above — each carries a one-line "vibe," core capabilities, **critical rules**, a **collaboration
> graph**, **success metrics**, and **deliverable templates**. We borrow the *shape* (validated here),
> author our own content to our quality + voice bar, and ship no copied text. They also surfaced a
> capability area worth building: **AI Visibility (AEO/GEO)** — see Phase 2.5.

### AI Visibility toolset (AEO / GEO) — new, lands in Phase 2.5 / Phase 3

Being found, read, and **recommended by AI engines** (ChatGPT/Claude/Gemini/Perplexity), not just
ranked by Google. Built on the v1.24 web tools; powers FirstHQ's commercial "AI Visibility" team.
- [ ] **Multi-engine query/audit tool** — run prompts across AI engines, capture citations +
  share-of-voice. Non-deterministic + point-in-time; never "guarantee," always benchmark before/after.
- [ ] **AEO-foundations checks** — `llms.txt` / AI-aware `robots.txt` / discovery-file (`AGENTS.md`,
  agent-permissions) audit; token-budget + structured-content checks.
- [ ] **Schema / entity output** — structured-data + entity-clarity generation as a deliverable template.

---

## FirstHQ as forcing function — platform upgrades (M2/M3-driven)

FirstHQ's M2 (connect & teach) and M3 (work & approvals) demand platform maturity we should build
**in core**, not in the product. Full architecture: `firsthq/docs/platform-plan.md`. These are
concrete additions to existing phases — sequenced so the highest-trust, lowest-effort item ships first.

**1. Scoped retrieval + document ACL** *(Phase 3 ext. + Phase 13 slice — do first).* Today retrieval
is **org-only** (`RetrievalService.search` filters `org_id`; no client/team scope, no doc ACL).
- [ ] Add scope refs (`clientId`/`teamId`/`audience`) to `knowledge_document`/`knowledge_chunk`.
- [ ] `RetrievalService.search` gains scope filters + **principal-aware ACL enforcement** (retrieval
  becomes the discovery-permission boundary). Cross-client isolation tests are mandatory.

**2. Discovery-vs-mutation permission model + one review service** *(Phase 2.5 + Missions P3 + 13 slice
— the keystone).* Today there's a *de facto* split (reads org-scoped; mutations gated by the mission
autonomy ladder, `taskNeedsApproval`) but it's **not formalized**, and the MCP autonomy gate and the
UI review queue **don't share state**.
- [ ] Formal model: **principal** (user|agent) × **scope** (workspace|client|team) × **resource** ×
  **mode** (`discover`|`mutate`) × **gate** (`none`|`approve@autonomy`). Discovery = read scopes+ACL (#1);
  mutation = the per-skill `tools:` grant + autonomy + approval, now principal/scope-aware.
- [ ] **One review/approval service** both planes write to (close the MCP↔UI split). Roles = grant bundles.

**3. Durable ingestion pipelines** *(Phase 6 + Phase 5).* Today `SourceSyncService.runSync()` is
**synchronous, in-process**, full-sync, no resume/incremental/schedule/dead-letter; Temporal is live
but unused for ingestion; `IngestDoc` etag/mtime scaffolding is unwired.
- [ ] `sourceSyncWorkflow` + activities on Temporal; `source_sync_checkpoint` table (resumable cursors).
- [ ] `since?`/cursor on `SourceContext` (honor etag/mtime → incremental); **Temporal Schedules** for
  re-sync; `source_sync_error` dead-letter w/ backoff; webhook-triggered delta for OAuth sources.
- [ ] Connector pack + OAuth/credential vault (Phase 5).

**4. Two planes, one auth** *(Phase 7 + Phase 2).* Today MCP (stdio) is the read+write agent tool
plane; `/api/v1/*` is read-only; oRPC is the app control plane.
- [ ] **API control plane**: write API + tenant **Bearer tokens** + outgoing webhooks (Phase 7) — the
  app↔runtime surface FirstHQ drives.
- [ ] **MCP HTTP + OAuth** transport (Phase 2) — agent/tool plane + external agents.
- [ ] **Both call the shared authorization + review layer (#2)** so a mutation gates identically and
  lands in one queue regardless of plane.

**5. Unified context** *(workspace + Phase 3).* Make authored workspace + ingested knowledge one
**scoped, versioned, provenance-tracked** context model (today they're separate stores; ingested docs
have no scope/provenance/version citizenship). Extends the `workspace_sha` audit to ingested context.

## First-12 workflows as forcing functions

Pulled from [`use-cases/catalog.md`](./use-cases/catalog.md) — selected for breadth across industry, department, and platform capability. Each one, when realized, becomes a public marketing case study on `/use-cases`.

1. Sales proposal decks from call transcripts (L4 · review + logs)
2. Support reply drafting with exception review (L4 · conditional routing)
3. Weekly business reporting with signoff (L4 · scheduled + approval)
4. Feature request → PRD draft (L3 · structured output)
5. Client intake → SOW draft (L5 · plugin orchestration)
6. RFP response workflow (L5 · owner routing)
7. Incident summary → customer update workflow (L5 · multi-output)
8. Candidate interview summary workflow (L2)
9. Executive reporting packet (L4 · cross-channel approval)
10. Procurement decision pack (L5 · logs + multi-input)
11. Underwriting recommendation workflow (L5 · external API + exception queue)
12. Prior authorization packet drafting (L4 · evidence-gated approval)
