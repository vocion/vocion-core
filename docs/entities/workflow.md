# Workflow — `workflows/<slug>/workflow.yaml`

A workflow is a deterministic procedure: the same structure on every run. It is
the *how*, with human gates where a person has to look. Its steps may be
agents doing bounded tasks (ADR 0011). Anything open-ended belongs in a
[mission](./mission.md) instead. How the pieces fit, with a worked example, is
[the workflows guide](../guides/workflows.md).

| | |
|---|---|
| **Path** | `workflows/<slug>/workflow.yaml` — the filename is fixed as `workflow.yaml` (or `.yml`) |
| **Schema** | `WorkflowManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `workflow` table |
| **Runtime** | `WorkflowService.runLoop` |
| **Surface** | `/api/v1/workflows`, `/dashboard/workflows` |
| **Layering** | Workspace-only — a base pack ships no workflows |

## Fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `slug` | slug | required | Stable id. |
| `name` | string | required | Display name. |
| `description` | string | — | One-line summary. |
| `status` | `active` \| `disabled` \| `draft` | `active` | Whether the workflow can run. |
| `version` | positive int | `1` | Bump when the steps change materially. |
| `agent` | agent slug | — | Owning agent, so the procedure rolls up to a visible owner instead of running ownerless. It asks the `approve` steps' Decisions. |
| `runLabel` | string | — | What each run is called, interpolated from its input when it starts: `'{{input.batch_ref}} · page {{input.index}} of {{input.total}}'`. Stored on the run as `input.runLabel` and shown in the workflows pages, Activity, Needs you and the chat's running-work line. A caller may pass `runLabel` in the input itself. Absent: the workflow's name. |
| `trigger` | trigger object | required | How a run starts. See below. |
| `steps` | step[] (min 1) | required | The procedure, in order. |
| `inputSchema` | JSON Schema | — | Shape of the input for manual triggers. |

## Triggers

One of three shapes, keyed by `type`:

| Type | Fields | Behavior |
|---|---|---|
| `manual` | — | Started by a person or an API call. |
| `event` | `event` (e.g. `object.created`, `external.zoom.meeting_ended`), optional `filter` | Fires when a matching event is emitted. |
| `schedule` | `cron` (5 fields, UTC), optional `input` | Fires on a cadence, with fixed input passed to every run. |

## Steps

Every step has a `name` (slug, unique across the workflow, inside a repeat
group or not) and a `type`, and may have:

| Field | What it does |
|---|---|
| `label` | What a person reads while the step runs, interpolated: `Editor review`. Inside a repeat group the round is added ("· round 2 of 3") unless the label reads `{{repeat.*}}` itself. Absent: the first sentence of the step's task or prompt. |
| `when` | A [condition](#conditions). The step is skipped when it is false, and says why on the run. |

Six types exist:

| Type | Fields | What it does |
|---|---|---|
| `agent` | `agent`, `task`, optional `output`, `effort`, `tools` | One agent does one bounded task (ADR 0011). See below. |
| `repeat` | `steps`, `until`, `max`, optional `onExhausted` | Runs its steps again until `until` holds, at most `max` rounds. See below. |
| `approve` | `prompt`, optional `reviews` | Pauses on a Decision (`ask`, kind `approval`) on Needs you. `reviews` names the earlier step whose output is laid out on the card. Approving resumes the run; rejecting or skipping stops it. |
| `ask` | `prompt`, optional `default`, optional `outputAs` | Pauses until a human supplies text. When `default` interpolates to a non-empty string, the step completes with that value and never pauses — so one workflow serves both an automated caller and a person starting it by hand. `outputAs` names the variable (defaults to the step name). |
| `action` | `action` (registered id, e.g. `gmail.send`), `input` | A connector-backed action. `workflow.start` (one child run per item) and `routine.run` (a routine batch) run; other ids record what they would do. |
| `sync` | `sources` (min 1) | Incrementally syncs the named sources first, so later steps read live data instead of a stale index. Per-source failures degrade gracefully: the step records them and the run continues on the existing index. |

There is no `skill` step. Skills are read by the agent on its own judgement —
see ADR 0003. An `agent` step gives an agent a task and leaves the method to
it — see ADR 0011.

Registered action ids are listed in [trust rules](./trust.md); the source of truth is `packages/core/src/libs/actions/`.

### `agent`

| Field | Type | Default | What it does |
|---|---|---|---|
| `agent` | agent slug | required | Who does the task. Must resolve in this workspace. |
| `task` | string | required | The instruction, interpolated: `Research Google's top results for page {{input.page_id}} and save the SERP brief`. |
| `output` | JSON Schema, `type: object` | — | The result's shape. The agent must end with one JSON object of it; it is validated, and a wrong shape gets one corrective turn naming the problem before the step fails. Read as `{{steps.<name>.output.<field>}}`. Absent: the output is the reply's text. Compiled at `workspace:check`. |
| `effort` | `auto` \| `quick` \| `standard` \| `deep` | `auto` | The turn's envelope: model, thinking, and its time and spend ceilings (`services/agents/effort.ts`). |
| `tools` | tool names | the agent's own | Only these tools this turn. The agent's grants and exclusions apply first; its skills stay readable. |

