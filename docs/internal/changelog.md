# Changelog

What's shipped, dated, newest first. Roadmap of what's next lives in [`roadmap.md`](./roadmap.md).

---

## 2026-06-30 — Connector credentials wired into sync (V-connect)

The credential vault (`libs/crypto/credentialVault` + `source_credential`/`source_dek`/`source_install`)
existed but nothing read it at sync time — so every OAuth/token connector got an empty `ctx.credentials`
and refused. This wires it. Ships in `v1.36.0`.

- `services/SourceCredentialService.ts` (NEW) — `storeCredential({orgId, installId, displayName, raw})`
  encrypts via the vault (AES-256-GCM, per-tenant DEK) and persists only ciphertext/nonce/authTag/dekId;
  `getCredentialsForSource(orgId, sourceSlug)` finds the org-scoped, non-disabled install + latest
  non-revoked credential, decrypts, and returns the raw credentials (or `undefined` — e.g. `web`).
- `services/SourceSyncService.ts` — `runSync` now resolves `getCredentialsForSource(orgId, row.slug)`
  and passes it as `ctx.credentials` into `connector.sync(...)`.
- Tests (`SourceCredentialService.test.ts`, 3, PGlite): store→encrypt→DB→decrypt→get round-trip, DB
  holds only ciphertext (no plaintext token), no install → undefined, revoked credential → undefined.
- Plaintext never touches the DB; exists only in memory for the duration of a sync.
- Closes the gap between "the connector pack exists" and "a real account connects + syncs" — the last
  platform piece the reference deployments need.

---

## 2026-06-30 — Google Drive connector: the pack is complete (V-connect)

The last connector of the pack — completes the set the two reference deployments run on. Ships in `v1.35.0`.

- `libs/sources/drive.ts` (NEW) — OAuth source connector. Lists Drive files (`fields=…files(id,name,mimeType,modifiedTime)`,
  paginates `nextPageToken`, resumes `ctx.cursor`); **incremental** via `modifiedTime > '<ISO>'` when
  `ctx.since` is set. Google-native exports: Docs/Slides → `text/plain`, Sheets → `text/csv`; `text/*`
  files download via `alt=media`; anything else yields metadata only (no binary). Registered.
- Rides the durable pipeline (v1.29 incremental/resumable) + inherits client scope (v1.26).
- Tests (`connectorPack.test.ts`, +2 → 7): lists + exports a Google Doc as text, refuses without a
  token, filters by `modifiedTime` when incremental. Types + lint clean.
- Connector pack complete: **HubSpot, Gmail, Slack, Drive** (RevOps) + **Google Ads, GA4** (Daylyte).
- Public docs: Drive row added to `features/connectors.md`. Next: stand up the reference deployments (V-ref).

---

## 2026-06-30 — MCP over HTTP: multi-tenant via Bearer token (V-control)

Completes the control-plane pair — the write API was the REST surface; this is the **agent/tool**
surface. One MCP endpoint, multi-tenant, org derived from a `vcn_live_…` token. Ships in `v1.34.0`.

- `interfaces/mcp/http.ts` (NEW) — `mcpConfigForBearer(authHeader)` → `authenticateBearer` → org-scoped
  `McpConfig` (or `McpHttpError(401)`); `buildServerForBearer` → `{ server, identity }` via the existing
  `buildServer(config)` (tools already scope by `config.orgId`). Authoring tools off over HTTP
  (`autoCommit`/`autoApply` false) — HTTP is the runtime/data/search plane.
- `app/api/mcp/route.ts` (NEW) — POST/GET/DELETE on `WebStandardStreamableHTTPServerTransport`
  (stateless, `enableJsonResponse`, fresh transport per request). Web `Request`→`Response`, so it runs
  in the Next route with no Node req/res bridge. Bad/missing token → JSON 401.
