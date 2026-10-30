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
| `name` | string | required | Display name, in plain words for what is done, to what — never the slug or a word like "continue", "keep moving" or "sweep" (`libs/work/plainNames.ts`). |
| `description` | string | — | One-line summary. |
| `goal` | string | required | The outcome the mission exists to produce. |
| `agent` | agent slug | required | The single agent that owns the mission. If it is a lead, its specialists are the team the runtime can hand off to. |
| `status` | `active` \| `disabled` \| `draft` | `active` | Whether the mission can run. |
| `version` | positive int | `1` | Bump when the charter changes materially. |
| `autonomyPolicy.level` | int 1–5 | `1` | How much a **planned** run may do without asking: 1 draft only, 2 ask before action, 3 act within rules, 4 manage a goal, 5 improve itself. Levels 1–2 gate every external task a planner made; 3+ let them run unless the task flags approval. A check (a scheduled or automation pass) is one analysis task and is never gated by the level: what it may do unattended is the trust ladder's (`trust.yaml`, an action's `approvalRequired`). |
| `successCriteria` | string[] | `[]` | How to tell the mission is being met. |
| `desiredArtifacts` | string[] | `[]` | What the mission should produce — a brief, a list, a draft. |
| `schedule` | 5-field cron, UTC | — | **Removed in 8.0** (ADR 0008): an error in a version-2 workspace. A version-1 workspace still loads it as the automation `<slug>-check` (same cron, UTC), with a warning, and drops it when an active automation already checks the mission on a schedule. `npm run migrate:automations` writes it as an automation. |
| `deliver` | `{email: true \| [addresses]}` | — | Where a check's result goes when the check **finishes**: the briefing it published is mailed (`true` = the workspace's accountable person). Nothing published sends nothing; a failed check sends a short note with the reason and the run, never an older briefing. |

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
deliver:
  email: true
```

Its cadence is an automation:

```yaml
slug: quarter-pipeline-weekly
when:
  schedule: '0 6 * * 1'
  timezone: America/Los_Angeles
do:
  checkMission: quarter-pipeline-watch
```

## When everything left waits on a person

A mission run whose remaining work is all blocked on asks stops spending rather than checking again
and again. Its agent calls `wait_for_answers` with the asks it is blocked on
([agent tools](../guides/agent-tools.md#waiting-on-answers--wait_for_answers)): one gate ask goes on
Needs you, and the run is `paused` (`pause_reason: waiting_on_asks:<gate>`) before its next task —
or, for a scheduled check with nothing left after this turn, the automation's ticks are skipped.
Answering the asks resumes it from that task on a durable job; the mission-run reaper leaves a
parked run alone however long the answer takes.

## A question for the whole team

A mission step is a turn of its owning agent, so a lead that needs its
specialists to argue a question out — not just answer one each — opens a
[team thread](../guides/team-threads.md) from that step with `open_team_thread`.
The thread is its own run (a `mission_run` with a `thread` column), names the
mission run it came from, and keeps its own cost: the step's run does not count
it again.

## Mission, workflow, or automation?

| Use | When |
|---|---|
| **Mission** | The work is open-ended and judgement-heavy, and the same responsibility recurs. |
| **[Workflow](./workflow.md)** | The steps are fixed and identical every run, even when agents do them: each `agent` step gives an agent one bounded task (ADR 0011). A mission that keeps running the same steps graduates to one. |
| **[Automation](./automation.md)** | You need to say *when* something happens. Missions and workflows carry no trigger logic of their own (a mission's legacy `schedule` loads as an automation). |

## Rules

- Slugs are unique across missions.
- `agent` must resolve to an agent in this workspace.
- `schedule` (version 1 only) must be a 5-field cron expression, read in UTC.
- An automation's `do.checkMission` must name a mission in this workspace.

## Related

[Agent](./agent.md) · [Workflow](./workflow.md) · [Automation](./automation.md) · [Team threads](../guides/team-threads.md)
