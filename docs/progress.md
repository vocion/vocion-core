# Progress Log

Running log of what's shipped, in flight, and queued. Source of truth for "where are we." Keep current as work lands.

**Last updated:** 2026-04-14

Split by scope:

- [**Platform**](#platform) — CoreContext runtime (generic, shipped as the open-core product)
- [**Case studies**](#case-studies) — MetaCTO's own deployments (Ziggy, NINJIO); lives alongside but tracked separately. Specs in [`requirements/metacto/`](../requirements/metacto/README.md).

---

# Platform

## Shipped

### Phase 1 — Context-as-Code ✓

Commit: `8380861`

- `context/<org>/` scaffold — YAML + markdown, walked by loader
- `applyContext` reconcile (idempotent upserts for agents, skills, object types, workflows)
- `context_version` audit table + `skill_run.context_sha` stamping
- `npm run context:apply` / `check` / `export` CLI scripts
- 11 legacy seed/update scripts retired — content preserved as YAML+MD
- `context/README.md` authoring guide

### Phase 2 — Universal Interface Layer (partial)

Commit: `c4126d9` (MCP) + `b908a31` (review queue UI)

- [x] **MCP server (stdio)** — 15+ tools across `context_*`, `runtime_*`, `objects_*`, `search_*`, `plugins_*`, `workflow_*`. Install via `claude mcp add corecontext`.
- [x] **Auto-apply + versioning** — every `write_*` tool validates → writes → git commits (`chore(context):`) → applies → records `context_version` in one atomic call
- [x] **Review queue UI** at `/dashboard/review` — pending skill_runs + paused workflow_runs, approve/reject/resume/cancel buttons, inline detail view
- [ ] **MCP HTTP + OAuth transport** — needed for cloud/multi-tenant
- [ ] **ChatGPT Actions + listed GPT**
- [ ] **Slack bot**
- [ ] **Teams bot** / Microsoft Graph source plugin

### Phase 3 — Plugin SDK v0.1 ✓

Commit: `5ab00e0`

- [x] Typed `Skill<Input, Output>` contract + `defineSkill()` ergonomic constructor
- [x] `PluginContext` — narrow runtime (orgId, openai, contextSha, log, retrieve)
- [x] Registry + loader — env-driven discovery via `CORECONTEXT_PLUGINS`, error isolation
- [x] Dual-path execution — plugins override prompt-only skills on slug collision
- [x] MCP tools: `plugins_list`, `plugins_reload`
- [x] Sample plugin: `transcript_highlights`
- [x] Docs: `docs/plugins.md`

Pending for v0.2:

- [ ] Extract to `@corecontext/sdk` npm package
- [ ] Source contract (connectors)
- [ ] Pluggable LLM provider (`openai | anthropic | vertex | azure-openai`)
- [ ] Review UI components shipped via plugins
- [ ] Eval harness wired to CI

### Workflow primitive (pulled forward from Phase 7)

Commit: `6fea02e`

- [x] Schema: `workflow` + `workflow_run` tables
- [x] Context-as-code: `context/<org>/workflows/<slug>/workflow.yaml`
- [x] Runner: sequential execution, `{{input.x}}` / `{{steps.name.output.y}}` interpolation
- [x] Step types: `skill`, `approve` (HITL), `action` (v1 stub)
- [x] Trigger types: `manual`, `event` (schema only; event bus is Phase 7 work)
- [x] MCP tools: 7 (list, get, run_start/list/get/resume/cancel)
- [x] Docs: `docs/workflows.md`

## In flight

_nothing — ready to start next_

## Queued

- **Pluggable LLM provider on plugin skills** (small, high-leverage)
- **Feedback + Self-Improvement Loop (new Phase 4)** — `skill_run.feedback` + `improve_skill` meta-skill proposing PR-style prompt diffs. Platform-wide. Unblocks every skill + agent.
- **MCP HTTP + OAuth transport**
- **ChatGPT Actions + GPT**
- **Slack bot** (+ multi-workspace OAuth)
- **Teams / Microsoft Graph source plugin** (Teams chats + calendar + mail + recordings)

## Test + infra status

- **51 tests** passing (12 test files): writer (6), auto-commit (5), MCP server (4), plugin loader (5), plugin executor (4), WorkflowService (9), existing services (18)
- Pre-commit hooks: lint + check-types + knip all green
- `next build --turbopack` passes
- Docker Postgres 16 on `:5432`; PGLite mock for unit tests
- Dogfood MCP loop verified end-to-end against prod DB (see `src/scripts/dogfood-mcp.ts`)

## Commits this session

```
b908a31 feat: review queue ui at /dashboard/review
6fea02e feat: workflow primitive — triggered skill+approve+action sequences
5ab00e0 feat: plugin sdk v0.1 — typed skill contract + dual-path execution
c4126d9 feat: mcp server + auto-apply for phase 2 interface layer
8380861 feat: phase 1 — context-as-code, apply CLI, context_sha audit trail
6a6f5c9 docs: product strategy and roadmap — open-core, plugin-first, MIT retrieval
```

6 commits ahead of `origin/main` — not pushed.

---

# Case studies

## MetaCTO — Ziggy (Sales Ops)

- **Status:** active, running against real data
- **Spec:** [`requirements/metacto/ziggy-*.md`](../requirements/metacto/README.md)
- **Live context:** `context/metacto/` — 1 agent, 13 skills, 4 object types, 1 workflow
- **Shipped:**
  - Ziggy agent (v6 system prompt with business-object markup)
  - 5 active skills: `discovery_summary`, `draft_followup_email`, `draft_mvp_proposal`, `find_related_conversations`, `search_everything`
  - 8 disabled stubs ready for prompts: `summarize_deal`, `draft_proposal_brief`, `inbox_triage`, `aging_pipeline`, `draft_lead_response`, `capability_asset_selection`, `account_timeline`, `objection_analysis`
  - Object types: `discovery_call`, `deal`, `account`, `kickoff_call` (with classification prompts + source-relevance weights)
  - `discovery_followup` workflow: summary → draft → HITL approve → stub send
- **Next:**
  - Website + Clutch case-study connectors → refactor `draft_followup_email` to retrieve case studies dynamically instead of the hardcoded library
  - Activate more disabled skills as evidence accumulates

## MetaCTO — Algren (NINJIO Customer Account Agent)

- **Status:** spec only — no code
- **Spec:** [`requirements/metacto/ninjio-account-manager.md`](../requirements/metacto/ninjio-account-manager.md)
- **Name:** Nathan Algren — *The Last Samurai*. The outsider captain who crosses into another world and learns it from the inside. Fitting for an agent embedded in a customer relationship.
- **Architecture:** each customer account gets its own named agent (NINJIO → Algren). Skills + workflows shared across accounts by slug reference. Per-account data in `business_object` row (`type=account`), new `context/metacto/accounts/<slug>.yaml` primitive.
- **Prereqs to build:**
  - Microsoft Graph source plugin (Teams chats + calendar + email + recordings)
  - Multi-workspace Slack support
  - Plugin SDK v0.2 (for `meeting_prep_pack` complexity)
  - New context primitive: object instances (`accounts/*.yaml` → seeded `business_object` rows on apply)
- **Workflows planned:** `account_meeting_prep`, `account_daily_triage`, `account_weekly_summary`

---

# Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-04-14 | Separate `context/<client>/` repo deferred to Phase 8 | Premature; in-tree keeps dogfood tight |
| 2026-04-14 | Pulled Workflow primitive from Phase 7 to now | WOW demo needs workflows to exist first, and planned Ziggy workflows should be real |
| 2026-04-14 | Vertex/Foundry = pluggable backends, not foundation | Open-source + portability + local dev trumps managed fanciness |
| 2026-04-14 | Auto-apply uses `chore(context): <summary>` commits | Conforms to conventional-commits / commitlint |
| 2026-04-14 | `account-manager` is a template, NINJIO is a `business_object` row | Scales to N customers without N agent prompts; per-account config lives in `business_object.metadata` |
| 2026-04-14 | Self-improvement feedback loop = core platform concern, new Phase 4 | Every skill/workflow benefits, not just NINJIO prep pack. PR-style proposed prompt diffs, never autonomous updates |
| 2026-04-14 | MCP LLM providers pluggable (openai/anthropic/vertex/azure-openai) | Low-effort enterprise unlock without ceding the agent layer |
| 2026-04-14 | Split `requirements/` into platform/ (top) + `metacto/` (case studies) | Platform stays portable; case studies can extract to a separate repo at Phase 8 OSS launch |
