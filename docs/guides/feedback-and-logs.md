# Feedback + logs

Every run — skill or workflow — records:

- Inputs + outputs
- Status (pending · approved · rejected · completed · failed · cancelled · auto)
- The active `context_sha` when it executed
- Who created it, who reviewed it
- **Rating** (👍 / 👎) + **note**, captured during review or post-hoc

That's the feedback loop. Ratings flow into improvement workflows; the logs view makes every decision inspectable.

## Capturing feedback

### During review

At `/dashboard/review`, each pending skill run shows:

- 👍 / 👎 buttons (optional)
- An inline note field (optional)
- Approve / Reject

Pressing **Approve** with 👍 + a note stores rating, note, reviewer, and timestamp alongside the approved status. **Reject** always captures the note as a down-rating — rejecting without context buries signal.

### Post-hoc

Approved runs (or `auto` runs that never hit the queue) can still be rated later:

```bash
curl -X POST -H "Authorization: Bearer $VOCION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating":"up","note":"Customer used this verbatim"}' \
  https://your-vocion-install/api/v1/runs/987/feedback
```

Same endpoint for down-ratings: `{"rating":"down","note":"..."}`. Passing `"rating": null` clears the rating.

Post-hoc feedback is idempotent — posting the same body twice is a no-op. The `feedbackAt` timestamp updates on each call.

## Logs view

`/dashboard/logs` lists every run in reverse-chronological order for the current tenant. Columns: when, kind (skill/workflow), slug, status, rating, context SHA, who triggered it, link to the primitive drilldown.

Filters (via URL params, all stackable):

- `?kind=skill` or `?kind=workflow`
- `?status=approved` · `rejected` · `pending` · `completed` · `failed`
- `?rating=up` · `rating=down`

Same filters available on `GET /api/v1/runs?kind=...&status=...&rating=...&limit=100`.

## Why this matters

Two things compound from this:

1. **Evals improve** — a skill with lots of 👎 and notes is a skill whose prompt needs work. The planned `improve_skill` meta-skill reads last-N runs + feedback + fixtures and proposes a prompt diff on a branch.
2. **Audit is real** — "why did the agent retrieve X on March 3rd" becomes: find the skill_run, look at its `context_sha`, check out that commit, re-run. No mystery.

## What's persisted

```
skill_run:
  id, orgId, skillId,
  input, output,
  status,                 # pending | approved | rejected | auto
  langfuseTraceId,
  contextSha,             # git SHA of context/ at run time
  createdBy,
  reviewedBy, reviewedAt,
  rating,                 # up | down | null
  feedbackNote,
  feedbackBy, feedbackAt,
  createdAt

workflow_run:
  ...all of the above, plus stepResults/cursor/pauseReason...
```

Every field is query-able via SQL or `GET /api/v1/runs`.

## Next

- [API runs reference](../api/runs.md) — trigger, poll, approve, feedback
- [Skills](../concepts/skills.md) — each run belongs to a Skill
- [Review queue](../concepts/workflows.md#approve-gates) — the review surface
