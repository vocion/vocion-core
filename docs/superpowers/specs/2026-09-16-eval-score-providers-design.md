# Eval score providers — AgentCore alongside our own judge

Design for [vocion-core#343](https://github.com/vocion/vocion-core/issues/343).
Branch `feat/343-agentcore-evals`.

## The problem in one paragraph

Our eval layer runs a dataset of authored cases through an agent and grades each
case with an LLM judge. That judge answers "was the answer good". It cannot
answer "did the agent call the right tools, in the right order", because nothing
compares the tool trajectory against an expected one. AWS Bedrock AgentCore
already ships scorers that do exactly that, and the SDKs are already in our
`package.json`. This design brings AgentCore in as a second **score provider**
next to our own, keeps the two separately configured and separately measured,
and stores every score in Postgres so history and trend lines belong to us.

## What is already here

Verified against `main` at `b0a08831`, not from memory.

| Thing | Where |
|---|---|
| Dataset / run / case tables | `packages/core/src/models/Schema.ts:1563`, `:1594`, `:1630` |
| Run execution and LLM judge | `packages/core/src/services/EvalService.ts` — `runDataset` at `:119`, `scoreOne` at `:276` |
| Model-upgrade comparison | `packages/core/src/services/evals/modelUpgradeTest.ts` |
| Dashboard pages | `packages/core/src/app/[locale]/(auth)/dashboard/evals/` — list, `[slug]`, `[slug]/runs/[runId]`, `[slug]/compare` |
| Kick-off route | `packages/core/src/app/api/v1/evals/[slug]/runs/route.ts` |
| YAML dataset authoring | `packages/core/src/libs/workspace/schemas.ts:585` (`EvalDatasetManifestSchema`), applied at `applier.ts:956-986` |
| Alignment numbers | `packages/core/src/services/adoption/AdoptionService.ts:489,498,567` (`agreementRate`) |
| Tool trajectory per case | `runAgentDeep` returns `toolCalls: Array<{ tool, input, output }>` — `AgentService.ts:193` |
| AWS SDK clients | `@aws-sdk/client-bedrock-agentcore` and `-agentcore-control`, both `^3.1079.0`, already dependencies |
| Temporal schedules | `packages/core/src/libs/temporal/client.ts` — schedule-ID conventions; `langfuseRetention` is a daily precedent |

Two things this means. First, the tool trajectory we need for AgentCore's
trajectory scorers is already produced on every run; only the count survives into
`eval_case_result.usage`, so the sequence needs capturing, not inventing. Second,
`modelUpgradeTest` set the precedent we follow here: it added no tables, because
two runs of one dataset compared after the fact is just a read over rows that
already exist. A provider is the same kind of idea.

## What AgentCore actually does

Confirmed against the installed SDK's own type definitions, not the docs.

Three modes:

- **On-demand** — `Evaluate` scores synchronously and returns results in the
  response. Its input is `EvaluationInput.SessionSpansMember { sessionSpans }`,
  a free-form JSON document array, so **we can hand it spans we construct
  ourselves**. No CloudWatch, no OpenTelemetry pipeline, no requirement that the
  agent run on AgentCore Runtime. AWS persists nothing — there is no
  `GetEvaluation` — so whatever we do not store is lost.
- **Batch** — `StartBatchEvaluation` over logged sessions, polled with
  `GetBatchEvaluation`.
- **Online** — `CreateOnlineEvaluationConfig` sets sampling and evaluators once,
  after which AWS scores live traffic continuously on its own and writes results
  to CloudWatch. This is the mode that matches "just read the results on a
  schedule", and it is the real end state.

All three require traces in AgentCore Observability **except** on-demand, which
takes spans in the request body. `packages/agent-runtime` emits zero
OpenTelemetry — its tracing is Langfuse-only (`src/tracing.ts`) — so online and
batch are gated behind an instrumentation project that this design deliberately
does not take on.

Scoring shape, from `EvaluationResultContent`: `evaluatorId`, `evaluatorName`,
`evaluatorArn`, `value` (number), `label` (string), `explanation`, `context`,
`tokenUsage`, `errorCode`, `errorMessage`.

Ground truth, from `EvaluationReferenceInput`: `expectedResponse`,
`assertions[]`, `expectedTrajectory`.

Custom evaluators, from `CreateEvaluatorRequest`: `evaluatorName`,
`description`, `level`, and an `evaluatorConfig` union of
`llmAsAJudge { instructions, ratingScale, modelConfig }` or
`codeBased { lambdaArn }`. `ratingScale` is itself a union of `numerical` and
`categorical`.

### What is and is not deterministic

This matters, because it is easy to get wrong. Only the **trajectory** scorers
are genuinely deterministic: comparing a tool-name sequence against
`expectedTrajectory` is a sequence comparison, pass/fail, no tokens. `assertions`
is `EvaluationContent[]` — natural-language text handed to a judge model. It
makes the judge's task well-defined and its scores more stable, but a model still
decides. Everything else AgentCore ships is LLM-judged, and the only non-LLM
alternative is a Lambda the customer deploys.

So the division of labour is:

- **AgentCore** — strong LLM judges with defined rating scales, plus trajectory
  matching. Costs tokens.
- **Vocion** — the existing per-case rubric judge, plus a new declarative check
  vocabulary that costs nothing and needs no deploy.

## Scope of this ticket

**In:** the on-demand path. AgentCore scores the same transcript our own run
produced, its scores land in Postgres as first-class rows, the Evals UI shows
every score labelled by provider and filterable, YAML declares which evaluators
run, and a Temporal schedule plus a refresh button produce points over time.

**Out, as its own ticket:** OpenTelemetry instrumentation of
`packages/agent-runtime`, and with it the online and batch modes, CloudWatch
reads, and production-traffic scoring. That work is the real end state; it is a
project, not a sub-task, and burying it here would sink this one.

**Also out:** `codeBased` evaluators beyond storing and passing through a
`lambdaArn`. We do not build a Lambda deploy pipeline.

## Design

### 1. Provider is a column, not a tab

Everything lives in one store and on one page, labelled by origin and filterable
— no separate AgentCore section, no parallel tables.

`eval_run` gains `provider text not null default 'vocion'`. Every existing row
stays valid without backfill.

A new child table holds scores, because a single case graded by AgentCore comes
back as an **array** — one result per evaluator, on different scales. One grade
per case cannot hold that.

```
eval_score
  id                serial primary key
  case_result_id    integer not null references eval_case_result(id) on delete cascade
  provider          text not null                 -- 'vocion' | 'agentcore'
  evaluator_slug    text not null                 -- our name, or 'Builtin.ToolSelectionAccuracy'
  evaluator_name    text                          -- AWS's display name
  evaluator_arn     text
  value             numeric                       -- normalised 0..1 where meaningful
  label             text                          -- provider-native categorical, stored raw
  explanation       text
  token_usage       jsonb
  error_code        text
  error_message     text
  created_at        timestamp not null default now()
```

`eval_case_result` keeps the transcript — `input`, `output`, `latencyMs`,
`traceId`, `usage` — and stops owning the grade. Its existing `score`, `verdict`
and `rationale` columns stay, written as today, and are mirrored into one
`eval_score` row with `provider: 'vocion'` so the new UI has a uniform thing to
read. Dropping them is a later cleanup, not part of this change.

`label` is never coerced into pass/fail across evaluators. "Perfectly Correct"
and "Yes" come from different scales and are not comparable; the evaluator name
is what gives a label meaning.

**Scores are append-only.** A score measures one execution at one moment.
Refreshing must mean *run again and append*, never *overwrite* — overwriting
destroys the trend line this ticket exists to produce. The one permitted update
is a run moving from `running` to a terminal status, which is a row completing,
not a score changing.

### 2. Trajectory capture

`runAgentDeep` already returns the ordered `toolCalls` array. `runDataset` keeps
it per case and writes the tool-name sequence onto `eval_case_result` (a
`trajectory text[]` column) so trajectory scoring does not require re-running the
agent, and so a later run can be compared against an earlier one.

### 3. The provider interface

```ts
// packages/core/src/services/evals/providers/types.ts
export type EvalScoreProvider = {
  id: 'vocion' | 'agentcore';
  label: string;
  isAvailable: (orgId: string) => Promise<boolean>;
  score: (input: ScoreInput) => Promise<ProviderScore[]>;
};
```

Two registered. Every function is declared at module level and receives what it
needs as arguments — no closures over run state.

`ScoreInput` is one case's transcript: input, output, ordered tool calls with
their arguments, latency, and the case's ground truth. `ProviderScore` is the
normalised row shape above.

**Availability** reuses the rule the codebase already has: a live credential row
for a platform means the org uses that platform
(`packages/core/src/libs/platforms/registry.ts`). AgentCore is available when the
org has a live `aws` credential. It does **not** additionally require an agent on
an AgentCore harness target, because on-demand `Evaluate` scores a transcript
regardless of where the agent ran — requiring the harness target would hide a
capability that works.

When only one provider is available, the UI renders no provider filter at all and
the page looks exactly as it does today.

Azure AI Foundry or Vertex later is a new module against this interface. No UI
change, no schema change.

### 4. Spans without OpenTelemetry

`Evaluate` takes `sessionSpans` as free-form documents. A small pure module
builds OTel-shaped spans from a case's transcript:

```
packages/core/src/services/evals/providers/agentcoreSpans.ts
  buildSessionSpans(transcript: CaseTranscript): SpanDocument[]
```

One root span for the session, one child per tool call carrying tool name and
arguments, one for the final model response. Pure function, no I/O, fully
unit-testable against fixtures. This is the module most likely to need
adjustment once we see real AWS responses, which is exactly why it is isolated.

### 5. YAML authoring

`EvalDatasetManifestSchema` gains an optional `evaluators` block and per-case
ground truth. Both optional, so every existing manifest keeps applying unchanged.

```yaml
slug: support-quality
agentSlug: support-reply
evaluators:
  - provider: vocion
  - provider: agentcore
    builtin: [ToolSelectionAccuracy, GoalSuccessRate, TrajectoryInOrderMatch]
  - provider: agentcore
    slug: tone-check
    level: trace
    instructions: |
      Score whether the reply matches the brand voice described below...
    ratingScale:
      categorical:
        - { label: "On voice", value: 1 }
        - { label: "Off voice", value: 0 }
items:
  - input: "refund my order 4471"
    rubric: "must confirm the order before refunding"     # Vocion judge, per case
    expectedTrajectory: [lookup_order, check_refund_policy, issue_refund]
    assertions:
      - "states the refund amount"
      - "gives a timeframe"
    checks:
      - toolCalled: issue_refund
      - outputMatches: '\$[0-9,]+\.[0-9]{2}'
      - outputNotContains: "I don't have access"
      - latencyUnderMs: 4000
```

Three distinct things, deliberately not merged:

- `rubric` — per-case, read by our existing judge.
- `assertions` / `expectedTrajectory` — ground truth passed to AgentCore as
  `EvaluationReferenceInput`.
- `checks` — our declarative deterministic vocabulary, run in `EvalService`,
  no model call and no deploy.

`checks` is a **closed set** of operators, each a plain module-level function
with its own unit test: `toolCalled`, `toolNotCalled`, `outputMatches`,
`outputContains`, `outputNotContains`, `latencyUnderMs`, `turnsUnder`. No inline
executable code in a manifest — that is a sandbox and timeout problem, and the
Lambda ARN is the escape hatch for anything the vocabulary cannot express.

### 6. Pushing custom evaluators to AWS

A custom `llmAsAJudge` evaluator declared in YAML is created in AWS on apply and
updated thereafter, so AgentCore stays the single place those evaluators run.

This makes `applier.ts` do something it has never done: call an external service.
Two rules follow.

- **Idempotent.** `CreateEvaluator` returns an `evaluatorId` and `evaluatorArn`
  we must reuse, or every apply creates a duplicate. A new `eval_evaluator` table
  maps our slug to the remote identifiers and records `syncedAt` and
  `syncError`.
- **Never fails the apply.** AWS being unreachable must not stop the dataset
  landing. The evaluator row is written marked unsynced, the error is logged, the
  apply summary reports it, and the next apply or refresh retries.

```
eval_evaluator
  id             serial primary key
  org_id         text not null
  dataset_slug   text not null
  provider       text not null
  slug           text not null
  level          text                    -- TOOL_CALL | TRACE | SESSION
  config         jsonb not null          -- instructions, ratingScale, modelConfig, or lambdaArn
  remote_id      text
  remote_arn     text
  synced_at      timestamp
  sync_error     text
  unique (org_id, dataset_slug, provider, slug)
```

### 7. Refresh, scheduling and history

History needs no new mechanism. `eval_run` is append-only and stamps `startedAt`
and `workspaceSha`, so a trend is "runs for this dataset, ordered by time", and
`workspaceSha` attributes a jump to a prompt change rather than leaving it a
mystery. What is missing is something producing points on a cadence.

One Temporal workflow does both the running and the collecting, because a
Temporal workflow can start work, wait durably, and resume — the wait *is* the
workflow, so no separate importer is needed.

```
packages/core/src/services/temporal/workflows/evalRefresh.ts
packages/core/src/services/temporal/activities/runEvalDataset.ts
packages/core/src/services/temporal/activities/scoreWithProvider.ts
```

`evalRefresh(orgId, datasetSlug)`:

1. Execute the dataset once, producing one transcript per case.
2. For each available, enabled provider, score those transcripts and write an
   `eval_run` row with that provider plus its `eval_score` rows.
3. For any provider returning asynchronously, poll to completion under a bounded
   wait, then mark the run failed with the reason rather than leaving it
   `running` forever.

One execution, one set of transcripts, one run row per provider. Separate
measurement and separate configuration, but comparable scores, and we never pay
to run the agent twice.

Schedule ID follows the existing convention: `eval-run-<orgId>-<datasetSlug>`,
alongside `workflow-schedule-…` and `source-sync-…` in
`libs/temporal/client.ts`.

One schedule per dataset fires every enabled provider together, so points share
timestamps and comparisons stay honest.

**Refresh button and API are the same thing.** The button posts to
`POST /api/v1/evals/[slug]/refresh`, which starts the same workflow the schedule
starts, so a manual run and a scheduled run produce identical rows. This also
retires the acknowledged hack in the current kick-off route, which blocks on the
whole run and carries a comment saying so.

The button says "Run evals now", not "Refresh" — it costs model tokens and is not
a free reload. Users will click a refresh icon repeatedly; they will think twice
about a button that says it runs something.

### 8. UI

One page, one list, each score chipped with its provider and evaluator name,
filterable by provider and by evaluator. The provider filter renders only when
more than one provider is available, so an org without AWS sees today's page
unchanged rather than an empty tab someone has to explain.

- `dashboard/evals/page.tsx` — dataset cards gain a per-provider pass rate.
- `dashboard/evals/[slug]/page.tsx` — run history becomes a trend chart over
  `startedAt`, one line per provider-and-evaluator, plus the existing run list.
- `dashboard/evals/[slug]/runs/[runId]/page.tsx` — each case shows all its
  scores, grouped by provider, with `explanation` and raw `label`.
- The technical score renders beside `agreementRate` from
  `AdoptionService.ts:567`, satisfying the issue's acceptance criterion.

Empty and failure states, which is where this screen can most easily lie:

- No run yet reads "no runs yet", never `0%`.
- A provider that errored reads "AgentCore scoring failed — <reason>" with the
  Vocion scores still shown, never a blank page and never a zero.
- A run still in flight reads "running", not a partial score presented as final.

The Radix `Tabs` primitive at `components/ui/tabs.tsx` has zero consumers today,
and the filter here is a filter rather than tabs, so nothing new is introduced.

## Testing

Per `~/.claude/rules/testing.md`, every test asserts a rule someone could get
wrong, and **no test makes a live AWS or LLM call.**

Unit:

- `buildSessionSpans` produces the expected span tree for a two-tool transcript,
  and an empty tool list yields a valid single-span session.
- AWS response parsing: a well-formed `EvaluateResponse` maps to `eval_score`
  rows; an empty `evaluationResults` yields no rows and no crash; a result
  carrying `errorCode` records the error rather than a score of zero.
- Each `checks` operator, including the failing case: `outputMatches` against a
  non-matching output must fail, or the operator is decorative.
- Trajectory extraction preserves tool-call order — a reversed sequence must not
  compare equal to the expected one.
- `isAvailable` returns false for an org with no live `aws` credential and true
  for one with it.
- Evaluator sync writes `sync_error` and leaves the dataset applied when
  `CreateEvaluator` throws.
- A second apply of an already-synced evaluator calls `UpdateEvaluator` with the
  stored `remote_id` and does not create a duplicate.

Route:

- `POST /evals/[slug]/refresh` returns a typed error, not a 500, when the AWS
  call times out or is denied.
- The run-detail route returns Vocion scores with an AgentCore failure noted,
  rather than failing the whole response.

End-to-end, as committed spec files:

- The Evals section renders the technical score beside the agreement rate for one
  agent.
- A dataset with no runs renders "no runs yet" and not `0%`.
- With AgentCore unavailable, no provider filter renders and the page matches its
  current shape.

## Build order

Each step ships with its tests and leaves the app working.

1. `eval_score` table, `eval_run.provider`, `eval_case_result.trajectory`
   migration. Mirror the existing judge's grade into `eval_score` on write.
2. Provider interface plus the `vocion` provider, reading from what
   `runDataset` already produces. No behaviour change, one place the score comes
   from.
3. `checks` vocabulary and its manifest schema, run by the `vocion` provider.
4. `buildSessionSpans` and the `agentcore` provider against fixtures. No live
   calls yet.
5. Wire `agentcore` into `runDataset` behind credential availability; first real
   AWS call happens here, manually, against one dataset.
6. `evaluators` manifest block, `eval_evaluator` table, and evaluator sync in
   the applier.
7. `evalRefresh` Temporal workflow, the refresh route, and the schedule.
8. UI: provider chips, filter, trend chart, and placement beside the alignment
   numbers.

Steps 1–4 touch no external service and are fully testable offline. Step 5 is
the first point where anything can be wrong in a way a fixture would not catch.

## Open questions

Recorded here rather than blocking the build, per house rules.

- **Cost per refresh.** Built-in AgentCore evaluators bill per token and custom
  ones per evaluation. A weekly schedule across many datasets and evaluators has
  a real bill attached. Live AWS pricing must be checked before a default cadence
  is set, and the default should probably be manual-only until someone opts in.
- **Whether `eval_case_result.score` / `verdict` / `rationale` get dropped** once
  everything reads `eval_score`. Left in place here; worth its own cleanup.
- **Normalising `value` to 0..1.** Numerical rating scales are evaluator-defined,
  so a cross-evaluator average is not obviously meaningful. Storing raw and
  deciding per evaluator is the safe start.
- **Region and availability.** AgentCore Evaluations is not in every region;
  the org's AWS region needs checking before the provider claims availability,
  and the current region list must come from live AWS docs.
- **Whether the online path eventually replaces this one.** If production-traffic
  scoring lands, the on-demand path stays useful for authored datasets and
  pre-deploy regression checks, but the two will need a clear story about which
  answers which question.

## What this design deliberately does not do

- No CloudWatch reads, no OpenTelemetry, no production-traffic sampling.
- No Lambda deploy pipeline.
- No live AWS call behind a page load. Everything the UI reads is in Postgres;
  only a run can fail, and a failed run is visible and retryable.
- No blending of provider scores into a single headline number.
