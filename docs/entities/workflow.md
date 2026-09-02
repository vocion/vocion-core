# Workflow — `workflows/<slug>/workflow.yaml`

A workflow is a deterministic procedure: the same structure on every run. It is
the *how*, with human gates where a person has to look. Anything open-ended
belongs in a [mission](./mission.md) instead.

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
| `agent` | agent slug | — | Owning agent, so the procedure rolls up to a visible owner instead of running ownerless. |
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

Every step has a `name` (slug) and a `type`. Four types exist:

| Type | Fields | What it does |
|---|---|---|
| `approve` | `prompt`, optional `reviews` | Pauses in the review queue for a human decision. `reviews` names the earlier step whose output is being judged. |
| `ask` | `prompt`, optional `default`, optional `outputAs` | Pauses until a human supplies text. When `default` interpolates to a non-empty string, the step completes with that value and never pauses — so one workflow serves both an automated caller and a person starting it by hand. `outputAs` names the variable (defaults to the step name). |
| `action` | `action` (registered id, e.g. `gmail.send`), `input` | Runs a connector-backed action. |
| `sync` | `sources` (min 1) | Incrementally syncs the named sources first, so later steps read live data instead of a stale index. Per-source failures degrade gracefully: the step records them and the run continues on the existing index. |

There is no `skill` step. Skills are read by the agent on its own judgement —
see ADR 0003.

Registered action ids are listed in [trust rules](./trust.md); the source of truth is `packages/core/src/libs/actions/`.

## Interpolation

String fields support `{{input.x}}`, `{{steps.<name>.output.y}}`, and
`{{trigger.y}}`.

## Example

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
- `agent`, when set, must resolve to an agent in this workspace — a dangling owner is a silent no-op in the UI, so it fails at check time.
- `cron` must have five space-separated fields.
- An automation's `do.workflow` must name a workflow in this workspace.

## Related

[Mission](./mission.md) · [Automation](./automation.md) · [Source](./source.md)
