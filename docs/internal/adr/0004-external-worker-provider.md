# ADR 0004 — External long-running workers as a fourth harness provider

- **Status:** proposed (arch-decision; needs human approval before any code)
- **Date:** 2026-09-08
- **Owners:** Chris Fitkin
- **Related:** ADR 0001 (deepagents runtime, "no checkpointer"), `packages/agent-runtime/README.md`,
  `src/services/missions/runtime.ts` ("Durable, crash-safe, multi-day sessions (Temporal) are Phase 2"),
  `docs/internal/roadmap.md` (long-running step support; durable agent sessions)
- **First customer:** the `vocion-workforce` supervisor (`bin/run.sh`) — a 24-hour loop of headless
  Claude Code cycles that today tracks itself in local files and a JSONL ledger.

## Context

Vocion runs one agent loop (LangChain deepagents) on three hosts, selected by
`agent.harness_config.provider` in `AgentService.ts`:

| provider | where the loop runs | contract |
|---|---|---|
| `local` | in-process (`services/agents/harness.ts`) | function call, SSE to the browser |
| `runtime` | `packages/agent-runtime` over HTTP (`VOCION_AGENT_RUNTIME_URL`) | `POST /invocations`, SSE |
| `agentcore` | same artifact on Bedrock AgentCore Runtime (`VOCION_AGENT_RUNTIME_ARN`) | SigV4 + SSE |

All three are **synchronous request/response**: core calls out and holds one HTTP response open
(15 s keepalives) until the turn ends. Everything above the loop assumes minutes, not hours:

- `executeMissionRun` is a sequential in-process `for` loop over `mission_run.plan.tasks`; a crash
  strands a task in `running` — there is no heartbeat, lease, worker id, or reaper.
- Signed `TenantClaim` TTL is 30 minutes (`claims.ts`); tool timeout defaults to 120 s;
  Temporal activities are 15–30 minutes.
- ADR 0001 decision 3: no LangGraph checkpointer; the virtual FS is rebuilt every turn.
- Cost is per agent per period (`agent_budget`), never per run; per-run cost lives only in Langfuse.
- `agent.agent_type` (`mission | workflow | operational`) is written by `workspace:apply` and read by
  nothing — it is not a dispatch key.

Meanwhile a real class of work is **hours-to-days long, owns its own state, and runs outside the
app**: headless coding agents (Claude Code `claude -p` loops, Codex, Devin-style workers), batch
research crawls, overnight data migrations. The `vocion-workforce` run is exactly this: cycles, a
ledger, a file-based approval queue, a learnings file — a hand-rolled copy of Vocion's own
`action_run`, `tool_call`, `learning`, and budget machinery, because Vocion has no place to put a
run that lasts longer than an HTTP request.

