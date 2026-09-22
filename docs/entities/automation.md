# Automation — `automations/<slug>.yaml`

An automation binds a trigger to a piece of work. It is the only place in a
workspace where time and events live: missions are pure goals, workflows are
pure procedures, and neither carries its own schedule.

| | |
|---|---|
| **Path** | `automations/<slug>.yaml` |
| **Schema** | `AutomationManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `automation` table |
| **Runtime** | A Temporal schedule or an event match, dispatched through `dispatchDo` |
| **Surface** | `/dashboard/automation` |
| **Layering** | Workspace-only — a base pack ships no automations |

## Fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `slug` | slug | required | Stable id. |
| `name` | string | — | Display name. |
| `description` | string | — | One-line summary. |
| `status` | `active` \| `disabled` | `active` | Whether the automation fires. |
| `agent` | agent slug | — | Owning agent. Optional for `checkMission` (the mission already names its owner); set it for `workflow` and `job` automations so the schedule rolls up to a visible agent instead of running ownerless. |
| `when` | object | required | Exactly one of `schedule` or `event`. |
| `do` | object | required | Exactly one of `workflow`, `checkMission`, or `job`. |

### `when`

| Field | Type | What it does |
|---|---|---|
| `schedule` | 5-field cron, UTC | Fire on a cadence. |
| `event` | string or string[], e.g. `prospect.reply` or `[worker_run.completed, pr.merged]` | Fire when this event type — any of these types — is emitted. |
| `filter` | object | For event triggers: every key must equal the payload's value. |
| `maxFiresPer10m` | integer ≥ 1 | For event triggers: the most fires in a rolling ten-minute window. Default **6**. Beyond it the fires are held and coalesced into one run after the window (below). Workspace-overridable like any field — `extends: core` on the automation's slug. |

`schedule` and `event` are mutually exclusive — exactly one is required.
`maxFiresPer10m` is only allowed with `event`; a schedule fires on its cron.

**An automation never fires on its own run's event.** Every fire stamps
itself on the work it starts — `mission_run.caused_by` carries the chain of
fires behind a run, newest first: `[{ automationSlug, automationRunId,
missionRunId }]` — and the work stamps that chain on every event it raises
(`event_log.caused_by`). When an event is dispatched, an automation whose slug
is anywhere on the chain is skipped. An automation is also skipped when the
mission run that completed belongs to the mission it checks
(`do.checkMission === payload.missionSlug`), so a run from before the chain
existed closes the same loop. The rules live in
`packages/core/src/services/automations/fireGuards.ts`. Each refusal is a row
in the run log — `kind: skipped`, `status: ok`, `result.reason:
self_trigger`, with the rule in `result.detail` and the chain in
`result.causedBy` — so "why did the debrief not run on that" reads from the
log. A refusal is not a fire: it is not a card's "last run".

This is what stopped on 20 September 2026: `wiki-debrief` on
`mission_run.completed` was itself a mission check, and each check's
completion fired it again — sixty runs in minutes. A different automation on
the same event still fires; only the one whose run raised it is held back.

**The ceiling.** Past `maxFiresPer10m` event fires in ten minutes (schedule
fires, test runs and refusals are not counted), a fire is held: a `skipped`
row with `result.reason: rate_limited` and the ceiling, and one Temporal
`automationFire` workflow (`coalesce: true`, one per automation) is arranged
for after the window. A second held fire while one is waiting finds it there
and arranges nothing — that is the coalescing. When the coalesced fire runs it
claims the held rows (`result.coalescedInto: <its run id>`), its own result
carries `coalesced: n`, and a mission check's brief says how many it covers.
The card shows "rate limited — n fires held in the last 10 minutes (ceiling
6)" while the window is live. Temporal being unreachable does not undo the
hold; the row says `coalesce: unreachable` and the held fires are not
replayed.

**Debriefs.** An automation on a completion event — `worker_run.completed`,
`worker_run.failed`, `mission_run.completed`, `conversation.ended`,
`automation_run.completed`, `pr.merged` — is a debrief: work finished, and an
agent reads it back into the record. An agent authored `initiative: low`
([agent](./agent.md#behaviour)) sits debriefs out: its automations on these
events are skipped, not fired and not logged as refused. A schedule or any
other event is unaffected.

#### Events Vocion emits itself

Any event type an API caller posts to `/api/v1/events` can be subscribed to.
These are the ones the server raises on its own:

| Event | Raised when | Payload |
|---|---|---|
| `source.sync_completed` | A source finishes a sync without failing. A run that completed with per-document errors still raises it; a run that failed does not. | `sourceId`, `sourceSlug`, `connector`, `incremental`, `created`, `updated`, `unchanged`, `tombstoned`, `errors`, `completedAt` (ISO) |
| `artifact.saved` | An artifact is created or a new version of it is written — by an agent, a person or a system pass. | `artifactId`, `kind`, `folder`, `title`, `version`, `change` (`created` \| `revised`), `authorKind`, `recordType`, `recordId` |
| `ask.decided` | A person answers an ask ([ask](./ask.md)) — approve, reject, an option, an "other", mark done. Raised from the one place a decision is written, so a plugin can act on the answer without polling; `filter` on `agentSlug` and `kind` to hear only your own. | `askId`, `kind`, `status`, `decision`, `followUp`, `agentSlug`, `teamSlug`, `groupKey`, `sourceRef`, `objectRefs` (`[{ type, id }]`, the records it was about — read it off the payload; not filterable), `decidedBy`, `decidedAt` (ISO) |
| `worker_run.completed`, `worker_run.failed` | An external worker's run ([worker run](./worker-run.md)) reaches a terminal status from the worker's own `complete` or `fail` call. `completed` also carries `status: cancelled` for a run that was asked to stop and stopped; a run the reaper marks `lost` raises nothing. | `workerRunId`, `agentSlug`, `kind`, `status`, `summary` (the worker's account, or the error; ≤500 chars), `recordType`, `recordId`, `attempt`, `cents`, `completedAt` (ISO) |
| `mission_run.completed` | A mission run's tasks all finish without failure and the loop settles it — once, from the one write that settles it. `mode` is `check` for an automation's own mission check and `planned` for a brief a person or the planner decomposed; a debrief filters `mode: planned` so it never fires on a check. | `missionRunId`, `missionId`, `missionSlug`, `title`, `agentSlug` (the team lead), `mode`, `summary` (the last task's output, ≤500 chars), `tasksTotal`, `tasksFailed`, `completedAt` (ISO) |
| `conversation.ended` | The `sweep-idle-conversations` job finds a conversation with no turn for its window (default 30 minutes) and stamps `ended_at`. The only way a conversation ends today — there is no close button — so a workspace that wants the event schedules the job (`do: { job: sweep-idle-conversations }`). A thread picked up again is open again and ends again later. | `conversationId`, `agentSlug`, `title`, `surface`, `messageCount`, `lastMessageAt` (ISO), `endedBy` (`idle`), `summary` (the title), `endedAt` (ISO) |
| `automation_run.completed` | A `checkMission` fire finishes and its check produced a result (a workflow or job fire raises nothing). A fire that this event itself started raises nothing, so a debrief on it cannot fire on its own check. | `automationRunId`, `slug`, `kind` (`mission_check`), `missionRunId`, `missionRunStatus`, `tasksOk`, `tasksFailed`, `summary`, `completedAt` (ISO) |
| `pr.opened`, `pr.synchronized`, `pr.checks_completed`, `pr.review_submitted`, `pr.merged`, `pr.closed`, `run.failed` | The `github` source polls (or its webhook receives) activity on the repositories a workspace lists. | `repo`, `number`, `url`, `headSha`, `branch`, `title`, `author`, plus per-event fields — `conclusion` and `failedChecks` on `pr.checks_completed`, `reviewState` on `pr.review_submitted`, `mergeSha` on `pr.merged`. Shapes in the [GitHub guide](../guides/github.md). |

Every payload field but `objectRefs` is a scalar, so any of them can be used in a `filter`:

```yaml
slug: reindex-handbook
name: Summarize the handbook after it syncs
when:
  event: source.sync_completed
  filter:
    sourceSlug: handbook
