# Changelog

What's shipped, dated, newest first. Roadmap of what's next lives in [`roadmap.md`](./roadmap.md).

---

## 2026-07-03 (night) — Memory, trust, ask steps, briefings (v1.60)

The "Trust & the Daily Loop" sprint — every open feature task closed.

- **feat(missions) — working memory.** Per-mission notes read into every check brief and rewritten
  via update_mission_notes; thread aging emerged live ("[Check #2 open]"). Migration 0037.
- **feat(trust) — auto-execution rules.** trust.yaml {action, autoApproveAbove, enabled}; cleared
  proposals execute immediately, audited under Review → "Executed automatically". DEFAULT OFF.
  Also fixed a real gap: pending proposals had NO UI — Review now renders the queue with
  confidence chips + Approve/Reject (decisions keep training learnings). Migration 0038.
- **feat(workflows) — ask steps.** Human input as a deterministic step: pause with a question in
  Review, resume with text as {{steps.x.output}}. discovery_followup v2 opens with one.
- **feat(briefings) — the front door.** publish_briefing + /dashboard/briefings + nav; the briefing
  charter ends with publishing. Migration 0039.
- Everything verified LOCAL-FIRST with live runs before deploy; 172 unit tests green.

---

## 2026-07-03 (evening) — Connection ACLs + the executable demo (v1.58–v1.59)

- **feat(access) — per-connection ACL.** `access: {visibility: restricted, users: [emails]}` on any
  source; enforced as an intersection (agent scope ∩ member grants) in chat, search, and browse.
  Empty intersection = nothing, never a leak. Scheduled team runs keep access; outputs are the
  curated surface. Gmail restricted to chris@ on the metacto deploy. Migration 0036 + 3 PGlite tests.
- **test(e2e) — `npm run e2e:demo`.** The briefing + sweep as an executable scorecard. Local 8/8;
  PROD 9/9 against live data — sweep queued 4 real scored proposals (88/82/75%) into review.
- **feat(dashboard) — Activity.** One stream (mission checks, workflow runs, event fires, syncs),
  needs-attention pinned; Workspace = Chat · Review · Activity · Search.
- **incident** — a feature-branch merge + pin-fix rolled prod core back a month mid-day; restored
  within the hour, work preserved. New rule: THE PIN ONLY MOVES FORWARD; rebase the deploy repo
  before bumping. Consider branch protection on metacto-vocion-agents main.
- Autonomy milestone: the system ran its own briefing (12:00 UTC) and sweep (13:00 UTC) today with
  zero humans involved.

---

## 2026-07-03 — Automations: the four-object model (v1.55)

Chris's axiom, enforced in the schema: **workflows are deterministic, missions are agent-driven,
automations are the WHEN.** Agents = who, missions = goals, workflows = procedures, automations =
`{when: schedule|event} → {do: workflow | checkMission}`.

- **feat(automations)** — first-class automation object (migration 0035, `workspace/<org>/automations/`
  YAML, one Temporal Schedule namespace, EventService matches event-whens on emit). Missions +
  workflows carry NO trigger logic; embedded-trigger legacy paths warn as deprecated. The Automation
  page is now a real object list (when → do, human cadence, live next-fire).
- **feat(missions)** — detail page: full charter, team, checked-by automations, recent runs,
  "Check now" (missions.check RPC), backing YAML editable inline (workspace writer). Mission cards
  link here instead of jumping into the start-form. Briefing + sweep restored as pure-goal missions;
  the v1.54 `agent` workflow step is removed from the authoring schema (tolerated at runtime).
- **feat(chat)** — real chain-of-thought streaming: deepagents' native `.reasoning` projection →
  `thinking_delta` events → live Reasoning step in the timeline. Opt-in via `VOCION_THINKING_BUDGET`
  (forces temperature 1 on main; thinking tokens bill as output). Enabled on the metacto box.
- **infra** — everything verified LOCAL-FIRST (migration, apply, fireAutomation E2E, prod build)
  before deploy; prod cleaned of legacy schedules; five `automationFire` schedules live.
- Queued: #114 mission working memory (checks remember what they flagged), #116 `ask` step
  (human-input as a workflow step, for discovery-followup transcripts).

