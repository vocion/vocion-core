# Changelog

What's shipped, dated, newest first. Roadmap of what's next lives in [`roadmap.md`](./roadmap.md).

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

Boilerplate, dependency upgrades, and CI tweaks before the Vocion groundwork landed (Feb 2026 ← Dec 2025 ← Vocion.js base). See git log for detail.