do:
  workflow: summarize-handbook
```

### `do`

| Field | Type | What it does |
|---|---|---|
| `workflow` | workflow slug | Run this workflow. |
| `checkMission` | mission slug | Run one check of this mission. |
| `job` | built-in job name | Run a deterministic server job — not an agent. Job names live in the server's registry and are validated there. |
| `prompt` | string | Marching orders for a `checkMission` fire: *what* to do on this cadence. The mission stays the standing context; the automation carries the instruction. Falls back to the generic scheduled-check brief when omitted. |
| `input` | object | Fixed input passed to the workflow run or job. |

Exactly one of `workflow`, `checkMission`, and `job` is required. `prompt` is
only allowed alongside `checkMission`.

#### Built-in jobs

| Job | What it does | Input |
|---|---|---|
| `daily-team-report` | Trailing-window team activity report — runs, spend and token weight per team and member, board/red-team runs, what needs a person, the latest workspace briefing. Stored as a workspace briefing; mailed when `VOCION_MAIL_ENABLED=1`. See [Email](../guides/email.md). | `to` (list, default: workspace `accountableUser`), `hours` (default 24), `mail`, `publish` |

```yaml
slug: daily-team-report
name: Daily team report
agent: ceo
when:
  schedule: '0 13 * * *'
do:
  job: daily-team-report
  input:
    hours: 24
```

## Example

```yaml
slug: monday-pipeline-check
name: Monday Pipeline Check
status: active
when:
  schedule: '0 13 * * 1'
do:
  checkMission: quarter-pipeline-watch
  prompt: >-
    Review deals that moved or went quiet since last Monday. Name the three
    biggest risks and the one move you'd make on each.
```

Event-driven, running a workflow:

```yaml
slug: reply-followup
name: Inbound Reply Follow-up
agent: revenue-lead
when:
  event: prospect.reply
  filter:
    stage: discovery
