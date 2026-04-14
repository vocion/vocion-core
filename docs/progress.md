# Progress Log

Running log of what's shipped, what's in flight, and what's next. Source of truth for "where are we" — keep this current as work lands.

**Last updated:** 2026-04-14

## Shipped

### Phase 1 — Context-as-Code ✓

Commit: `8380861`

- `context/<org>/` scaffold — YAML + markdown, walked by loader
- `applyContext` reconcile (idempotent upserts for agents, skills, object types)
- `context_version` audit table + `skill_run.context_sha` stamping
- `npm run context:apply` / `check` / `export` CLI scripts
- MetaCTO Ziggy context extracted (1 agent, 13 skills, 4 object types)
- 11 legacy seed/update scripts retired — content preserved as YAML+MD
- `context/README.md` authoring guide

### Phase 2 — Universal Interface Layer (partial) ✓

Commit: `c4126d9`

- [x] **MCP server (stdio)** — 15 tools across `context_*`, `runtime_*`, `objects_*`, `search_*`. Install via `claude mcp add corecontext`.
- [x] **Auto-apply + versioning** — every `write_*` tool validates → writes → git commits (`chore(context):`) → applies → records `context_version` in one atomic call
- [x] **Approve/reject surface** — `runtime_approve_draft` / `runtime_reject_draft`
- [ ] **ChatGPT Actions + listed GPT** — not started
- [ ] **Slack bot** — not started
- [ ] **Teams bot** — not started
- [ ] **HTTP + OAuth MCP transport** — not started (needed for cloud/multi-tenant)

### Phase 3 — Plugin SDK v0.1 ✓

Commit: `5ab00e0`

- [x] Typed `Skill<Input, Output>` contract + `defineSkill()` ergonomic constructor
- [x] `PluginContext` — narrow runtime interface (orgId, openai, contextSha, log, retrieve)
- [x] Registry + loader — env-driven discovery via `CORECONTEXT_PLUGINS`, error isolation
- [x] Dual-path execution — plugins override prompt-only skills on slug collision
- [x] MCP tools: `plugins_list`, `plugins_reload`
- [x] Sample plugin: `transcript_highlights` (chunking, multi-call, structured output)
- [x] Docs: `docs/plugins.md`
- [ ] Extract to `@corecontext/sdk` npm package (v0.2)
- [ ] Source contract for connectors (v0.2)
- [ ] Review UI components shipped via plugins (v0.2)
- [ ] Eval harness wired to CI (v0.2)
- [ ] Pluggable LLM provider (`openai | anthropic | vertex | azure-openai`) (v0.2, queued)

### Workflow primitive (pulled forward from Phase 6) ✓

Commit: `6fea02e`

- [x] Schema: `workflow` + `workflow_run` tables
- [x] Context-as-code: `context/<org>/workflows/<slug>/workflow.yaml`
- [x] Runner: sequential execution, `{{input.x}}` / `{{steps.name.output.y}}` / `{{trigger.y}}` interpolation
- [x] Step types: `skill`, `approve` (HITL pause), `action` (v1 stub)
- [x] Trigger types: `manual`, `event` (schema only, bus in Phase 6)
- [x] MCP tools: 7 (list, get, run_start/list/get/resume/cancel)
- [x] First real workflow: `discovery_followup` — migrates from `requirements/ziggy-workflows.md`
- [x] Docs: `docs/workflows.md`

### Review Queue UI at `/dashboard/review` ✓

- [x] oRPC routes: `review.listSkillRuns` / `approveSkillRun` / `rejectSkillRun` / `listWorkflowRuns` / `resumeWorkflow` / `cancelWorkflow` / `getRun` / `getWorkflowRun`
- [x] Server-rendered page seeds initial lists (pending skill_runs + paused workflow_runs)
- [x] `ReviewQueue.tsx` client component with inline expand, approve/reject/resume/cancel buttons, optimistic refetch
- [x] Sidebar link under main nav
- [x] Next.js build passes (dynamic route at `/[locale]/dashboard/review`)

## In flight

_nothing — feel free to start the next one_

## Queued (next)

- **Pluggable LLM provider on plugin skills** — `provider: openai | anthropic | vertex | azure-openai` field, adapter pattern. Low effort, high optionality for enterprise. (queued)
- **Website + Clutch case-study connectors** → refactor `draft_followup_email` prompt to retrieve case studies dynamically instead of hardcoded library.
- **ChatGPT Actions + GPT** (Phase 2b)
- **Slack bot** (Phase 2c)

## Test + infra status

- 51 tests passing (12 test files) — writer (6), auto-commit (5), MCP server (4), plugin loader (5), plugin executor (4), WorkflowService (9), existing services (18)
- Pre-commit hooks: lint + check-types + knip all green
- Docker Postgres 16 on `:5432`; PGLite mock for unit tests
- Ports: 3000 (Next), 3100 (Onyx, deprecating), 5432 (Postgres)

## Commits this session

```
[pending]  feat: review queue ui + oRPC mutations
6fea02e    feat: workflow primitive — triggered skill+approve+action sequences
5ab00e0    feat: plugin sdk v0.1 — typed skill contract + dual-path execution
c4126d9    feat: mcp server + auto-apply for phase 2 interface layer
8380861    feat: phase 1 — context-as-code, apply CLI, context_sha audit trail
6a6f5c9    docs: product strategy and roadmap — open-core, plugin-first, MIT retrieval
```

Not pushed to `origin/main`.

## Vertex / Azure AI Foundry stance

Pluggable backends, not the platform. `retrieval.yaml` gets `backend: native | vertex-search | azure-search` options in Phase 5. Source plugins wrap Vertex DataConnector / Azure AI Search skillsets. Core runtime stays portable (local, any cloud, on-prem) — enterprise customers get managed backends as plugins, not as defaults.

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-04-14 | Separate `context/<client>/` repo deferred to Phase 7 | Premature; in-tree keeps dogfood tight |
| 2026-04-14 | Pulled Workflow primitive from Phase 6 to now | WOW demo (Phase 6) needs workflows to exist first, and the 6 planned Ziggy workflows in requirements/ should be real |
| 2026-04-14 | Vertex/Foundry = pluggable backends, not foundation | Open-source + portability + local dev trumps managed fanciness |
| 2026-04-14 | Agent stays as a single conversational primitive per org | No need for nested/composite agents yet; spawn new named agents (slug-based) when scope genuinely distinct |
| 2026-04-14 | Auto-apply uses `chore(context): <summary>` commits | Conforms to conventional-commits / commitlint; `context:` alone is rejected |
