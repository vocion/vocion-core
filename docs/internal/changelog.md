# Changelog

What's shipped, dated, newest first. Roadmap of what's next lives in [`roadmap.md`](./roadmap.md).

---

## 2026-06-30 — Permission model: discovery vs mutation (the keystone)

Platform upgrade #2 from `firsthq/docs/platform-plan.md` §4 — the core of the discovery-vs-mutation
permission model. Ships in `v1.27.0`.

- New `services/authz.ts`: one decision point — **principal × scope × resource × mode × gate**.
  `authorize(principal, resource, mode)` returns `{allowed, gate, reason}`.
  - **discover** → scope/ACL only (the in-memory mirror of RetrievalService's SQL `scopeCond`); never gates.
  - **mutate** → action **grant** check + target scope + the **autonomy gate** for agents (humans with
    the grant act directly).
  - Role grant bundles (owner/pm/specialist/client_reviewer); `scopeAllows`; `requiresApprovalForMutation`.
- The mission autonomy ladder (`taskNeedsApproval`) now **delegates** to `authz.requiresApprovalForMutation`
  — a single source of truth for the gate rule (mission tests unchanged).
- Tests: 12 authz cases (gate by autonomy, scope isolation, grant checks, human-vs-agent) + the 4
  existing autonomy tests still green.
- Next sub-steps (documented, not yet built): enforce `authorize` at the MCP tool-call + skill/action
  runtime, and a single **review service** unifying the MCP autonomy gate and the UI review queue.

---

## 2026-06-30 — Scoped retrieval + document ACL (sub-org segmentation)

First platform upgrade driven by FirstHQ's M2 (see `firsthq/docs/platform-plan.md`). Retrieval was
**org-only**; this adds **client/team scope** to the knowledge store so one client's documents never
surface in another's results. Ships in `v1.26.0`.

- Schema: `client_id` + `team_id` on `knowledge_document` + `knowledge_chunk` (+ `(org_id, client_id)`
  indexes); hand-written migration `0025_scoped_retrieval` (NULL = org-wide/shared).
- `IngestionService`: `SourceRef` + `ensureSource` carry optional `{clientId, teamId}`; stamped onto
  every document + chunk write.
- `RetrievalService.search`: new `clientId` / `teamId` / `allClients` options. **Safe-by-default ACL**
  (`scopeCond`): a client-scoped search returns shared + that client only (never another client); an
  unscoped search returns shared only; `allClients` is the explicit admin escape hatch. Enforced on
  both the vector and keyword arms.
- Tests: cross-client isolation (A never sees B; unscoped sees only shared; allClients sees all).
- The discovery half of the discovery-vs-mutation permission model — the next step formalizes mutation
  grants + one review service.

---

## 2026-06-28 — Missions: open-ended team work (the third work mode)

Adds the **Mission** primitive — a goal-driven assignment a team of agents plans and works under
human review (Hire→Brief→Work→Review→Coach→Learn→Promote). One Agent framework, three modes
(structured / mission / team); workflows become what successful missions get promoted into. Ships
in `v1.25.0`.

- Schema `mission` + `mission_run`; hand-written migration `0024` (drizzle generate still blocked by
  the 0021/0022 snapshot collision).
- `services/MissionService` + `services/missions/{planner,runtime,autonomy}`: plan a brief into a
  task graph, dispatch tasks to owner agents via `runAgentDeep`, autonomy ladder gates external
  actions (pause → `awaiting_review`), capture artifacts, resumable state, promote-to-workflow stub.
- oRPC `missions.*` + MCP `mission_*` + workspace authoring (`MissionManifestSchema`, loader,
  applier) + 2 seed templates.
- Dashboard **Mission Room** (`/dashboard/missions`): list, brief form, run detail
  (Brief/Plan/Team/Artifacts/Coaching) + sidebar entry.
- New `/feature` Claude Code skill (`.claude/skills/feature/`) — the cross-repo major-feature
  workflow (deep plan → build core+UI → marketing+docs → semver+blog, delegating to `/release`).
- Reuses subagents, write_todos, request_human_review, learnings, budgets, the workspace_sha stamp.
- Phases 2–6 (durable Temporal sessions, capability registry/proposals, deeper team runtime,
  promotion engine) planned, not in this MVP.

---

## 2026-06-28 — Built-in agent tools (web search, browse, image, code, artifacts)

Agents were capable over ingested knowledge but couldn't reach the live web or produce things.
This adds a set of general-purpose, provider-pluggable tools every agent gets out of the box, plus
a dashboard surface, docs, and a `/release` automation skill. Ships in `v1.24.0`.

### Capabilities (`libs/tools/<cap>/`)
- `web_search` — Tavily (default) / Brave; provider-pluggable via `VOCION_WEBSEARCH_PROVIDER`.
- Browse — `fetch_url` + `crawl_site`. Builtin reuses the `web` connector's HTML→text extractor
  (now exported from `libs/sources/web.ts`); Firecrawl opt-in for JS-heavy pages.
- `generate_image` — OpenAI gpt-image-1 (reuses `OPENAI_API_KEY`), saved via the new artifact store.
- `run_code` — builtin **safe calculator** (allowlisted identifiers via `Object.hasOwn`, no arbitrary
  eval; covered by `calculator.test.ts`); E2B sandbox reserved as opt-in.
- `create_artifact` — CSV / SVG chart / doc, written to `VOCION_ARTIFACTS_DIR` (served at `/artifacts`).

### Wiring
- Runtime tools in `services/agents/tools/*` registered in `services/agents/runtime.ts`.
- MCP exposure in `interfaces/mcp/tools/capability-tools.ts`.
- Dashboard **Tools** catalog at `/dashboard/tools` (sidebar → Capabilities), reading
  `libs/tools/catalog.ts` (provider/key status, graceful when unconfigured).
- `.env.example` documents every provider flag + key. Only `TAVILY_API_KEY` is a strictly new key.

### Docs + release tooling
- New `concepts/tools.md` + `guides/using-built-in-tools.md`; `reference/mcp.md` + `docs/README.md` updated (vocion-www).
- New `/changelog` page + release blog post (vocion-www).
- New `/release` Claude Code skill (`.claude/skills/release/`) that propagates a unit of work to
  docs + app + blog/changelog + this changelog + semver.

---

## 2026-04-15 — Feedback loop, in-app editing, evals, Logs rename, roadmap rewrite

UX + docs sweep on top of yesterday's rebrand. Closes the capture side of the self-improvement loop.

### Feedback + logs
- `skill_run` + `workflow_run` — `rating` (`up`/`down`), `feedbackNote`, `feedbackBy`, `feedbackAt` columns
- `FeedbackButtons` inline in chat skill outputs and the timeline
- Review queue captures rating + note on approve/reject
- `POST /api/v1/runs/:id/feedback` (idempotent)
- **Renamed Audit → Logs** in nav, route (`/dashboard/audit` → `/dashboard/logs`), and docs. "Audit trail" preserved as a technical concept term.

### In-app editing
- `PrimitiveFiles` viewer gains CodeMirror edit for `.yaml` / `.md` / `.js`
- `context.writeFile` oRPC route — path-traversal guarded, extension allowlist, re-applies after save
- Dirty badge when `context/<org>/` has uncommitted changes

### Skills
- Postprocess sidecar — `scriptFile:` in `skill.yaml` runs a per-skill JS transform after the LLM call
- Canonical folder shape: `<resource>/<slug>/{<resource>.yaml, prompt.md, evals.yaml, script.js?, README.md}`
- Activity strip on every drilldown

### Marketing + docs
- `/solve` rewrite: "one runtime for production AI"
- Use-case catalog — 50 workflows × 5 complexity levels, 12 featured, filterable on `/use-cases`
- Sidebar consolidated; admin moved into the user menu
- Docs IA — Get started / Concepts / Guides / API / Reference; public vs internal split
- Five-resource vocabulary (Source / Object / Skill / Workflow / Agent) replaces "primitives" everywhere user-facing. "Primitives" stays as code-only term.

### Internal docs
- Roadmap rewritten — 12 numbered phases (dropped 2.5), Phase 11 (Cloud, proprietary) and Phase 12 (Enterprise, proprietary) split out from the old "ecosystem + enterprise" lump. TOC at the top with anchor links.
- Use cases regrouped: one nav group with Catalog, Ziggy, Algren as peers. Ziggy collapsed into a single page with section anchors (Overview · Connectors · Object model · Skills · Workflows · Sprint plan).
- Customer Onboarding + Managed Operations docs removed. `progress.md` → `changelog.md`.
- `/dashboard/roadmap` defaults to the roadmap doc; `[...slug]` catchall handles deeper paths.

---

## 2026-04-14 — Vocion rebrand, npm workspaces, dashboard canonical shape, public API read side

Pivot day. Renamed and restructured for OSS launch.

### Rebrand
- Vocion → Compiles → **Vocion** (repo, npm scope `@vocion/*`, docs, marketing, domain)
- Cairn logo, refreshed marketing surfaces, consistent naming across code + docs

### Workspace architecture (Phase B)
- npm workspaces: `packages/core` (app), `packages/sdk` (`@vocion/sdk` stable contract), `packages/plugins/transcript-highlights` (reference sample)
- Imports at the contract boundary switch to `@vocion/sdk`; runtime stays in core

### Public API (read side)
- `GET /api/v1/{agents,skills,workflows,objects/types,runs,runs/:id}` with Clerk-session auth
- Tenant-scoped via `auth().orgId`
- Write side queued for Phase 3

### Dashboard
- Canonical primitive shape: TitleBar + stats strip + instance grid + Activity strip + PrimitiveFiles viewer
- Sidebar reorg: Workspace (Chat/Search/Reviews/Logs), Context (Agents/Skills/Workflows/Objects/Sources), admin in the user menu
- Killed orphan routes: `/dashboard/domains`, `/dashboard/ziggy`, `/dashboard/ask`, `/dashboard/todos`
- `'use client'` on AppSidebarHeader so Clerk's `UserButton.MenuItems` render

### Pluggable LLM providers
- `openai` + `anthropic` shipped; `vertex` + `azure-openai` placeholder adapters
- Per-skill `provider:` override in `skill.yaml`

### Git externalized
- MCP `context_write_*` defaults `autoCommit: false` — auto-applies to DB, never auto-commits
- "Dirty" badge in the dashboard when `context/<org>/` has uncommitted changes

### Docs
- Restructured `docs/` around concepts + guides + reference; public vs internal split
- `docs/guides/extract-tenant.md` documents the `git subtree split` + `CONTEXT_PATH` handoff
- Internal roadmap split out from public docs

### In-product docs viewer
- Markdown rendered with rewritten cross-doc links
- Sidebar grouping by directory; same component powers `/docs` and `/dashboard/roadmap`

---

## Foundation (shipped earlier — phase milestones)

These are the platform invariants everything else builds on. Dates are commit dates; commits below.

### Phase 1 — Context-as-Code

- `context/<org>/` scaffold — YAML + markdown, walked by the loader
- `applyContext` reconcile (idempotent upserts for agents, skills, object types, workflows)
- `context_version` audit table + `skill_run.context_sha` stamping
- `npm run context:apply` / `:check` / `:export` CLI scripts
- 11 legacy seed/update scripts retired — content preserved as YAML + MD

### Phase 2 — Interface layer (partial)

- **MCP server (stdio)** — 15+ tools across `context_*`, `runtime_*`, `objects_*`, `search_*`, `plugins_*`, `workflow_*`. Install via `claude mcp add vocion`.
- **Auto-apply + versioning** — every `write_*` tool validates → writes → applies → records `context_version` atomically (commit is opt-in, external to the app)
- **Review queue UI** at `/dashboard/review` — pending skill_runs + paused workflow_runs, approve/reject/resume/cancel, inline detail view

### Plugin SDK v0.1 → v0.2

- Typed `Skill<Input, Output>` contract + `defineSkill()` ergonomic constructor
- `PluginContext` — narrow runtime (orgId, llm, contextSha, log, retrieve)
- Registry + loader — env-driven discovery via `VOCION_PLUGINS`, error isolation
- Dual-path execution — plugins override prompt-only skills on slug collision
- Sample plugin: `transcript_highlights`
- v0.2: extracted to `@vocion/sdk` workspace; pluggable LLM providers; postprocess sidecar

### Workflow primitive (pulled forward)

- Schema: `workflow` + `workflow_run`
- Context-as-code: `context/<org>/workflows/<slug>/workflow.yaml`
- Runner: sequential execution, `{{input.x}}` / `{{steps.name.output.y}}` interpolation
- Step types: `skill`, `approve` (HITL), `action` (v1 stub)
- Trigger types: `manual`, `event` (event bus is later phase)
- 7 MCP tools: `workflow_list/get`, `workflow_run_start/list/get/resume/cancel`

### Vocion groundwork (March 2026)

- Onyx-backed retrieval with Vespa visibility on the System Status page
- Citations + thinking panel + permanent eval markup in chat
- Async Gamma generation with background polling
- Per-connector indexing progress + replay status

---

## Earlier

Dependency upgrades and CI tweaks before the Vocion groundwork landed (Feb 2026 ← Dec 2025). See git log for detail.