do:
  workflow: discovery-followup
```

## Pausing and resuming

An automation can be held from the app — **Pause** on its card at
`/dashboard/automation` and on its page at `/dashboard/automation/<slug>` —
and released the same way with **Resume**. The hold is a person's act, so it
is recorded as one: who, when, and the note they left.

| | |
|---|---|
| **Who can** | Any signed-in member of the project — the same guard the mission mutations use (`guardAuth`). The actor is taken from the session, never from the request. |
| **What it does** | A `schedule` automation's Temporal Schedule is paused (`handle.pause`), with the person and note written into the Schedule's own note so Temporal's UI agrees. An `event` automation is skipped by the event matcher while paused. Either way `beginAutomationFire` refuses a fire that reaches it — a test run, a CLI call, a Schedule Temporal never saw paused — and records the refusal as an `error` run, the way a `disabled` automation's is. |
| **What is recorded** | On the row: `paused_at`, `paused_by` (the `user.id`), `paused_note`. In the run log: a synthetic run of kind `control`, status `ok`, `invoked_by: user:<id>`, whose `result` names the action (`pause` \| `resume`), the person (id and name, so it reads after the account is gone), the note, and how the Schedule took it (`paused` \| `resumed` \| `unreachable` \| `null` for an event-when). A resume also records the pause it lifted. |
| **What is shown** | "Paused by *name* *when*: *note*" on the card and the detail page, and one row per pause and resume in the run log, filterable with `kind=control`. A `control` row is not a fire: it does not count as "last run" and does not reset the overdue clock. |
| **Surface** | `client.automations.pause({ slug, note? })` / `client.automations.resume({ slug, note? })`. Pausing a paused automation (or resuming a running one) answers `CONFLICT` — the state on screen is stale. |
| **Over the API** | `POST /api/v1/automations/:slug/pause` `{ note }` (the note is required — an emergency stop with no reason is the row nobody can act on later) and `POST /api/v1/automations/:slug/resume` `{ note? }`. Tenant token or session, role owner or PM (a `['*']` grant passes). The row names the token (`token:<id>`, "API token <id>"). 404 for an unknown slug, 409 (`AUTOMATION_STATE`) when the state already is what was asked. `GET /api/v1/automations` lists every automation with `status`, `paused`, `lastFire` and `skips` — what the guards refused in the last ten minutes. |
| **Over MCP** | `automation_pause { slug, note }` and `automation_resume { slug, note? }` — the same service path, the row naming the MCP identity. To find what to stop: `mission_list_runs { status: running, missionSlug?, limit ≤ 200 }` returns `{ runs, total }`, each run with its `causedBy` chain; `GET /api/v1/mission-runs?status=running&limit=` is the REST twin, and `POST /api/v1/mission-runs/:id/cancel { reason? }` (409 on a settled run) or `mission_cancel` stops one. |

**What apply does to a paused automation.** Nothing to the pause. `status`
is what the YAML says and is replaced on every apply; the pause lives beside
it and `workspace:apply` never writes those columns. Schedule reconciliation
creates the Temporal Schedule paused if Temporal never had it, re-asserts the
pause if it did, and never unpauses one — apply does not resume what a person
stopped. The apply summary names each one as a warning:
`automation/<slug>: paused by <name> at <when> UTC — <note>; left paused.`
Setting `status: disabled` in the YAML and a pause can both hold at once;
they are different statements (the author's, and an operator's), and each is
lifted by the one who made it.

**One pause, or twenty.** This pause holds one automation. The workspace has
its own switch that holds everything it does by itself — every automation
fire, every mission run, every worker run, every gated action — in one act,
and it is the right control for "stop", where this one is the right control
for "this debrief is noisy". The two are different facts and never touch each
other: a workspace pause writes no automation row, so resuming the workspace
leaves an automation you paused last week still paused. While the workspace
is held, a matched event writes a `skipped` run with reason
`workspace_paused` against each automation it would have fired, so the run
log says why the afternoon is empty. See
[the off switch](./workspace-manifest.md#the-off-switch--pausing-the-whole-workspace).

A Schedule paused in Temporal directly, with nobody on the record, shows on
the card as "paused in Temporal, not from here" — pause it in the app to put
a name on it, or resume it where it was paused.

## Rules

- Slugs are unique across automations.
- `when` must have exactly one of `schedule` or `event`; `do` exactly one of `workflow`, `checkMission`, or `job`.
- `when.maxFiresPer10m` requires `when.event`.
- An automation is never fired by an event its own run raised, nor by a completed run of the mission it checks; past `when.maxFiresPer10m` event fires in ten minutes the fires are coalesced into one.
- `do.prompt` requires `do.checkMission`.
- `agent`, when set, must resolve to an agent in this workspace.
- `do.checkMission` and `do.workflow` must resolve inside this workspace — a dangling target dispatches into a runtime "not found" on the very first fire, so it fails at check time instead.
- Cron expressions are five space-separated fields, UTC.

## Related

[Mission](./mission.md) · [Workflow](./workflow.md) · [Agent](./agent.md)
