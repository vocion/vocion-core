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

## Rules

- Names are unique across learning steps.
- An agent's `learningSteps:` entries name these steps.

## Related

[Agent](./agent.md) · [Eval dataset](./eval-dataset.md)
