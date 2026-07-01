# Vocion 1.0 — the path

**Internal — MetaCTO team only.** The definition of, and route to, **Vocion 1.0**. Companion to
[`roadmap.md`](./roadmap.md) (the phase view) and [`changelog.md`](./changelog.md) (what's shipped).
Grounded by the work itself: see `firsthq/docs/platform-plan.md` for the architecture.

## What "1.0" means (defined by what it must run)

Vocion 1.0 is not a feature checklist — it's a **readiness bar**: the platform is 1.0 when it can
comfortably run **FirstHQ 1.0** *and* two concrete **reference deployments** in production, under human
control, without platform changes:

1. **Daylyte Marketing — PPC/CRO reporting** *(a FirstHQ client)*. Pull Google Ads + GA4 + landing-page
   / CRO data, **scoped to the client**, and produce weekly client-ready reports + recommendations,
   human-approved before they go out. Read-heavy, deliverable-producing, externally-shared.
2. **Metacto RevOps** *(a Vocion implementation, on the runtime directly)*. The Revenue Operations team
   (`firsthq/docs/teams/revenue-operations.md`): lead triage, pipeline hygiene, follow-up + proposal
   drafts, proof capture — across HubSpot / Gmail / Slack, every external action gated. Write-heavy,
   mutation-gated, internal.

These two are chosen deliberately: together they exercise the **full surface** — external read +
deliverables (Daylyte) and internal write + approvals (RevOps). If both run cleanly, FirstHQ 1.0 has a
solid floor.

> **Forcing-function principle (unchanged):** build it in Vocion, surface it in FirstHQ. Daylyte and
> RevOps are the things that tell us the truth about what 1.0 still needs.

## Readiness matrix

✅ shipped · ◐ partial · ▶ remaining. "Needed by" = D (Daylyte), R (RevOps), F (FirstHQ shell).

> **Audited 2026-07-01** against code (`packages/core/src`) + the live RevOps box. The previous matrix
> had drifted ~13 versions behind the changelog (last synced ~v1.29). Statuses below are code-verified.

| Capability | Needed by | Status |
|---|---|---|
| Missions / Teams / Workflows / Operations | D · R · F | ✅ v1.25 |
| Autonomy ladder + approval gates | D · R | ✅ v1.25 |
| Built-in agent tools (web/browse/code/image/artifact) | D · R | ✅ v1.24 |
| Native retrieval (pgvector + RRF) | D · R | ✅ |
| **Scoped retrieval + document ACL** (client segmentation) | **D** | ✅ v1.26 |
| **Permission model — discovery vs mutation** | D · R | ✅ v1.27 |
| **One review queue** (unified pending + decide) | R · F | ✅ v1.28 |
| **Durable ingestion — checkpoints + incremental (core)** | D · R | ✅ v1.29 |
| Observability (Langfuse traces/cost) | D · R | ✅ |
| **API control plane** (Bearer tokens + reviews/events write API) | **F** · D · R | ✅ v1.30–v1.33 *(full resource CRUD → Phase 7, post-1.0)* |
| **MCP over HTTP** (agent/tool plane, multi-tenant, Bearer) | F · R | ✅ v1.34 *(OAuth sign-in flow ▶ deferred)* |
| **Connector pack** (HubSpot, Gmail, Slack, Drive, Google Ads, GA4) | **D · R** | ✅ v1.31–v1.36 — real APIs, incremental, creds from vault *(plugin repackaging → Phase 5, post-1.0)* |
| Temporal ingestion wrapper (sourceSyncWorkflow + SourceScheduleService) | D · R | ◐ v1.37 — mechanism shipped; **dispatch wiring ▶** (`ensureSourceSchedule` has zero callers — source cron never becomes a live schedule) |
| Triggers — event runner (`emitEvent` → workflow fan-out, `POST /api/v1/events`) | D · R | ✅ v1.40 |
| **Actions — gated connector writes** (`gmail.send`, `hubspot.update`, action_run gate) | **R** | ✅ v1.39–v1.41 |
| **Multi-user review routing** (assign / snooze / per-person queues) | R · F | ✅ v1.38 |
| **Teams** (lead/specialist, team grouping, Teams view) | R · F | ✅ v1.42 |
| **Credential onboarding** (UI/CLI to put a token/OAuth grant into the vault) | **D · R** | ▶ **the new big gap** — vault is real (KMS/local, AES-GCM) but nothing lets an operator SET a credential; prod has 0 rows |
| **Worker runtime in deploys** (feedback + Temporal worker actually running) | D · R | ▶ — compose `profiles: [worker]` never passed by bootstrap, and the standalone image trims the worker entrypoints; needs a Dockerfile worker target |
| Unified context (authored + ingested, scoped, versioned) | F | ▶ step 5 |
| Measurement / ROI (time saved, approval rate) | D · R · F | ◐ Phase 9 — Langfuse traces/cost only; no rollups |
| Durable workflow runner (all runs on Temporal `vocionWorkflow`) | D · R | ◐ — engine + `approvalSignal` exist; default dispatch still in-process |

**Read (updated):** the *capability* gap is closed — control plane, connector pack, gated writes, teams,
and event triggers are all in the code. What separates here from 1.0 is **activation**: (a) a way to put
**credentials** in the vault without psql, (b) the **worker actually running** in a deployment, (c)
**schedule dispatch wired** so source crons and scheduled workflows fire, and (d) the reference
deployments **running real data through the loop**. The live RevOps box proves it: 5 agents, 4 sources,
4 missions authored — and 0 credentials, 0 documents, 0 runs. Ship activation, then harden from what
breaks.

## The milestone path

- **V-core — Platform foundation.** ✅ Steps 1–3: scoped retrieval, the permission model + one review
  queue, durable-ingestion core. (v1.26–v1.29.)
- **V-control — The control plane.** ✅ (v1.30–v1.34.) Tenant **Bearer tokens**, the **write API**
  routed through `authz`/the review queue (reviews + events), and **MCP over HTTP** on Bearer. An app
  (FirstHQ) or client integration can authenticate, start work, and approve through one shared
  authorization layer. *(OAuth sign-in for MCP + full resource CRUD deferred post-1.0.)*
- **V-connect — The connector pack.** ✅ code-complete (v1.31–v1.37): **HubSpot, Gmail, Slack, Drive,
  Google Ads, GA4** as real incremental connectors, credentials from the encrypted vault, sync
  checkpoints, `sourceSyncWorkflow` on Temporal. **One wiring gap carried into V-act:** nothing calls
  `ensureSourceSchedule`, so a source's cron never becomes a live Temporal schedule.
- **V-act — Activation** *(now — the current milestone).* Make the shipped capability reachable:
  1. **Credential onboarding** — dashboard page (+ CLI fallback) that puts a HubSpot token / Google
     OAuth grant / Slack token into the vault, per source, and triggers a first sync.
  2. **Worker in deploys** — a `worker` build target in the Dockerfile (standalone image trims the
     entrypoints today) + compose profile actually enabled; feedback worker + Temporal worker run as
     first-class containers.
  3. **Schedule dispatch** — `workspace:apply` + the sources route call `ensureSourceSchedule`
     (and delete on removal), so authored crons fire.
  4. **Model refresh** — default `main` role to **Fable 5** (`claude-fable-5`); keep Haiku 4.5 as
     classifier; align workspace defaults (RevOps `workspace.yaml` still says `gpt-5.4-mini`).
  Exit: a fresh deployment can go from `terraform apply` → connected sources → first scheduled sync →
  first gated action **without psql or SSH**.
- **V-ref — The reference deployments.** Light up **Metacto RevOps** first (agents.metacto.com is
  live but dark: 0 credentials → 0 documents → 0 runs), then **Daylyte**. Run them; harden from what
  actually breaks. Exit: both meet their acceptance bars (below).
- **V1.0 — Cut it.** Measurement/ROI surfaced (Phase 9 slice: approval rate, time-to-approve, cost per
  run), docs, polish, and the **pipeline-green track** resolved (see roadmap.md — CI workspace-target
  fix, test env, knip, semantic-release resumes cutting tags). Exit: **Vocion 1.0** — both reference
  deployments run in production, FirstHQ 1.0 builds on a stable contract.

## Acceptance — the two reference deployments

**Daylyte (PPC/CRO reporting):**
- Google Ads + GA4 + site data connect and sync incrementally, scoped to the Daylyte client.
- A weekly report mission drafts a client-ready PPC + CRO summary with recommendations and flagged
  anomalies, citing the scoped data; nothing from another client can appear.
- The report is human-approved (the unified review queue) before it's shared.

**Metacto RevOps:**
- HubSpot + Gmail + Slack connect; the Revenue Operations team runs the daily briefing + follow-up
  queue + CRM-hygiene workflows.
- Every external action (send, stage change, proposal) gates through the permission model into the one
  review queue, routed to the right human.
- Proof + buyer-language capture run weekly (the Revenue Insights teammate).

## What 1.0 does NOT require (deferred past 1.0)

- **Vocion Cloud** (hosting, seat billing, multi-region — Phase 11): the reference deployments are
  MetaCTO-run / self-hosted.
- **Enterprise** (SSO/SCIM, BYOM/BYOK, doc-level RBAC beyond client scope, compliance — Phase 13).
- **Marketplace / ecosystem** (Phase 12).
- Deep capability-proposal + agent-to-agent debate (Missions P4–P5).

Deferring these keeps 1.0 about *running real work safely*, not monetization or enterprise governance —
those come after the reference deployments prove the loop.
