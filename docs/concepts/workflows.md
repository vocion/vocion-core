# Workflows

Workflows compose skills + HITL gates + connector actions into triggered sequences. They're the "automations" layer of CoreContext — skills do one thing, agents hold a conversation, workflows orchestrate.

**Status:** v1 — manual + event triggers; step types `skill`, `approve`, `action` (action is stubbed). Schedule + webhook triggers, concrete action library, and Temporal-backed durability arrive with Phase 6.

## When to use a workflow

- **Multi-step flow** — draft → review → send is a workflow. One prompt call is a skill.
- **Human in the loop** — you want to pause for approval between draft + send
- **Event-driven** — "when a new discovery call ends, run this sequence"
- **Composable reuse** — the same 3-step pipeline powers 5 different entry points

## Authoring

```
context/<org>/workflows/<slug>/
└── workflow.yaml
```

Minimal shape:

```yaml
slug: discovery_followup
name: Discovery Follow-up
description: Post-discovery-call automation.
version: 1
status: active # active | disabled | draft
trigger:
  type: manual # manual | event
inputSchema: # JSON Schema for manual-trigger inputs (optional)
  type: object
  required: [transcript, prospect_name]
  properties:
    transcript: {type: string}
    prospect_name: {type: string}
steps:
  - name: summary
    type: skill
    skill: discovery_summary
    input:
      transcript: '{{input.transcript}}'

  - name: email
    type: skill
    skill: draft_followup_email
    input:
      discovery_summary: '{{steps.summary.output}}'
      prospect_name: '{{input.prospect_name}}'

  - name: review
    type: approve
    prompt: Review the drafted follow-up email before sending.
    reviews: email # optional — names the step being reviewed

  - name: send
    type: action
    action: gmail.send_email
    input:
      to: '{{input.prospect_email}}'
      subject_from_step: email
      body_from_step: email
```

Apply: `npm run context:apply`.

## Step types

| Type | Purpose | Pauses? |
|---|---|---|
| `skill` | Invoke a registered skill. Output available as `{{steps.<name>.output}}` for subsequent steps | no |
| `approve` | HITL gate — workflow pauses, caller resumes via `workflow_run_resume` after approval | **yes** |
| `action` | Connector-backed side effect (email, CRM update, DocuSign). **v1: stubbed** — records intent, no real effect | no |

## Interpolation

Any string value in `input` / `skill input` can reference:

- `{{input.x}}` — initial input provided at start
- `{{steps.<name>.output}}` — whole output of a prior step (types preserved)
- `{{steps.<name>.output.<field>}}` — specific field
- `{{trigger.<key>}}` — trigger-context metadata

**Whole-string vs embedded:**
- `'{{input.id}}'` → returns the raw value (number, object, etc.) — type preserved
- `'hi {{input.name}}!'` → returns a string with the value substituted in

## Triggers

| Trigger | Status | Notes |
|---|---|---|
| `manual` | ✓ v1 | Started via `workflow_run_start` MCP tool or UI button |
| `event` | schema only | `{type: event, event: 'object.created.discovery_call'}` — event bus wiring lands with Phase 6 |
| `schedule` | future | cron expressions |
| `webhook` | future | HTTP endpoint per workflow |

For v1 the common path is manual. Event-driven workflows will be how you react to "Zoom meeting ended" or "new HubSpot lead" without polling — coming.

## Execution model

- One `workflow_run` row per execution
- Steps execute sequentially
- Each step's result lands in `workflow_run.step_results` (JSONB) keyed by step name
- On `approve`: run is marked `paused`, `pauseReason = awaiting_approval:<step_name>`. `workflow_run_resume` flips it back and advances past the approve step.
- On any step throwing: run is marked `failed` with the error message; subsequent steps don't execute.
- **Not yet durable** — if the process crashes mid-run, the run is stuck at last persisted state. Fine for MetaCTO volume; Temporal-backed durability comes with Phase 6 scale-out.

## MCP tools

| Tool | Purpose |
|---|---|
| `workflow_list` | Every defined workflow + its trigger + step names |
| `workflow_get` | Full manifest for one workflow |
| `workflow_run_start` | Kick off a run. Returns the run (may already be paused or completed) |
| `workflow_run_list` | Recent runs, filter by slug or status |
| `workflow_run_get` | Full run detail with per-step results |
| `workflow_run_resume` | Continue a paused run after approval |
| `workflow_run_cancel` | Stop a run permanently |

## Audit trail

Every `workflow_run`:
- Stamps `context_sha` at start (so you can answer "what was the workflow definition when this ran?")
- Records `createdBy` (user id or `'mcp'` or `'workflow:<slug>:<runId>'` for nested)
- Per-step result includes `skillRunId` when the step was a skill — links back to `skill_run.langfuseTraceId` for observability

## Writing a new workflow

1. Define the YAML under `context/<org>/workflows/<slug>/workflow.yaml`
2. `npm run context:check` — validates without applying
3. `npm run context:apply` — persists to DB
4. `workflow_run_start { slug, input }` via MCP (or UI)
5. Iterate on the YAML, re-apply — existing runs keep their snapshot; new runs use the new definition

## What v1 can't do (on purpose)

- **Parallel steps** — all sequential. Fan-out arrives with Phase 6.
- **Real action side-effects** — `action` steps are stubs. Wiring the Gmail/HubSpot/DocuSign actions comes with the Source plugin v0.2.
- **Retries with backoff** — if a step fails, the run fails. No retry policy yet.
- **Nested workflows** — no calling one workflow from another. Planned.
- **Conditional branches** — no `if` or `case` step types. Planned.

## Reference

- `context/metacto/workflows/discovery-followup/workflow.yaml` — first real workflow, migrates the post-discovery-call flow from `requirements/ziggy-workflows.md`
- `src/services/WorkflowService.ts` — runner implementation
- `src/libs/context/schemas.ts` — `WorkflowManifestSchema` + step/trigger types
