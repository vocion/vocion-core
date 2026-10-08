# Learning step — `learnings/<name>.yaml`

A learning step is a named bucket of rules an agent reads — the place where
"we learned to always do X" accumulates without turning into a junk drawer.
Steps are whitelisted here in the workspace; the individual rules are runtime
rows written through the dashboard.

| | |
|---|---|
| **Path** | `learnings/<name>.yaml` |
| **Schema** | `LearningStepManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `learning_step` table, with `learning` rows attached at runtime |
| **Runtime** | Rendered to `/learnings/<name>.md` in the agent's virtual filesystem |
| **Surface** | `/dashboard/learnings` |
| **Layering** | Workspace-only — a base pack ships no learning steps |

## Fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `name` | slug | required | The step's id. Also its filename and the name agents reference in `learningSteps:`. |
| `title` | string | required | Display title. |
| `description` | string | required | What kind of rule belongs in this step. |
| `preamble` | string | — | Long-form intro shown above the rule list. Markdown allowed. |
| `agents` | string[] | `[]` | Agent slugs that own or read this step. |

Note this is the one authored kind keyed on `name` rather than `slug`.

## Example

```yaml
name: meeting_triage
title: Meeting Triage
description: >-
  Rules for deciding whether a calendar event is a real sales conversation
  worth a debrief.
preamble: |
  These rules came from misfires — internal syncs treated as discovery calls,
  and recurring 1:1s summarized as prospect meetings.
agents:
  - meeting-prep
  - followup-coordinator
```

## Compaction — merges and retirements

A bucket only grows if nothing tidies it (an earlier experiment reached 747
rules). Compaction proposes two kinds of change beside new rules, each a
suggestion on `/dashboard/learnings` and on Needs you, never a silent edit:

| Change | Proposed when | Approving | Undo |
|---|---|---|---|
| **Merge** | Rules that say the same thing — the model is shown related rules, at most 60 at a time | Writes the merged rule, which keeps the **sum** of the originals' occurrence counts and each original as provenance (`meta.mergedFrom`); the originals are retired | The originals come back word for word; the merged rule goes |
| **Retire — stale** | No agent has had the rule mounted, nobody has restated it, and it was adopted before `defaults.orgReview.staleRuleDays` (60); one batch of at most 50 per bucket at a time | The rules are retired | They come back |
| **Retire — contradicted** | The model names two rules that ask for opposite behaviour; the older one (read off the record) goes | The older rule is retired; the newer one stays | It comes back |

Retired never means deleted: the rule is expired in the store, invisible to
every agent exactly as a deleted one was, with who, when and why on its meta.
Keeping things as they are needs no reason, and a kept rule is not proposed
again for the window. Rules authored here in YAML are left alone — the next
apply would write them back. A person's own preferences are never retired for
being quiet. The pass runs with the feedback worker and with the weekly
[org review](../guides/org-review.md); a suggestion records its kind and its
evidence on `learning_candidate.change_kind` / `evidence` (migration 0186).

## Rules

- Names are unique across learning steps.
- An agent's `learningSteps:` entries name these steps.

## Related

[Agent](./agent.md) · [Eval dataset](./eval-dataset.md) · [The weekly org review](../guides/org-review.md)
