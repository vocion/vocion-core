# Roadmap

**Internal — MetaCTO team only.** Single source of truth for phased delivery. Not shown in the public docs. Live status lives in [`changelog.md`](./changelog.md); forcing-function workflow list in [`use-cases/catalog.md`](./use-cases/catalog.md).

Phased to preserve MetaCTO revenue at every step; nothing ships that breaks live client work.

---

## Contents

1. [Snapshot — what's already shipped](#snapshot--whats-already-shipped)
2. [Phase 2 — Interface layer (finish)](#phase-2--interface-layer-finish)
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
14. [First-12 workflows as forcing functions](#first-12-workflows-as-forcing-functions)

---

## Snapshot — what's already shipped

Everything here is live on `main`.

### Foundation
- [x] Workspace-as-code loop — `workspace/<org>/` (YAML + markdown), idempotent apply, `workspace_version` audit, `skill_run.workspace_sha` stamping
- [x] Reference tenant (MetaCTO / Ziggy) runs entirely from git-backed context
- [x] `WORKSPACE_PATH` makes tenant extraction trivial; extraction playbook documented

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

### UX + framing (cross-cutting)
- [x] Rebrand Vocion → Vocion (repo, npm scope, docs, marketing, domain)
- [x] Layered repo architecture — `@vocion/core` + sdk + plugins + starter + tenant
- [x] Five-resource authoring vocabulary (Source, Object, Skill, Workflow, Agent); "primitives" is internal code-only. **Tools** are the sixth, lower-level primitive that skills call — the canonical model is **Agent → Skill → Tool** (a skill is an agent's *role*: logic + acceptance evals + tool access; it is not itself a tool). The marketing site + public docs were refactored to this model; formalizing it in code is [Phase 2.5](#phase-25--agent-tool-layer--skill-contract-agent--skill--tool).
- [x] Dashboard canonical shape — TitleBar + stats + instance grid + Activity strip + PrimitiveFiles editor
- [x] Sidebar consolidation — Workspace (Chat/Search/Reviews/Logs), Context (the five resources), admin in the user menu
- [x] Docs IA — Get started / Concepts / Guides / API / Reference; public vs internal split
- [x] Use-case catalog — 50 workflows across 5 complexity levels, 12 featured, filterable on `/use-cases`

---

## What's next — ordered by dependency

Targets are soft; order is the commitment. Each phase title flags `(OSS)` for open-source work or `(proprietary)` for `vocion-cloud` work. The repo split is summarized [below](#repo-split-oss-vs-proprietary).

### Phase 2 — Interface layer (finish)

Skills, context, and review queues reachable from wherever people already work. Delivers on the landing page's "run from web, Slack, Teams, CLI, your own app" promise. Inbound *and* outbound — a draft that needs review pings the right channel instead of waiting for someone to refresh the dashboard.

**Inbound channels**
- [ ] MCP HTTP + OAuth transport — needed for cloud + multi-tenant MCP
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

*Formalizes the canonical model the marketing site + public docs now describe, and closes the audit's #1 gap: agents have no general toolbelt.* Today an agent's reach is a fixed runtime tool set (`search_knowledge`, `lookup_objects`, `run_operation`, `request_human_review`, learnings/runs tools) plus whatever a plugin skill calls via `ctx`. There is no `defineTool` primitive, no per-skill declaration of *which* tools a skill may use, and no general web/HTTP/code capability — so "agents that operate your business" overpromises against a knowledge-retrieval-plus-operations runtime.

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
- [ ] `web_search` — provider-pluggable (Brave / Tavily / Bing), result snippets + URLs
- [ ] `fetch_url` — single-page fetch + readability extraction (distinct from the ingestion crawler in `libs/sources/web.ts`)
- [ ] `http_request` — arbitrary REST call against a per-tenant **egress allowlist**
- [ ] `run_code` — sandboxed JS/Python for computation and transforms (no network by default)
- [ ] `sql_query` — read-only query against a connected Postgres source
- [ ] Outbound **MCP client** — skills can call tools exposed by external MCP servers (mirror of our MCP server); MCP tools participate in the same `tools:` grant + trace

**Governance** (ties to existing `BudgetService` + the enterprise egress story in Phase 13)
- [ ] Per-tool and per-egress-domain budgets + rate limits
- [ ] Write-actions are tools too: unify the workflow `action` step (today a `send-stub` that records intent but does nothing — `libs/cards/firstParty/sendStub.tsx`) with the tool registry, so a connector's write call (Stripe/Salesforce/email in [Phase 5](#phase-5--plugin-sdk-v1--connector-pack)) is just a governed tool a skill or action step invokes

**Exit:** a skill declares the tools it may call; an agent's reach is exactly the union of its skills' grants; new built-in tools (web search, fetch, HTTP, code, SQL) and external MCP tools are available, budgeted, and traced; and a workflow `action` step actually performs a side effect instead of emitting a stub.

### Phase 3 — Native retrieval

*Highest operational payoff.* Replace Onyx with a pgvector-native pipeline. Onyx's 12 containers are the single biggest friction in every install — and the "self-host anywhere" promise is hollow until they're gone. Also lights up workflow-scoped retrieval primitives so multi-step workflows stop re-retrieving overlapping evidence at every step.

**Pipeline rewrite**
- [ ] pgvector schema + HNSW index
- [ ] Postgres FTS layer
- [ ] RRF hybrid ranker
- [ ] Pluggable embedder + reranker interfaces + default implementations
- [ ] `retrieval.yaml` config: `backend: native | vertex-search | azure-search`
- [ ] Vertex + Azure backends as source plugins
- [ ] Migration tool: existing Onyx index → pgvector
- [ ] Deprecate Onyx containers

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
- [ ] Existing connectors (HubSpot, Gmail, Zoom, Google Drive) repackaged as plugins

**Exit:** an outside developer can publish a skill or source plugin to npm without a core PR; the 12 connectors named on the landing page either ship in core or have a published plugin.

### Phase 6 — Triggers + durable runner

Workflows today only run on manual + naive event invocation against a Postgres-backed sequential runner. This phase lights up every trigger source the landing page implies ("scheduled jobs, API triggers, your own app") and swaps the runner under the hood for a durable one without changing `workflow.yaml`.

**Trigger sources** (each as a source plugin where it makes sense)
- [ ] Schedule (cron) — `workflow.yaml` `trigger: { kind: schedule, cron: '0 9 * * MON' }`
- [ ] Webhook (inbound HTTP) — tenant-registered endpoint + signature verification + payload→object mapping
- [ ] Event bus (in-app) — workflows publish + subscribe; chains run-to-run without external infra
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

*Read side shipped.* Delivers on "run from your own app" + "API triggers" promises.

- [ ] Tenant-scoped Bearer tokens (`vcn_live_...`) — dashboard-issued, hashed at rest, per-token audit
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
- [ ] Budget caps — per-tenant or per-skill token / dollar budgets with soft-warn + hard-stop
- [ ] Customer-facing economics report — monthly Markdown export: spend, savings, top workflows, anomalies

**Observability + tracing** (delivers on landing-page "trace spans" promise)
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
