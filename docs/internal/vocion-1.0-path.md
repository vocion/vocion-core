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
| **API control plane** (write API + tenant Bearer tokens) | **F** · D · R | ▶ step 4 |
| **MCP over HTTP + OAuth** (agent/tool plane, multi-tenant) | F · R | ▶ step 4 |
| **Connector pack** (Google Ads, GA4, HubSpot, Gmail, Slack, Drive) | **D · R** | ▶ Phase 5 — the big gap |
| Temporal ingestion wrapper (workflow + schedules) | D · R | ▶ step 3 follow-on |
| Unified context (authored + ingested, scoped, versioned) | F | ▶ step 5 |
| Measurement / ROI (time saved, approval rate) | D · R · F | ◐ Phase 9 |
| Triggers (schedule + webhook) | D · R | ◐ (event stub; durable runner ▶) |

**Read:** the *engine* is largely done (steps 1–3 + missions/tools/retrieval). The two things between
here and 1.0 are **(a) the control plane** so apps/clients drive the runtime, and **(b) the connector
pack** so it touches real data. Everything else is hardening.

## The milestone path

- **V-core — Platform foundation.** ✅ Steps 1–3: scoped retrieval, the permission model + one review
  queue, durable-ingestion core. (v1.26–v1.29.)
- **V-control — The control plane** *(next).* Step 4: tenant **Bearer tokens** + a **write API**
  routed through `authz`/the review queue, and **MCP over HTTP + OAuth**. Exit: an app (FirstHQ) or a
  client integration can authenticate, start work, and approve through one shared authorization layer.
- **V-connect — The connector pack.** The integrations both deployments need, as source plugins on the
  durable-ingestion pipeline + the Temporal wrapper (workflow + schedules): **Google Ads, GA4 /
  analytics, the site (CRO)** for Daylyte; **HubSpot, Gmail, Slack, Drive** for RevOps. + OAuth /
  credential vault. Exit: a real source connects, syncs incrementally on a schedule, and is retrievable
  client-scoped.
- **V-ref — The reference deployments.** Stand up **Daylyte** (PPC/CRO reporting workspace) and
  **Metacto RevOps** (the Revenue Operations team) as real Vocion workspaces; run them; harden from
  what actually breaks. Exit: both meet their acceptance bars (below).
- **V1.0 — Cut it.** Measurement/ROI surfaced (Phase 9), docs, polish, and the carryover blockers
  resolved (CI secrets so semantic-release cuts tags; migration generate). Exit: **Vocion 1.0** — both
  reference deployments run in production, FirstHQ 1.0 builds on a stable contract.

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
