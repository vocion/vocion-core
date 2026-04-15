# Workflows

> A **Workflow** is a sequence of Skills with optional human-in-the-loop approve gates. It's how you compose single-step capabilities into an end-to-end process.

## What it does

Every workflow is a small DAG of steps. Three step types today:

- `skill` — invoke a Skill with interpolated input, capture output
- `approve` — pause, route to the Review Queue, resume on decision
- `action` — call a side-effecting adapter (gmail.send_email, hubspot.update_deal, …)

State persists in `workflow_run` rows; each step's result lands in a JSONB column and is addressable as `{{steps.<name>.output.<field>}}` by downstream steps.

If the process dies mid-run, the run sits paused at its last persisted step. Resume from MCP, the dashboard, or a direct oRPC call.

## Folder shape

```
context/<org>/workflows/<slug>/
├── workflow.yaml      # steps + trigger + input schema (required)
├── evals.yaml         # end-to-end fixtures (recommended)
└── README.md          # optional — rationale, edge cases
```

### `workflow.yaml`

```yaml
slug: discovery_followup
name: Discovery Follow-up
description: Post-discovery-call automation. Summarize, draft, gate, send.
trigger: {type: manual}
inputSchema:
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
    reviews: email
  - name: send
    type: action
    action: gmail.send_email
```

### `evals.yaml`

End-to-end fixtures — feed an input, assert on final output + intermediate step outputs. Catches regressions where one step's output shape shifts and breaks a downstream step. See [Evals](../guides/evals.md).

## Runtime

Start a workflow → steps execute sequentially → on `approve` step, run pauses. Approver reviews at `/dashboard/review`, clicks approve/reject, optionally rates 👍/👎 with a note. Approve resumes the run from the step after; reject marks it failed. Durable by design — in-flight state lives in Postgres, not memory.

Every run is query-able by status, rating, context SHA — see the [logs view](../guides/feedback-and-logs.md).

## Connection to other resources

- **[Skills](./skills.md)** — every `skill` step invokes one
- **[Agents](./agents.md)** — an Agent often kicks off a Workflow rather than running a one-shot skill
- Review Queue — the UI surface for every `approve` step across every running workflow

## Next

- [Quickstart](../guides/quickstart.md) — run your first workflow end-to-end
- [Authoring context](../guides/authoring-context.md) — the edit + apply cycle
- [Evals](../guides/evals.md) — fixtures catch breakage before prod
- [Feedback + logs](../guides/feedback-and-logs.md) — rating runs, measuring outcomes
