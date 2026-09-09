# Worker run

A **worker run** is one long-running job executed by a process Vocion does **not** host — the
`external-worker` harness target from ADR 0004. Vocion is the control plane: it queues the run,
hands out a lease, records heartbeats, checkpoints and cost, and reaps a run whose lease lapses. The
worker owns its own working state (files, git, its own store) and reports in.

The first customer is a headless coding-agent loop that runs for a day on a laptop and opens pull
requests; the same shape fits a batch crawl, an overnight migration, or a browser-automation job.

Feature-flagged: nothing here is reachable unless the deployment sets `VOCION_EXTERNAL_WORKERS=1`.

## How a run gets created

Two ways, same row:

- **An agent whose `harness.runsOn` is `external-worker`.** Asking it something does not run a
  turn; it queues a run carrying the message and returns a receipt. Whatever the worker later
  proposes lands in the review queue like any other agent's, so nothing new can approve anything.
- **The API.** `POST /api/v1/worker-runs` with `{ agentSlug, input?, endsAt?, capCents?, leaseSeconds? }`.

```yaml
# agents/overnight-migrator.yaml
slug: overnight-migrator
name: Overnight migrator
harness:
  runsOn: external-worker
systemPrompt: |
  You are a worker, not a chat agent: your instructions arrive as the run's input.
```

## The protocol

All calls are authenticated with a tenant API token (or a dashboard session) and scoped to that
org. Worker-side calls must also present the `workerId` that holds the lease.

| Step | Call | What Vocion does |
|---|---|---|
| Claim | `POST /worker-runs/:id/claim { workerId }` | `queued` → `running`, `attempt` +1, lease starts. Checks the agent's period budget first (402 if over). Returns a short-lived **toolClaim** for `/api/internal/agent-tools`. |
| Heartbeat | `POST /worker-runs/:id/heartbeat { workerId, progress?, cursor?, counts?, usage?, failures? }` | Extends the lease, records progress and cost, charges `usage` to the agent's budget. Replies with the **control signals**. |
| Checkpoint | `POST /worker-runs/:id/checkpoint { workerId, cursor, … }` | Same contract as heartbeat; `cursor` required. |
| Complete | `POST /worker-runs/:id/complete { workerId, result? }` | Terminal. A run that had been asked to stop is recorded as `cancelled`. |
| Fail | `POST /worker-runs/:id/fail { workerId, error, failures? }` | Terminal. |
| Cancel | `POST /worker-runs/:id/cancel` | The human kill switch. `queued` cancels now; `running` sets `stopRequested`, which the worker learns on its next heartbeat. |

The heartbeat reply is the only channel back to the worker, so everything rides on it:

```json
{ "leaseExpiresAt": "…", "stop": false, "paused": false, "endsAt": "…", "capRemainingCents": 600, "toolClaim": "…", "status": "running" }
```

`stop` is true when a human cancelled, the per-run cap is spent, or the deadline passed. A worker that
ignores it will be marked `lost` when its lease lapses — Vocion cannot kill a process it does not host.

## Statuses

`queued` → `running` ⇄ `paused` → `completed` | `failed` | `cancelled`. Plus `lost`: the lease
lapsed without a heartbeat. A `lost` run can be re-claimed; `attempt` increments so the record shows
how many workers it took. Status is plain text, not an enum.

## Cost

Per run: `tokens` and `cents` accumulate from what the worker reports. Per agent: reported `usage`
is also charged to the agent's period budget (`agent_budget`), so the caps a workspace already sets
apply to external work too. `capCents` on the run is a second, per-run ceiling.

## What it deliberately does not do

It does not make missions long-running, does not host the worker, and does not add a checkpointer
to the in-process loop. Vocion stores checkpoints and progress, not the worker's working state.

## Operations

- **Reaper:** a Temporal schedule (`worker-run-reaper`, every 5 minutes) marks lapsed leases `lost`.
  Applied on every worker boot; removed when the flag is off.
- **Table:** `worker_run`, migration `0081`. Indexed by `(org_id, status)`, `(org_id, agent_slug)`,
  and `(status, lease_expires_at)` for the reaper.
- **Decision record:** `docs/adr/0004-external-worker-provider.md`.
