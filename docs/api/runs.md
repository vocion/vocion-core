# Runs API

Triggering skills and workflows, polling for results, approving paused runs.

## Trigger a skill

```
POST /api/v1/skills/:slug/runs
```

```json
{
  "input": { "transcript": "...", "meeting_title": "..." },
  "idempotencyKey": "optional-client-id"
}
```

**Returns** immediately:

```json
{
  "runId": 1234,
  "status": "running",
  "pollUrl": "/api/v1/runs/1234"
}
```

If the skill has `requiresApproval: true`, the run lands in the review queue as `status: pending` instead of running to completion.

## Trigger a workflow

```
POST /api/v1/workflows/:slug/runs
```

```json
{
  "input": { "transcript": "...", "prospect_name": "Acme" },
  "idempotencyKey": "..."
}
```

Workflows can take minutes or hours (they pause at approve gates). Use the webhook registration or poll to track progress.

## Poll a run

```
GET /api/v1/runs/:id
```

Returns:

```json
{
  "id": 987,
  "kind": "workflow",
  "slug": "discovery_followup",
  "status": "paused",
  "pausedAt": "review",
  "reviewUrl": "https://.../dashboard/review?runId=987",
  "stepResults": {
    "summary": { "output": { "prospect": "Acme", "pain": "..." } },
    "email": { "output": { "body": "...", "subject": "..." } }
  },
  "contextSha": "a8d1795",
  "createdAt": "2026-04-14T20:00:00Z",
  "completedAt": null
}
```

### Possible statuses

| Status | Meaning |
|---|---|
| `running` | Currently executing |
| `paused` | Waiting for approval (workflow only) — check `pausedAt` for step name |
| `pending` | Skill output landed in review queue (requiresApproval skills) |
| `approved` / `rejected` | Human acted on a pending skill run |
| `completed` | Finished successfully |
| `failed` | Errored — see `error` field |
| `cancelled` | Explicitly cancelled |

## Approve a paused run

```
POST /api/v1/runs/:id/approve
```

```json
{
  "reviewedBy": "jane@acme.com",
  "note": "Looks good — matches their stated budget"
}
```

Workflows advance to the next step; pending skill runs move to `approved`. Requires `run:approve` scope.

## Reject

```
POST /api/v1/runs/:id/reject
```

```json
{
  "reviewedBy": "jane@acme.com",
  "reason": "Tone is off — try again"
}
```

## Cancel

```
POST /api/v1/runs/:id/cancel
```

Hard stop. Cannot be resumed.

## Streaming

Long-running workflows support server-sent events:

```
GET /api/v1/runs/:id/stream
Accept: text/event-stream
```

Events: `step_started`, `step_completed`, `paused_for_review`, `approved`, `completed`, `failed`.

## Idempotency

Pass `idempotencyKey` (any client-chosen string) on `POST` to prevent duplicate runs on retry. Keys are scoped per-token and expire after 24h.

Retry with the same key + same body → same `runId` returned.
Retry with the same key + different body → `409 CONFLICT`.

## Listing runs

```
GET /api/v1/runs?status=paused&kind=workflow&limit=50
```

Filters: `status`, `kind` (skill|workflow), `rating` (up|down), `skillSlug`, `workflowSlug`, `agentSlug`, `createdAfter`.

Returns a merged stream of skill + workflow runs for the tenant, sorted by `createdAt` desc:

```json
{
  "runs": [
    {
      "kind": "skill",
      "id": 987,
      "slug": "discovery_summary",
      "status": "approved",
      "rating": "up",
      "feedbackNote": "Matched the prospect's language well",
      "contextSha": "a8d1795",
      "createdBy": "chris",
      "createdAt": "2026-04-15T07:22:00Z"
    }
  ]
}
```

## Feedback

```
POST /api/v1/runs/:id/feedback
```

```json
{ "rating": "up", "note": "Customer used this verbatim" }
```

Valid `rating` values: `"up"`, `"down"`, `null` (clears). Note is optional. Idempotent — posting the same body twice is a no-op; the `feedbackAt` timestamp updates on each call.

Works on any skill run regardless of status — `pending`, `approved`, `rejected`, or `auto` (skills that never hit the review queue). Useful for "was this useful?" post-hoc surveys.

See [Feedback + logs](../guides/feedback-and-logs.md) for the full loop.
