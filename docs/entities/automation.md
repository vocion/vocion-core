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

## Rules

- Slugs are unique across automations.
- `when` must have exactly one of `schedule` or `event`; `do` exactly one of `workflow`, `checkMission`, or `job`.
- `do.prompt` requires `do.checkMission`.
- `agent`, when set, must resolve to an agent in this workspace.
- `do.checkMission` and `do.workflow` must resolve inside this workspace — a dangling target dispatches into a runtime "not found" on the very first fire, so it fails at check time instead.
- Cron expressions are five space-separated fields, UTC.

## Related

[Mission](./mission.md) · [Workflow](./workflow.md) · [Agent](./agent.md)