---

## 2026-07-03 — Workflows are procedures, missions are goals (v1.54)

The boundary Chris called for, enforced everywhere: if the steps are the same every run it's a
scheduled WORKFLOW; a mission is an OBJECTIVE a team owns ("No Lead Goes Cold"), optionally
checked on a schedule. Automation = schedules & triggers that call both.

- **feat(workflows) — sync steps.** `{type: sync, sources: [gmail, hubspot]}` pulls live data
  before the steps that read it (Ziggy-comparison lesson: fresh-hours mail beats index-freshness).
  Per-source failures degrade, never kill the run.
- **restructure (metacto)** — crm-email-sweep + daily-revenue-briefing converted missions →
  scheduled workflows (sync → analyst agent step → lead agent step with interpolated hand-off;
  chain verified end-to-end). Remaining missions reworded as goals with check-in schedules.
- **feat(chat) — live work visibility.** The timeline header is now the current step
  ("Delegating: Pipeline Analyst… · 32s") instead of "Working…"; tool activity shares the human
  labels of the audit trail; completed steps show output snippets.
- **prompts** — briefing demands judgment: so-what per item, WHAT'S AT RISK with silence-duration,
  a closing watch-item pattern, and offers to do the work via the review queue.
- Queued from the Ziggy comparison: per-mission working memory so scheduled checks remember what
  they flagged last time (open threads, commitments, escalation).

---

## 2026-07-03 — Heartbeats: missions become standing responsibilities (v1.52)

The mission/workflow boundary, made crisp: **in a workflow the author decides the steps; in a
mission the team decides.** And time is now a first-class trigger.

- **feat(missions) — heartbeat crons.** A mission is a charter a team owns continuously. Optional
  `heartbeat` (5-field cron) creates a Temporal Schedule firing a heartbeat-mode run: one lead-agent
  task from the charter — check state, do only what's needed, report or say "nothing needed."
  No planner; hourly-cheap. Migration 0033.
- **feat(workflows) — schedule triggers + agent steps.** `trigger: {type: schedule, cron}` runs a
  workflow on a cron; the new `agent` step dispatches a prompt to a full agent (search, subagents,
  propose_action) inside a fixed sequence.
- **feat(dashboard) — Automation page.** Every clock in one place: mission heartbeats, scheduled
  workflows, event subscriptions, source-sync crons, with Temporal next-fire times.
- **feat(profile).** /dashboard/profile (name + password change) + the header user menu now points
  at real pages (the old Profile link was a dead Clerk route).
- **infra (metacto deploy).** vocion-temporal-worker container added — Schedules previously fired
  into a queue nobody drained. `workspace:apply` now reconciles all three schedule families
  idempotently and skips with a warning when Temporal is down.
- Verified: heartbeat-mode `crm-email-sweep` run completed headless on the local corpus.

---

## 2026-07-02 — Members + link invites; prod chat fixed (v1.50.1 → v1.51)

- **fix(agents) — prod chat crash (v1.50.1).** Mounted playbooks/learnings now pass to deepagents as
  structured `FileData` (content + mimeType + timestamps), not raw strings. Raw strings failed
  FilesystemMiddleware state validation the moment an org had learnings — empty orgs passed silently,
  which is why dev looked fine and prod (with learnings applied) broke on the first chip. Skills
  middleware now mounts only when playbooks exist. Verified against a local production build.
- **feat(members) — team member management (v1.51).** `/dashboard/members`: roster with roles, admin
  role changes + removal (last-admin guarded, no self-removal), and LINK-based invites — mint a
  one-time 14-day link bound to the invited email, copy it, share it via Slack/DM; no mailer needed.
  Drives the existing `/sign-up?invite=` accept flow. New `members.*` oRPC routes +
  `TeamMembersService`.
- **feat(brand)** — `NEXT_PUBLIC_BRAND_LOCKUP_DARK` (dark-mode logo swap) +
  `NEXT_PUBLIC_BRAND_ATTRIBUTION` (footer copyright), both Dockerfile build args.