- Tests (`http.test.ts`, 3): 401 without a token, org-scoped config (authoring off), and an
  **end-to-end** loop — `buildServerForBearer` ↔ `InMemoryTransport` ↔ MCP `Client`, `listTools`
  returns the full surface incl. `search_query` + `runtime_list_runs`. Types + lint clean.
- Public docs: `reference/mcp.md` gains a "Connect over HTTP (multi-tenant)" section; Limitations
  updated (stdio + HTTP both ship; only the OAuth sign-in flow remains). Bearer tokens work today.

---

## 2026-06-30 — Write API: the review queue on tokens + authz (V-control)

The first **write** surface of the control plane. Tenant Bearer tokens (v1.30) now drive the unified
review queue over HTTP, through the same `authz` enforcement as a human. Ships in `v1.33.0`.

- `services/writeApi.ts` (NEW) — framework-free write-API layer. `apiContext(authHeader)` →
  `authenticateBearer` → `TokenIdentity` or `WriteApiError(401)`. `apiListReviews` → `ReviewService.listPending`.
  `apiDecideReview` → validates kind/action/id → `enforce(principal, {kind:'action', action:'approve', scope:{orgId}}, 'mutate')`
  (maps `AuthzDeniedError` → `403 FORBIDDEN`) → `ReviewService.decide` with `reviewedBy: token:<id>` →
  returns the refreshed queue.
- Routes: `app/api/v1/reviews/route.ts` (GET) + `app/api/v1/reviews/decide/route.ts` (POST) — thin
  wrappers that map `WriteApiError` → `jsonError`. Auth via `Authorization: Bearer vcn_live_…`.
- Deciding a review = the `approve` capability: owner/PM/client_reviewer tokens pass; a draft-only
  specialist token is `403`'d before any dispatch. Authentication and authorization are one path.
- Tests (`writeApi.test.ts`, 5): 401 without a valid token, lists the org queue, owner decides →
  dispatches + returns refreshed queue, specialist forbidden (no dispatch), kind validation. Types clean.
- Public docs reconciled to reality: `docs/api/README.md` + `runs.md` + `authentication.md` — token
  prefix `cmp_live_` → `vcn_live_`, reviews endpoints promoted to live, "tokens are principals" section.

---

## 2026-06-30 — Connector pack: Google Ads, GA4, Gmail, Slack

Fills out V-connect — the integrations the two reference deployments run on. Ships in `v1.32.0`.

- `libs/sources/googleAds.ts` — campaign performance by day (GAQL `googleAds:search`, dev-token + OAuth),
  incremental via `segments.date >=`, paginates `nextPageToken`. *(Daylyte PPC.)*
- `libs/sources/ga4.ts` — GA4 `runReport` rows (sessions/conversions/bounce by date + landing page),
  `startDate` from `since`. *(Daylyte CRO.)*
- `libs/sources/gmail.ts` — messages (list → metadata fetch), incremental via `after:<unix>`, paginated.
  *(RevOps.)*
- `libs/sources/slack.ts` — channel history, incremental via `oldest`, paginates `next_cursor`. *(RevOps.)*
- All four ride the durable pipeline (v1.29 incremental/resumable) + inherit client scope (v1.26); each
  yields `IngestDoc`, registered. Mocked-fetch tests per connector. Types clean.

---

## 2026-06-30 — HubSpot connector (V-connect kickoff)

First of the connector pack on the [path to 1.0](./vocion-1.0-path.md) — the integration the Metacto
RevOps reference deployment is built on. Ships in `v1.31.0`.

- `libs/sources/hubspot.ts`: CRM v3 source connector for **contacts / deals / companies**, private-app
  Bearer auth. **Incremental** — when the durable pipeline passes `since`, it uses the CRM **Search**
  API filtered on `hs_lastmodifieddate`; otherwise lists all. Paginates the opaque `after` cursor
  (resumes from `ctx.cursor`), yields one `IngestDoc` per record (serialized properties), registered in
  the source registry.
