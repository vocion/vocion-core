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
- **The API.** `POST /api/v1/worker-runs` with `{ agentSlug, input?, endsAt?, capCents?, leaseSeconds?, kind?, model? }`.

`kind` says what sort of run this is, so the team report can tell judgement about the work from the
work itself. One of:

| kind | Meaning |
|---|---|
| `worker` | One dispatched job — the default, and what every run created before `kind` existed means. |
| `lead` | A lead's planning / dispatch cycle. |
| `board` | The board-level review of the whole company (badged on every surface). |
| `red-team` | An adversarial grade of finished work (badged on every surface). |
| `compact` | Bookkeeping — digests, compaction. |
| `snapshot` | A periodic state report carrying counts, not work. |

`model` is the model expected to do the work; the first heartbeat that reports `usage.model`
overrides it, so the row ends up naming the model that actually ran.

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
| Complete | `POST /worker-runs/:id/complete { workerId, result?, counts?, summary? }` | Terminal. A run that had been asked to stop is recorded as `cancelled`. `summary` is the worker's own one-paragraph account, shown on the team report. |
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

## Counts — what a worker says about its work

`counts` is a flat `Record<string, number>` the worker sends on heartbeat and complete
(`{ prsOpened: 2, drafts: 1 }`); keys merge, so a worker can report incrementally. Two things read
it: the run's row on the member page, and **team measures** — a measure whose source is
`{ kind: agent-reported, counts: <key> }` in `teams/<slug>.yaml` sums that key over the team's agents,
and `{ kind: observed, counts: <key> }` counts the completed runs that reported it. Whatever a worker
counts can become a measure the team is graded on — labelled as the worker's own report, which is the
weakest provenance the report shows. See [Team](./team.md) and
[Team performance](../guides/team-performance.md).

## Cost

Per run: `tokens` and `cents` accumulate from what the worker reports. Per agent: reported `usage`
is also charged to the agent's period budget (`agent_budget`), so the caps a workspace already sets
apply to external work too. `capCents` on the run is a second, per-run ceiling.

**Per record.** A run queued *for* an object — `input: {record: {type: '<object type slug>', id:
<object id>}, …}` on create — writes its cost onto that object when it ends (`complete` or `fail`;
a failed attempt still cost money). Core sums `cents` over every run queued for the same record and
writes the sum as `metadata.actualCents`, with `costUpdatedAt`, and when the record carries an
`estimateCents` (or, failing that, the run had a `capCents` to stand in for one) writes
`estimateCents` and `varianceCents` (actual minus estimate) beside it. The figure is recomputed from
the rows, never incremented, so a task picked up three times is charged for three runs, once. Any
`rollups` the org's object types declare over that record's type are recomputed in the same moment
([Object type](./object-type.md)). Best effort: a write-back that fails is logged and never hands
the worker an error for work it finished. A run without a record lands on nothing.

## What it deliberately does not do

It does not make missions long-running, does not host the worker, and does not add a checkpointer
to the in-process loop. Vocion stores checkpoints and progress, not the worker's working state.

## Surfaces

- **Team report** (`/dashboard/team-report`) — the team's operating cost in a window (24h / 7d /
  30d), agent-reported and observed measures read from `counts`, and — under Evidence — activity by
  member with tokens, and per-member run lists with the worker's `summary`. Board and red-team runs
  are badged wherever runs are counted.
- **The work item** (`/dashboard/p/feature/<requestId>`): every run under the request, grouped by
  the task it was an attempt at (the Factory log page went on 2026-09-24; the runs read inside the
  outcome they served). A run's `status` column is read there as the four independent facts it was carrying
  (`libs/factory/runFacts.ts`, no migration): **execution** (`completed` | `failed` |
  `cancelled`, where a worker that ran the whole task and then lost its completion call
  executed completely), **verification** (`passed` | `failed` | `not_run`, where a run that
  never reached a check did not fail one), **output** (`pull_request` | `work_preserved` |
  `no_changes` | `none`) and task **disposition** (`accepted` | `rejected` | `retried` |
  `open`, which is a property of the group). Beside them, why an unsuccessful run was
  unsuccessful (`contract`, `environment`, `verification`, `worker`, `control`) and whether
  the factory recovered on its own (retried and accepted N minutes later, work preserved on
  a pull request, or unresolved).
- **Feature report** (`/dashboard/p/feature/<requestId>`, the `report` archetype —
  [`docs/workspace-pages.md`](../workspace-pages.md)) — every run queued for one request's tasks,
  in order, with its agent, attempt, duration, cost and checks, and on a failure the kept branch
  and draft pull request from its last heartbeat's `progress`. A run whose `status` is `failed`
  and whose pull request merged is shown as both facts and flagged rather than reconciled: a
  worker's completion call can time out after its pull request is already open, and the two
  records then disagree honestly. Activity reads the same pair through `runFacts` instead,
  which resolves it into "execution completed, verification passed, pull request opened"
  rather than leaving the reader to reconcile it. A run is found for a request through
  `input.record = {type: 'engineering_task', id}` — a run queued with no record appears on no
  report.

## Operations

- **Reaper:** a Temporal schedule (`worker-run-reaper`, every 5 minutes) marks lapsed leases `lost`.
  Applied on every worker boot; removed when the flag is off.
- **Table:** `worker_run`, migration `0081`; `kind`, `model`, `summary` added in `0092`. Indexed by
  `(org_id, status)`, `(org_id, agent_slug)`, and `(status, lease_expires_at)` for the reaper.
- **Decision record:** `docs/adr/0004-external-worker-provider.md`.