- **fix(build)** — dropped the unused wasm `tiktoken` dep; its leftover Dockerfile COPY was failing
  the prod image build. Nav: Members replaces Billing in Settings; Admin renamed System.

---

## 2026-07-02 — Work timeline, search browse, decisions-train-agents (v1.49 → v1.50)

The afternoon wave — all verified on the live local corpus (~12.4k real docs).

- **feat(chat) — work timeline (v1.49).** One consolidated, collapsible chain-of-thought block per
  agent message: "Delegated: Pipeline Analyst" (name recovered from the subagent prompt), "Searched
  sources ('…')", "Proposed: hubspot.update · 88% confidence · queued for your approval" — live
  statuses while streaming, one-line summary after. Replaces raw task/kwargs breadcrumbs.
- **feat(search) — browse before you search (v1.49).** Default result set = most-recent documents
  with first-chunk blurbs; per-source filter chips with live doc counts, combinable with queries.
- **feat(review) — decisions train the agents (v1.50).** Every approve/reject on an agent-proposed
  action writes a learning rule to the `crm-updates` step, mounted into revenue agents each turn.
  Verified: rejecting a 0.72-confidence proposal produced "REJECTED… do not propose this class again
  without stronger evidence." The capture side of the trust ladder.
- **fix(auth) — stale-session guard (v1.49).** Dead projectId → a clear "Session expired" screen,
  never a silently-empty workspace.
- **fix(ui)** — in-app docs/roadmap viewers retired (Docs → public site); Teams page shows each
  agent's skill names (registry showcase); Crowdin skips gracefully without secrets.

---

## 2026-07-02 — Daily brief runs on real data; releases restored (v1.47.1 → v1.48)

The first end-to-end demo of the RevOps loop on live CRM data, and the release pipeline back.

- **Releases restored.** CI greened (v1.47.1 = first auto-cut GitHub Release since May 26). Root cause
  of the tag collision: pre-rebrand v1.x tags orphaned from main → semantic-release recomputed v1.0.0.
  Fixed by tagging the real milestone commits v1.42.0–v1.47.0; the version line continues.