- Rides the durable-ingestion checkpoints from `v1.29` (incremental + resumable), and ingested records
  inherit client/team scope + ACL from `v1.26`.
- Tests (mocked fetch): yields docs, follows pagination, switches to Search for incremental, refuses
  without a token. 41/41 across the platform sweep; types clean.
- Next connectors: Google Ads + GA4 (Daylyte PPC/CRO), Gmail + Slack + Drive (RevOps).

---

## 2026-06-30 — Control-plane API tokens (step 4, first slice)

Platform upgrade #4 from `firsthq/docs/platform-plan.md` §5 — the start of the API control plane, the
V-control milestone on the [path to 1.0](./vocion-1.0-path.md). Ships in `v1.30.0`.

- Schema: `api_token` (id, orgId, name, `secret_hash`, role, grants, created/lastUsed/revoked);
  migration `0027`.
- `services/ApiTokenService.ts`: `issueToken` (returns plaintext `vcn_live_<id>_<secret>` once; stores
  only the SHA-256), `verifyToken`/`authenticateBearer` → resolves a token to an **authz `Principal`**
  (role + grants + org scope), `revokeToken`, `listTokens`. So an app/client mutation authenticates
  *and* gates through the same permission model + review queue as everything else.
- Tests: issue→verify→principal, tampered-secret / revoked / malformed rejection, Bearer header. Types clean.
- Remaining step-4 wiring (needs a running server to verify): mount the write-API routes on
  `authenticateBearer` + route their mutations through `authz.enforce` → ReviewService, and the MCP HTTP
  + OAuth transport. The credential + principal are the prerequisite, now in place.

---

## 2026-06-30 — Durable ingestion: checkpoints + incremental sync

Platform upgrade #3 from `firsthq/docs/platform-plan.md` §3 — the durability core for data ingestion.
Ships in `v1.29.0`.

- Schema: `source_sync_checkpoint` (one row per source: `status`, `cursor`, `since` watermark,
  started/completed, counts, error); migration `0026_source_sync_checkpoint`.
- `SourceContext` gains `since` + `cursor` so connectors fetch **incrementally** (honor upstream
  `modifiedTime`/etag), falling back to a full walk when unsupported.
- `SourceSyncService`: `beginSync`/`finishSync` make a run **resumable + checkpointed** — records the
  watermark on success, preserves it on failure (a retry resumes from the last good point). Incremental
  runs skip tombstoning (only a full sync prunes deletes). The whole run is wrapped so a crash records a
  `failed` checkpoint.
- Tests: full→watermark, incremental reads-back, failure-preserves-watermark. Types clean.
- Remaining wiring (needs a running Temporal to verify): wrap `runSync` in a `sourceSyncWorkflow` +
  activity, register on the worker, and have the sync RPC spawn it + Temporal Schedules for periodic
  re-sync. The data-layer durability primitives above are the prerequisite, now in place.

---

## 2026-06-30 — Unified review queue + `enforce()` (permission model, cont.)

Finishes the load-bearing half of the permission model (platform-plan §4). Ships in `v1.28.0`.

- `authz.enforce(principal, resource, mode)` — throws `AuthzDeniedError` when not allowed; otherwise
  returns the decision so a caller acts on `gate` (enqueue a review when `approve`, else proceed). The
  mutation/discovery enforcement point.
- New `services/ReviewService.ts` — **one** review queue: `listPending(orgId)` unifies pending skill
  runs (`pending`), paused workflow runs (`paused`), and missions `awaiting_review` into a normalized
  list; `decide(item, action)` dispatches approve/reject to the owning service. Closes the
  "MCP autonomy gate vs UI review queue don't share state" gap at the read/decide layer.
- Tests: enforce (allow/deny + gate) + unified-queue aggregation + org-scoping. 16/16 green; types clean.
- Still open (Phase 2.5-dependent): calling `enforce` inside every MCP tool-call + skill/action runtime
  needs the `defineTool` registry; the mission runtime already routes its gate through this rule.

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