The turn runs as `workflow:<slug>:<runId>`, charged to the run (`model_call.run_kind = workflow_run`). The step records `agent`: the model that answered, the effort, the cost, the tool calls and every try at the result with its trace.

### `repeat`

| Field | Type | Default | What it does |
|---|---|---|---|
| `steps` | `agent` \| `action` \| `sync` steps (min 1) | required | Run in order, each round. No gates, no nested groups. |
| `until` | condition | required | Checked after each of the group's steps; the group stops as soon as it holds. |
| `max` | int 1–10 | required | The most rounds. |
| `onExhausted` | `continue` \| `fail` | `continue` | When `max` rounds ran and `until` never held: go on to the next step, or fail the run. |

Inside the group, `{{repeat.round}}` and `{{repeat.max}}` are readable, and a
step's earlier rounds are kept on its result (`previous`). Afterwards the
group's output is `{ rounds, satisfied, exhausted }`.

## Interpolation

String fields support `{{input.x}}`, `{{steps.<name>.output.y}}`,
`{{trigger.y}}`, and inside a repeat group `{{repeat.round}}` and
`{{repeat.max}}`. A string that is one reference keeps the value's type (a
list stays a list); a reference inside text is written as text, and a missing
one as nothing. A `{{steps.<name>…}}` naming no step fails at check time.

## Conditions

`when` and `until` are one comparison or one value
(`libs/workflows/expressions.ts`):

| Form | Example |
|---|---|
| `a == b` | `"{{steps.review.output.verdict}} == 'pass'"` |
| `a != b` | `"{{input.target}} != 'none'"` |
| `a` | `"{{steps.check.output.ready}}"` — true unless missing, empty, `false`, `0`, `no`, or an empty list or object |

Each side is a reference, a quoted string, a number, `true`, `false` or `null`.
Values compare as text, and a missing value reads as empty. Anything else is
refused at check time.

## Runs

One `workflow_run` per execution, owned by a durable run that survives
restarts. Every finished step is written before the next starts, so a restart
re-runs only the step it interrupted (its `attempt` counts the starts; a third
interruption fails it). `step_results` is keyed by step name
(`libs/workflows/stepResult.ts`): status (`running`, `completed`, `failed`,
`skipped`, `awaiting_approval`), label, output, and per type the agent's
record, the repeat group's place, a skipped step's condition and an approve
step's Decision. A child started by `workflow.start` carries
`trigger.parentRunId`.

## Example

A full pipeline with agent steps, a bounded review and fan-out is in
[the workflows guide](../guides/workflows.md#worked-example-an-seo-page-pipeline).

```yaml
slug: discovery-followup
name: Discovery Follow-up
description: Turn a discovery call into an approved follow-up email.
agent: revenue-lead
trigger:
  type: schedule
  cron: '0 12 * * 1-5'
steps:
  - name: refresh-mail
    type: sync
    sources: [gmail]
  - name: transcript
    type: ask
    prompt: Paste the discovery call transcript.
    default: '{{input.transcript}}'
  - name: review-draft
    type: approve
    prompt: Approve the follow-up email before it sends.
    reviews: transcript
  - name: send
    type: action
    action: gmail.send
    input:
      body: '{{steps.review-draft.output.body}}'
```

## Rules

- Slugs are unique across workflows.
- At least one step is required.
- Step names are unique within a workflow, repeat groups included, and every `{{steps.<name>…}}` names one of them.
- An `agent` step's `agent` must resolve in this workspace, and its `output` must compile as JSON Schema with `type: object`.
- A `repeat` holds only `agent`, `action` and `sync` steps and needs `max` (1–10).
- `when` and `until` must parse as conditions.
- `agent`, when set, must resolve to an agent in this workspace — a dangling owner is a silent no-op in the UI, so it fails at check time.
- `cron` must have five space-separated fields.
- An automation's `do.workflow` must name a workflow in this workspace.

## Related

[Workflows guide](../guides/workflows.md) · [Mission](./mission.md) · [Automation](./automation.md) · [Source](./source.md) · ADR 0003 · ADR 0011