- **fix(agents) — create_artifact JSON-string args.** The daily brief produced a complete report then
  died at the finish line: the model passed `doc` as a JSON string, strict schema threw. Schema now
  accepts string|object (transforms can't serialize to the model-facing JSON Schema); handler coerces.
- **feat(chat) — live activity line.** Long multi-subagent turns looked frozen ("no visible thinking");
  retrieval/subagent/tool events now render as a live line (Searching… / Delegating to specialist… /
  Assembling…). Tool-input previews capped at 240 chars.
- **Verified on real data:** 235 deals + 4k+ companies/contacts synced from HubSpot; the Revenue Lead
  delegated to Pipeline Analyst + Follow-Up Coordinator and produced a tiered brief (past-due $240K
  deal flagged with today-action, MQLs to qualify, per-deal next steps). Goal 1 demonstrable locally.
- Roadmap: transcript connectors (Zoom, Loom, Granola) added to the sources pack.

---

## 2026-07-02 — Google OAuth refresh, propose_action with confidence, sync CLI (v1.47)

The CRM-copilot substrate: durable Google auth, and agents that can queue CRM changes for approval.

- **feat(sources) — durable Google credentials.** `libs/sources/googleAuth.ts`: connectors + actions
  resolve access tokens from `{ refreshToken, clientId, clientSecret }` (minted per run, cached to
  expiry) with raw-token fallback. gmail/drive connectors + `gmail.send` wired. One-time consent via
  `npm run google:oauth` — loopback listener → refresh token → vault, per connector. Kills the
  hourly-expiry problem for Gmail/Drive.
- **feat(actions) — `propose_action` agent tool + proposal envelope.** Agents can propose registered
  writes (`hubspot.update`, `gmail.send`) with **confidence (0–1), rationale, and evidence uris**;
  proposals ride the authz gate into the review queue as pending `action_run`s (migration `0032`
  adds `action_run.proposal`). The agent recommends; a human decides — groundwork for the
  recommended→automated trust ladder.
- **feat(scripts) — `npm run sync:source`** — CLI backfills with progress ticks (`--full` for
  re-fetch); the ops path used to load 235 deals + 4k companies + contacts.
- RevOps workspace: `crm-email-sweep` mission (48h in/out mail sweep → CRM update proposals),
  daily-brief v2 (NEW LEADS = contact `lifecyclestage`; ACTIVE OPPORTUNITIES with priority + next
  action), gmail source covers sent+received.

---

## 2026-07-02 — Workspace→project binding, per-connector credentials, source visibility (v1.46)

Fixes surfaced by running real HubSpot data through the local loop (235 deals + 4,295 companies synced).

- **feat(workspace)** — `workspace:apply --project <id|slug>` binds directly to a project (auto-targets
  the sole project when one exists). Kills the placeholder-org + manual re-key dance that made fresh
  installs look empty ("why don't I see the team?"). Bootstrap's re-key step becomes obsolete.
- **fix(sources)** — credentials resolve by **connector** slug, not source slug: one HubSpot token now
  serves the deals/contacts/companies sources. Previously the second and third HubSpot sources refused
  with "requires a private-app token" despite the stored credential.
- **feat(sources)** — the Sources page shows each source's **object type** and **ingested document
  count** ("235 documents ingested"), so what each connector pulled is legible at a glance.
- **fix(agents)** — in-turn LLM rerank disabled: deepagents' streamEvents taps nested model calls, so
  the reranker's `[2,3,0,…]` id-array leaked into chat responses. Hybrid RRF + heuristic reorder stay;
  also removes a model round-trip per search.
- RevOps workspace: `hubspot-contacts` (lifecyclestage — the lead signal) + `hubspot-companies`
  sources; Revenue Lead prompt hardened to synthesize search results, never echo raw records.

---

## 2026-07-02 — Credential onboarding + chat system-prompt fix + dev-runtime fixes (v1.45)

The first Activation-sprint slice: a source connector can be given credentials without psql, so the
connector pack can finally touch real data. Verified end-to-end on a Docker-free local (PGlite).

- **feat(sources) — credential onboarding.** `SourceCredentialService` gains `ensureInstall` +
  `storeCredentialForSource` + `credentialStatusForOrg` (root cause: nothing ever created a
  `source_install`, so the vault had no anchor and every apikey/OAuth connector refused —
  prod had 0 credentials). `POST /rpc/sources/[id]/credentials` (admin-only) stores an AES-GCM
  encrypted token; the sources GET now returns `authKind` + `credentialConnected`. UI: a
  Connect / Update-key dialog + "Connected / Needs credentials" badge, Sync-now disabled until
  connected. CLI fallback: `npm run creds:set -- --project <id|slug> --source <slug> --token …`.
  Verified: store → `source_install` row → vault decrypt round-trips the exact token; UI shows
  hubspot connected=true.
- **fix(agents) — chat "System messages must be first".** The agent's system prompt was passed as an
  input `{role:'system'}` message; deepagents prepends its own system message, so ours became an
  illegal second one and every turn errored. Now supplied via `createDeepAgent({ systemPrompt })` and
  dropped from the messages. Verified: a real turn streams thinking→answering→delta→done, no error.
- **fix(retrieval) — chunker off the wasm tokenizer.** `chunker.ts` imported the wasm `tiktoken`,
  which Turbopack dev can't resolve (`Missing tiktoken_bg.wasm`) — 500-ing every route that
  transitively imports the chunker (sources, agent runtime). Swapped to pure-JS `js-tiktoken` (already
  in-tree via `@langchain/core`, same `cl100k_base`). Local dev now runs the agent + sources.
- **ops** — new deploy CI in metacto-vocion-agents (push to main → SSH bootstrap → health gate),
  retiring the manual SSH deploy.

---

## 2026-07-01 — Brand lockup mode + chat de-dupe + module-load crash fix

UX pass from RevOps dogfooding, previewed locally before deploy (new working rule). Ships in `v1.44.0`.

- **feat(ui) — lockup mode.** `NEXT_PUBLIC_BRAND_LOCKUP`: a full lockup image (mark + wordmark as one
  asset) replaces the glyph + wordmark text; only the tagline renders beneath. The RevOps box now runs
  the official Metacto lockup extracted from metacto.com (orange `#F18700`), asset kept in the private
  deployment repo.
- **feat(ui) — chat surface de-dupe.** The agent header IS the page title (TitleBar block removed —
  the agent was named 4× on one screen); New Chat moved into the header action slot; composer
  placeholder shortened to `Message <name>…`; **per-agent suggestions actually render** (authored +
  stored since the workspace applier landed, never passed to the UI); "try one of these" label hidden
  when empty; LocaleSwitcher removed from the dashboard header.
- **feat(chat) — you brief the Lead.** The default conversation had no concept at all — `agents[0]`
  in table order made Follow-Up Coordinator the front door. Agents now sort lead-first (the Lead IS
  the default), and the header name is an **agent switcher** — Leads grouped as "brief the team",
  specialists as "go direct"; switching starts a fresh conversation.
- **fix(agents) — lazy OpenAI client.** The legacy client was constructed at module scope and the SDK
  throws on an empty key — every install without `OPENAI_API_KEY` 500'd the whole chat surface despite
  Anthropic being the default provider. Constructed on first use now.
- Docs: self-hosting branding table gains the lockup var; v1.43 blog post amended same-day.

---

## 2026-07-01 — Chat tool-error fix + configurable brand slot + sidebar cleanup

Bugfix + white-label polish, from live RevOps dogfooding.

- **fix(agents)** — the deepagents runtime passed `skills: [{source,name}]` (objects, forced with
  `as never`) where the library expects `skills?: string[]` (source paths). `SkillsMiddleware` called
  `.includes`/`.replace` on a non-string → `d.replace is not a function`, surfacing as a tool error on
  the first chat message. Now `skills: ['/playbooks/']`.
- **feat(ui) — brand slot.** `VocionLogo` gains `NEXT_PUBLIC_BRAND_MARK` (glyph image / `data:` URI)
  and `NEXT_PUBLIC_BRAND_TAGLINE` (subhead) alongside `NEXT_PUBLIC_BRAND_NAME`. Deployments supply their
  own mark, so OSS carries no third-party art. Dockerfile ARG/ENV for both. Sidebar brand moved
  top-left (was centered).
- **fix(ui) — "Workspace" redundancy.** `ProjectSwitcher` renders nothing in a single-workspace
  deployment (it only duplicated the "Workspace" section header); returns when `count > 1`. Chat header
  drops the hardcoded `Workspace ·` eyebrow — uses the agent's own eyebrow (e.g. "RevOps · Follow-Up").
- RevOps box: `metacto` wordmark + Metacto network glyph + "agents by Vocion" tagline (mark lives in
  the deployment repo, base64'd into the build-arg).
- Docs: `guides/self-hosting.md` branding section; blog `2026-07-01-white-label-brand.md`.

---

## 2026-07-01 — Agents become teams: lead/specialist roles + Teams view

Retires the "sub-agent" framing. Every agent now carries grouping fields and forms a first-class team.
Ships in `v1.42.0` (semantic-release: `feat(agents)` → `v0.6.0` in git tags).

- **Schema** — `role` (`lead`|`specialist`, default `specialist`), `agent_type`
  (`mission`|`workflow`|`operational`), `team` columns on `agent` + `agent_team_idx`. Hand-written
  migration `0031_agent_role_team.sql` (drizzle-kit generate still blocked by the 0021/0022 snapshot
  collision).
- **Workspace** — `role`/`agentType`/`team` on `AgentManifestSchema`; `applier.ts` persists them on
  `workspace:apply`. Pure config — no restart.
- **Service** — `listTeams(orgId)` groups an org's agents into `{ team, lead, specialists }`; agents
  with no `team` fall under `ungrouped`.
- **UI** — new `/dashboard/teams` view (Lead prominent + specialists grid, per team) + a **Teams**
  sidebar entry (Users icon).
- **fix(proxy)** — redirects resolve the public origin (`NEXT_PUBLIC_APP_URL`/`AUTH_URL` →
  `x-forwarded-*` → request origin) instead of the internal `0.0.0.0:3000` bind that had been blanking
  the app behind Caddy.
- RevOps workspace relabeled: `revenue-lead` (lead/mission) + 4 specialists, all `team: revenue-operations`.
- Docs: `features/teams.md` (new) + `features/agents.md` cross-link; blog `2026-07-01-agent-teams.md`.

---

## 2026-07-01 — HubSpot write action: the deals desk gets hands (RevOps)

Second action on the v1.39 framework — the write behind progressing deals + the CRM hygiene sweep.
Ships in `v1.41.0`.

- `libs/actions/hubspot-update.ts` (NEW) — `hubspot.update`: PATCH properties on a HubSpot deal /
  contact / company (`/crm/v3/objects/{type}/{id}`, private-app token from the vault). Grant
  `update_crm`, `external: true`, `sourceSlug: 'hubspot'`. Returns the object + changed keys.
- Registered in `libs/actions/registry`. Rides the full gate: an agent proposing a stage change / field
  fix at low autonomy → `pending` action_run → the right person's queue → executes on approval.
- Tests (3): PATCHes the right object + returns changed keys, refuses without creds, surfaces API errors.
  Types + lint clean.
- With this, both Goal-2 flows have their write: the deals desk (stage/next-step moves) and the
  Lead→MQL→SQL→Opp hygiene sweep (fill missing fields, fix wrong stages) — every change gated.

---

## 2026-07-01 — Event-trigger runner: event-driven work (RevOps load-bearing)

"Event-driven first." Workflows already declared an `event` trigger; nothing dispatched to them. This
is the runner: an inbound event fans out to the workflows subscribed to it. Ships in `v1.40.0`.

- `services/EventService.ts` (NEW) — `emitEvent({orgId, type, payload, dedupeKey?})`: dedupes (repeat
  key no-ops), finds active workflows whose `trigger` is `{type:'event', event}` with a matching
  `filter` (every filter key equals the payload's), and `startWorkflow`s each with the payload as input
  + `triggerContext`. Records an `event_log` row auditing what it started. A single failed start doesn't
  drop the event.
- `event_log` table (migration `0030`): orgId, type, payload, dedupeKey (unique per org), triggered
  `[{slug,runId}]`, invokedBy. Idempotency + audit.
- `services/writeApi.ts` + `POST /api/v1/events` — emit an event over the API (`{type, payload?,
  dedupeKey?}`); any valid tenant token may emit (the workflows it starts gate their own actions).
  Provider webhooks (HubSpot, Gmail push, calendar, DocuSign) become thin adapters that normalize →
  POST here.
- Tests (4, PGlite): dispatch with payload, filter match/no-match, dedupe fires once, non-matching type
  + inactive workflow ignored but logged. Types + lint clean.
- Completes the load-bearing trio (team queue v1.38 · actions v1.39 · triggers v1.40): the full loop —
  event → draft → gated action → routed approval → execute → logged — now exists end-to-end.

---

## 2026-07-01 — Action framework: gated connector-writes (RevOps load-bearing)

The mutation counterpart to read-only connectors. The action step was a stub; this makes actions real:
an actor *proposes* a write, authz gates it, and it executes on approval. First action: **`gmail.send`**.
Ships in `v1.39.0`.

- `libs/actions/{types,registry}.ts` (NEW) — `Action` interface: id, `inputSchema` (zod), `grant`
  (authz), `external` (autonomy-gate trigger), `sourceSlug` (vault creds), `execute()`. Registry mirrors
  the source registry.
- `libs/actions/gmail-send.ts` (NEW) — `gmail.send`: send or (default-safe) create a **draft** as the
  connected Gmail user; RFC-822 → base64url; creds from the vault. `external`, grant `send_email`.
- `services/ActionService.ts` (NEW) — `proposeAction` enforces grant + autonomy gate: gated (agent,
  external, low autonomy) → persist `action_run` `pending` (now in the review queue) → `executeAction`
  on approval resolves vault creds + runs + records result; non-gated → execute now. `rejectAction`.
  One-directional (no ReviewService import).
- `action_run` table (migration `0029`): orgId, actionId, input, status
  (pending|approved|executing|done|failed|rejected), result, invokedBy, sourceSlug, timestamps.
- `services/ReviewService.ts` — **actions are the 4th review kind**: pending action_runs surface in the
  unified/team queue; `decide` dispatches approve→`executeAction`, reject→`rejectAction`.
- Tests (11): gmail-send (send/draft/no-creds), ActionService gating (gate at low autonomy, execute at
  high, no-grant 403, execute-on-approval, input validation), ReviewService×actions (queue + decide).
  Types + lint clean.
- Autonomy model unchanged: humans/tokens with the grant act directly; **agents** at low autonomy get
  gated — so a teammate's send lands in the right person's queue (v1.38) for approval.

---

## 2026-07-01 — Team queue: routing + assignment over the review queue (RevOps foundation)

Makes the unified review queue **multi-user**: pending items route to a specific person, with
per-person queues + snooze. The foundation for a team system (Chris/Andrew/Lili/Jamie/Garrett), not a
single-approver tool. Ships in `v1.38.0`.

- `review_assignment` table (migration `0028`) — an overlay keyed by `(kind, run_id)`: `assignedTo`
  (→ `user.id`, null = unassigned), `assignedBy`, `status`, `note`, `snoozedUntil`. Decorates the
  derived queue without touching the three run tables.
- `services/ReviewService.ts` — `listPending(orgId, { assignedTo?, includeSnoozed? })` decorates each
  item with its assignee/snooze, filters to a person (`assignedTo: userId`) or the unassigned/triage
  queue (`assignedTo: null`), and hides snoozed items by default. New `assign()` + `snooze()` (idempotent
  upsert per item). `pendingCount` gained the same opts.
- `services/writeApi.ts` + routes — `GET /api/v1/reviews?assignedTo=<userId|unassigned>`,
  `POST /api/v1/reviews/assign` (`{kind,id,assignedTo,note?}`), `POST /api/v1/reviews/snooze`
  (`{kind,id,until}`). Queue management = the `approve` capability (owners/PMs/client-reviewers);
  specialists `403`. `reviewedBy`/`assignedBy` recorded as `token:<id>`.
- Tests: `ReviewService.assignment.test.ts` (4, PGlite — decorate, per-person filter, reassign,
  snooze) + `writeApi.test.ts` (+3 — filter passthrough, owner assigns, specialist forbidden). Types +
  lint clean.
- Routing *policy* (who owns what by default) stays workspace config; this is the mechanism.

---

## 2026-06-30 — Scheduled syncs: sources sync on their cron via Temporal (V-connect)

Sources declared a `schedule` cron in their manifest, but nothing fired it — syncs were manual-only.
This wraps `runSync` in a Temporal Workflow + Schedule so a source syncs itself. Ships in `v1.37.0`.

- `services/temporal/activities/sourceSync.ts` (NEW) — `syncSourceActivity({orgId, sourceId,
  incremental})` host-side wrapper over `runSync` (incremental by default). Re-exported from the
  activities index so the worker registers it.
- `services/temporal/workflows/sourceSyncWorkflow.ts` (NEW) — deterministic workflow that proxies the
  activity. `workflows/index.ts` (NEW) barrels both workflows; the worker's `workflowsPath` now points
  at the barrel (registers `vocionWorkflow` + `sourceSyncWorkflow`).
- `services/SourceScheduleService.ts` (NEW) — `buildSourceScheduleOptions` (pure: cron → Temporal
  `ScheduleOptions` starting `sourceSyncWorkflow` incrementally), `ensureSourceSchedule` (idempotent
  create-or-update), `removeSourceSchedule` (delete, no-op if absent).
- `libs/temporal/client.ts` — `sourceScheduleIdFor(orgId, sourceSlug)` (`source-sync-<org>-<slug>`,
  distinct namespace) + `SOURCE_SYNC_WORKFLOW` const.
- Tests (5): `buildSourceScheduleOptions` (id/spec/action/args, per-org namespacing) + `syncSourceActivity`
  (drives runSync incrementally; honors full sync). Types + lint clean. Live Schedule create/update is
  exercised in the platform integration suite (needs a running Temporal).

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
