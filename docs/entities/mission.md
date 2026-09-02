# Mission — `missions/<slug>.yaml`

A mission is a standing responsibility owned by one agent: the goal, what good
looks like, and how much freedom the agent has. Missions hold no procedure and
no trigger logic — they are the *why*. Open-ended work belongs here rather than
in a workflow.

| | |
|---|---|
| **Path** | `missions/<slug>.yaml` |
| **Schema** | `MissionManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `mission` table |
| **Runtime** | `MissionService.startMission` — planner runs, plus single-turn check runs |
| **Surface** | `/dashboard/missions` |
| **Layering** | Composable — a base default can be patched with `extends: core` |

## Fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `slug` | slug | required | Stable id. |
| `name` | string | required | Display name. |
| `description` | string | — | One-line summary. |
| `goal` | string | required | The outcome the mission exists to produce. |
| `agent` | agent slug | required | The single agent that owns the mission. If it is a lead, its specialists are the team the runtime can hand off to. |
| `status` | `active` \| `disabled` \| `draft` | `active` | Whether the mission can run. |
| `version` | positive int | `1` | Bump when the charter changes materially. |
| `autonomyPolicy.level` | int 1–5 | `1` | How much the agent may do without asking. |
| `successCriteria` | string[] | `[]` | How to tell the mission is being met. |
| `desiredArtifacts` | string[] | `[]` | What the mission should produce — a brief, a list, a draft. |
| `schedule` | 5-field cron, UTC | — | When set, the owning agent checks the charter on that cadence: review current state, do only what's needed now, report. Each check is one mission run. |

## Example

```yaml
slug: quarter-pipeline-watch
name: Quarter Pipeline Watch
description: Keep the quarter's pipeline honest and escalate drift early.
goal: >-
  No open deal goes quiet for more than ten days, and the accountable human
  always knows the three things most at risk this week.
agent: revenue-lead
autonomyPolicy:
  level: 2
successCriteria:
  - Every deal quiet beyond ten days is flagged with a recommended move.
  - The weekly brief names risks with the records behind them.
desiredArtifacts:
  - A weekly risk brief with per-deal next actions.
schedule: '0 13 * * 1'
```

## Mission, workflow, or automation?

| Use | When |
|---|---|
| **Mission** | The work is open-ended and judgement-heavy, and the same responsibility recurs. |
| **[Workflow](./workflow.md)** | The steps are fixed and identical every run. |
| **[Automation](./automation.md)** | You need to say *when* something happens. Missions and workflows carry no trigger logic of their own — apart from a mission's own `schedule` for charter checks. |

## Rules

- Slugs are unique across missions.
- `agent` must resolve to an agent in this workspace.
- `schedule` must be a 5-field cron expression, interpreted as UTC.
- An automation's `do.checkMission` must name a mission in this workspace.

## Related

[Agent](./agent.md) · [Workflow](./workflow.md) · [Automation](./automation.md)
