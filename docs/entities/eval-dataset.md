# Eval dataset — `evals/<slug>.yaml`

An eval dataset is a set of test cases for one agent: an input, optional
guidance on what a good answer contains, and an optional per-case rubric for
the judge. Grading is on substantive equivalence, not literal string match.

| | |
|---|---|
| **Path** | `evals/<slug>.yaml` |
| **Schema** | `EvalDatasetManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `eval_dataset` table |
| **Runtime** | `npm run eval:run` |
| **Surface** | `/api/v1/evals` |
| **Layering** | Workspace-only — a base pack ships no eval datasets |

## Fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `slug` | slug | required | Stable id. |
| `name` | string | required | Display name. |
| `description` | string | — | What this dataset is testing. |
| `agentSlug` | agent slug | required | Which agent the dataset evaluates. |
| `version` | positive int | `1` | Bump when cases change materially. |
| `items` | item[] (min 1) | required | The cases. |

Each item:

| Field | Type | Required | What it does |
|---|---|---|---|
| `input` | string | yes | The user message to send to the agent. |
| `expectedOutput` | string | no | Substantive-equivalence guidance — what a good answer contains, not the exact words. |
| `rubric` | string | no | Per-case grading criteria for the judge. |
| `tags` | string[] | no | Labels for slicing results. |

## Example

```yaml
slug: pipeline-analyst-basics
name: Pipeline Analyst — Basics
description: Numbers-first answers, and no invented deals.
agentSlug: pipeline-analyst
version: 1
items:
  - input: Which deals have gone quiet?
    expectedOutput: >-
      Names the specific stale deals with days quiet, then one recommended
      move each. Does not invent accounts.
    rubric: Fails if any named account is not in the provided data.
    tags: [staleness]
  - input: How's the quarter?
    expectedOutput: Raw and weighted totals, then the biggest risk.
    tags: [summary]
```

## Rules

- Slugs are unique across eval datasets.
- At least one item is required.
- `agentSlug` should name an agent in this workspace — otherwise the run has nothing to grade.

## Related

[Agent](./agent.md) · [Learning step](./learning-step.md)
