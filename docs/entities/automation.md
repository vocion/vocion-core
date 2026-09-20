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
| `event` | string, e.g. `prospect.reply` | Fire when this event type is emitted. |
| `filter` | object | For event triggers: every key must equal the payload's value. |

`schedule` and `event` are mutually exclusive — exactly one is required.

#### Events Vocion emits itself

Any event type an API caller posts to `/api/v1/events` can be subscribed to.
These are the ones the server raises on its own:

| Event | Raised when | Payload |
|---|---|---|
| `source.sync_completed` | A source finishes a sync without failing. A run that completed with per-document errors still raises it; a run that failed does not. | `sourceId`, `sourceSlug`, `connector`, `incremental`, `created`, `updated`, `unchanged`, `tombstoned`, `errors`, `completedAt` (ISO) |
| `artifact.saved` | An artifact is created or a new version of it is written — by an agent, a person or a system pass. | `artifactId`, `kind`, `folder`, `title`, `version`, `change` (`created` \| `revised`), `authorKind`, `recordType`, `recordId` |
| `ask.decided` | A person answers an ask ([ask](./ask.md)) — approve, reject, an option, an "other", mark done. Raised from the one place a decision is written, so a plugin can act on the answer without polling; `filter` on `agentSlug` and `kind` to hear only your own. | `askId`, `kind`, `status`, `decision`, `followUp`, `agentSlug`, `teamSlug`, `groupKey`, `sourceRef`, `objectRefs` (`[{ type, id }]`, the records it was about — read it off the payload; not filterable), `decidedBy`, `decidedAt` (ISO) |

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

A Schedule paused in Temporal directly, with nobody on the record, shows on
the card as "paused in Temporal, not from here" — pause it in the app to put
a name on it, or resume it where it was paused.

## Rules

- Slugs are unique across automations.
- `when` must have exactly one of `schedule` or `event`; `do` exactly one of `workflow`, `checkMission`, or `job`.
- `do.prompt` requires `do.checkMission`.
- `agent`, when set, must resolve to an agent in this workspace.
- `do.checkMission` and `do.workflow` must resolve inside this workspace — a dangling target dispatches into a runtime "not found" on the very first fire, so it fails at check time instead.
- Cron expressions are five space-separated fields, UTC.

## Related

[Mission](./mission.md) · [Workflow](./workflow.md) · [Agent](./agent.md)