We want mixed mode: structured workflow/mission agents (today's providers) and long-running external
workers, side by side, under one registry, one review queue, one learnings store, one budget, one
audit trail.

## Decision (proposed)

Add a fourth provider, **`external`**, where **Vocion is the control plane and the worker owns
execution**. The worker is any process that can hold a bearer token and call HTTP.

1. **Dispatch.** `harness_config.provider: external` in `AgentService.ts`. Starting such an agent
   does not run a loop; it creates a `worker_run` row in `queued` and returns immediately. The worker
   is launched out of band (Temporal Schedule, an `automation`, a human, or CI) and claims the run.
2. **New table `worker_run`**, modeled on `source_sync_checkpoint` (the only resumable-work table in
   the schema today: opaque `cursor`, `since`, `counts`, `failures[]`), plus what it lacks:
   `workerId`, `attempt`, `leaseExpiresAt`, `heartbeatAt`, `progress` (JSONB, worker-defined),
   `tokens`, `cents`, `capCents`, `endsAt`, `status` (`queued | running | paused | awaiting_review |
   completed | failed | cancelled | lost`), `workspaceSha`, `langfuseTraceId`.
   Vocion stores **checkpoints and progress, not the worker's working state**; the worker keeps its
   own state (files, git, its own DB). This keeps ADR 0001's "no checkpointer" decision intact for
   the in-process loop and scopes durability to where it is cheap.
3. **Worker API** (bearer `vcn_live_*` token scoped to one agent slug, issued by `tokens:issue`):
   `POST /api/v1/worker-runs/:id/claim` (lease), `/heartbeat` (extends lease, reports `progress`,
   `tokens`, `cents`), `/checkpoint` (opaque cursor + counts), `/complete`, `/fail`. Heartbeat also
   returns control signals: `{stop: bool, paused: bool, capRemainingCents, endsAt}` so the worker
   learns about a kill switch or budget exhaustion without polling anything else.
4. **Reuse, do not duplicate.** Side effects go through `propose_action` → `action_run` (already the
   durable gated queue with confidence envelope and dedupKey); learnings through the existing
   `add_learning` tools; both already exist over MCP, so a Claude Code worker gets them by adding the
   Vocion MCP server. `withToolCallRecord` already stamps `provider` — `external` just works, giving
   one `tool_call` audit trail across all four providers. Reported usage feeds `BudgetService.
   chargeUsage`, so the agent's daily/monthly caps apply to external workers too.
5. **Reaper.** A Temporal cron (or the first registered `job` in `services/jobs/registry.ts`, which is
   currently empty) marks runs with `leaseExpiresAt < now()` as `lost` and emits a review item.
   `ReviewKind` gains `worker` so lost or `awaiting_review` runs land in the same `/dashboard/review`.
6. **Progress, not tokens.** External workers emit coarse `progress` events, not `response_delta`.
   The frozen `AgentEvent` union in `agent-runtime/src/contract.ts` is untouched; the dashboard gets a
   run detail page reading `worker_run.progress` and its `tool_call` rows.
7. **Claims.** Refresh rather than lengthen: `/heartbeat` returns a fresh 30-minute `TenantClaim`
   for tool calls to `/api/internal/agent-tools`, keeping the "useless if leaked" property.

## What this deliberately does not do

- It does not make missions long-running. `mission_run` stays the planner/task-graph model for
  in-app agents; a mission task *may* spawn a `worker_run` and await it (later phase).
- It does not host the worker. No container, no AgentCore runtime, no process supervision in core.
  Hosting is the worker's problem (tmux + `caffeinate` today; a Fargate task or GitHub Action later).
- It does not add a checkpointer to the deepagents loop.

## Alternatives considered

- **Long Temporal activities wrapping the worker** — puts the hours-long lifetime inside Temporal's
  retry semantics and hides cost/progress; heartbeats would be reinvented anyway.
- **A new `agent_type: worker` value** — `agent_type` is decorative; dispatch already keys on
  `provider`, and a worker is a *host* difference, not a *work mode* difference.
- **Keep external runs outside Vocion** (status quo) — the workforce run has already re-implemented
  approvals, ledger, learnings, and budget as files; that is the strongest signal this belongs in core.

## Consequences

- One review queue, one learnings store, one budget, one `tool_call` audit trail across in-app agents
  and external workers. The "zero-person company" run becomes a Vocion-managed agent instead of a
  shell script beside it — and a public demo of the feature.
- New surface to secure: worker tokens must be agent-scoped and revocable; heartbeat payloads are
  untrusted input; `lost` runs must not be silently resurrected by a stale worker (attempt counter).
- Schema migration (one table, one `ReviewKind` member), one router, one reaper, dashboard page.
  Estimated as a single large PR behind a feature flag; no change to existing providers.

## Phases (if approved)

1. `worker_run` table + worker API + token scoping + reaper. Feature-flagged.
2. `vocion-workforce/bin/run.sh` reports heartbeat/progress/complete; approvals and learnings via the
   Vocion MCP server; local files remain the fallback.
3. Dashboard run page; `ReviewKind = worker`; Temporal Schedule launcher for a documented worker
   image; `docs/entities/worker-run.md` + a public "long-running agents" doc page.
