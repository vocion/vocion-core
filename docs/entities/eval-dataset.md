# Eval dataset — `evals/<slug>.yaml`

An eval dataset is a set of test cases for one agent: an input, optional
guidance on what a good answer contains, and an optional per-case rubric for
the judge. Grading is on substantive equivalence, not literal string match.

| | |
|---|---|
| **Path** | `evals/<slug>.yaml` |
| **Schema** | `EvalDatasetManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `eval_dataset` table |
| **Runtime** | `npm run eval:run --workspace @vocion/core`; two models side by side: `npm run eval:upgrade` — see [the model-upgrade test](../guides/model-upgrade-test.md) |
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
| `provider` | `vocion` \| `agentcore` | `vocion` | Who grades this dataset. One grader, not several — a dataset scored by two judges has two pass rates and answers nothing. `agentcore` sends each transcript to AWS; see [the AgentCore guide](../guides/agentcore-evals.md). |
| `evaluators` | evaluator[] | — | Which evaluators the grader runs. Every entry must name the dataset's own provider, or the file is refused when applied. |
| `items` | item[] (min 1) | required | The cases. |

Each item:

| Field | Type | Required | What it does |
|---|---|---|---|
| `input` | string | yes | The user message to send to the agent. Cannot be blank — a case with nothing to say has nothing to measure, and the file is refused rather than the run failing later. |
| `expectedOutput` | string | no | Substantive-equivalence guidance — what a good answer contains, not the exact words. |
| `rubric` | string | no | Per-case grading criteria for the judge. |
| `tags` | string[] | no | Labels for slicing results. |
| `expectedTrajectory` | string[] | no | The tools this case should call, in order. Ground truth for AgentCore's trajectory evaluators — the only AgentCore scoring that runs no model. |
| `assertions` | string[] | no | Facts the answer must state. Handed to a judge model as instructions, **not** string-matched. For a real comparison use `checks`. |
| `checks` | check[] | no | Deterministic checks run in this process — no model, no AWS account. `vocion` only: on a dataset graded by anyone else the file is refused, because they would otherwise be applied and then silently never run. The vocabulary is closed: `toolCalled`, `toolNotCalled`, `outputMatches`, `outputContains`, `outputNotContains`, `latencyUnderMs`, `turnsUnder`. |

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
