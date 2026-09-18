# Eval score providers — AgentCore alongside our own judge

Design for [vocion-core#343](https://github.com/vocion/vocion-core/issues/343).
Branch `feat/343-agentcore-evals`.

Revised after tech-lead and architect review. Every citation below was
re-verified against this worktree, which is based on `origin/main` at
`b0a08831`.

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

| Thing | Where |
|---|---|
| Dataset / run / case tables | `packages/core/src/models/Schema.ts:1563`, `:1594`, `:1630` |
| Run execution and LLM judge | `packages/core/src/services/EvalService.ts` — `runDataset` at `:119`, `scoreOne` at `:276` |
| Model-upgrade comparison | `packages/core/src/services/evals/modelUpgradeTest.ts` |
| Dashboard pages | `packages/core/src/app/[locale]/(auth)/dashboard/evals/` — list, `[slug]`, `[slug]/runs/[runId]`, `[slug]/compare` |
| Kick-off route | `packages/core/src/app/api/v1/evals/[slug]/runs/route.ts` |
| YAML dataset authoring | `packages/core/src/libs/workspace/schemas.ts:875` (`EvalDatasetManifestSchema`) |
| Dataset apply | `packages/core/src/libs/workspace/applier.ts:990` (`upsertEvalDataset`) |
| Alignment numbers | `packages/core/src/services/adoption/AdoptionService.ts:489,498,567` (`agreementRate`) |
| Tool trajectory per case | `runAgentDeep` returns `toolCalls: Array<{ tool, input, output }>` — `AgentService.ts:193` |
| AWS SDK clients | `@aws-sdk/client-bedrock-agentcore` and `-agentcore-control`, both `^3.1079.0`, already dependencies |
| Temporal schedule conventions | `packages/core/src/libs/temporal/client.ts:72,82,94,133,143` |
| Multi-provider registry precedent | `packages/core/src/libs/sources/registry.ts` |
| External-work-after-apply precedent | `libs/sources/upsert.ts` writes config; `services/SourceSyncService.ts` does the network call |

`modelUpgradeTest` set the precedent this design follows: it added no tables,
because two runs of one dataset compared after the fact is just a read over rows
that already exist. A provider is the same kind of idea.

### Every caller of `runDataset`

This inventory is load-bearing. The first draft of this design assumed one
caller and was wrong.

| Caller | Behaviour |
|---|---|
| `routers/Evals.ts:34` | oRPC procedure |
| `app/api/v1/evals/[slug]/runs/route.ts:34` | HTTP route, awaits the whole run |
| `scripts/run-evals.ts:164` | CLI, `eval:run` |
| `services/LearningCandidateService.ts:399` | **automatic** — fires after every learning-candidate rule adoption, stores `evalRunId` on the candidate |
| `services/evals/modelUpgradeTest.ts:324,333` | twice per comparison, baseline and candidate |

Two consequences. Anything added inside `runDataset` fires for all five,
including a background pipeline with no user watching. And
`modelUpgradeTest` measures cost per passed case, so extra scoring work inside
`runDataset` would corrupt the metric it exists to produce.

## What AgentCore actually does

Confirmed against the installed SDK's own type definitions.

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
  after which AWS scores live traffic continuously and writes to CloudWatch.

AgentCore never executes our agent. It scores a transcript we produce. Batch and
online additionally require traces in AgentCore Observability;
`packages/agent-runtime` emits zero OpenTelemetry (its tracing is Langfuse-only,
`src/tracing.ts`), so both are gated behind an instrumentation project this
design does not take on.

Scoring shape, from `EvaluationResultContent`: `evaluatorId`, `evaluatorName`,
`evaluatorArn`, `value` (number), `label` (string), `explanation`, `context`,
`tokenUsage`, `errorCode`, `errorMessage`.

Ground truth, from `EvaluationReferenceInput`: `expectedResponse`,
`assertions[]`, `expectedTrajectory`.

Custom evaluators, from `CreateEvaluatorRequest`: `evaluatorName`,
`description`, `level` (`TOOL_CALL` | `TRACE` | `SESSION`), and an
`evaluatorConfig` union of `llmAsAJudge { instructions, ratingScale, modelConfig }`
or `codeBased { lambdaArn }`. `ratingScale` is itself a union of `numerical` and
`categorical`.

### What is and is not deterministic

Only the **trajectory** scorers are genuinely deterministic: comparing a
tool-name sequence against `expectedTrajectory` is a sequence comparison,
pass/fail, no tokens. `assertions` is `EvaluationContent[]` — natural-language
text handed to a judge model. It makes the judge's task well-defined and its
scores more stable, but a model still decides. Everything else AgentCore ships
is LLM-judged, and the only non-LLM alternative is a Lambda the customer
deploys.

Division of labour:

- **AgentCore** — LLM judges with defined rating scales, plus trajectory
  matching.
- **Vocion** — the existing per-case rubric judge, plus a new declarative check
  vocabulary that costs nothing and needs no deploy.

## Scope

**In:** the on-demand path. AgentCore scores transcripts our own run produced,
scores land in Postgres as first-class rows, the Evals UI shows every score
labelled by provider and filterable, YAML declares which evaluators run, and a
Temporal schedule plus a refresh button produce points over time. Everything
runs concurrently within a bound.

**Out, as its own ticket:** OpenTelemetry instrumentation of
`packages/agent-runtime`, and with it the online and batch modes, CloudWatch
reads, and production-traffic scoring.

**Also out:** `codeBased` evaluators beyond storing and passing through a
`lambdaArn`. No Lambda deploy pipeline.

## Design

### 1. Provider is a column, not a tab

One store, one page, labelled by origin and filterable. `eval_run` gains:

- `provider text not null default 'vocion'`
- `dataset_version integer` — copied from `eval_dataset.version` at run time.
  Without it a trend line silently splices runs taken against different item
  sets, which is the dataset-content equivalent of the prompt drift
  `workspaceSha` already guards against.

```
eval_score
  id                serial primary key
  run_id            integer not null references eval_run(id) on delete cascade
  case_result_id    integer     null references eval_case_result(id) on delete cascade
  provider          text not null
  evaluator_slug    text not null              -- ours, or 'Builtin.ToolSelectionAccuracy'
  evaluator_name    text
  evaluator_arn     text
  level             text not null              -- TOOL_CALL | TRACE | SESSION
  value             numeric
  label             text                       -- provider-native categorical, stored raw
  explanation       text
  token_usage       jsonb
  error_code        text
  error_message     text
  created_at        timestamp not null default now()

  index on (run_id)
  index on (run_id, provider, evaluator_slug)
  index on (case_result_id)
```

`run_id` is the fix for the first draft's blocking defect. `eval_case_result`
belongs to exactly one run (`runId` is NOT NULL), so a second provider's
`eval_run` row would have had no case children and nothing to join its scores
back to. `case_result_id` is nullable because SESSION- and TRACE-level
evaluators score a whole run, not one case, and the first draft had nowhere to
put them.

`eval_case_result` keeps the transcript — `input`, `output`, `latencyMs`,
`traceId`, `usage` — plus a new `trajectory text[]`. Its `score`, `verdict` and
`rationale` columns stay written exactly as today so `modelUpgradeTest`, which
reads them directly, is untouched. The judge's grade is **also** written as one
`eval_score` row with `provider: 'vocion'`, casting the existing `text` score to
`numeric`. This dual write is deliberate and temporary; dropping the old columns
is tracked as its own cleanup rather than deferred indefinitely.

`eval_run.metrics` splits cost, because a shared execution scored by two
providers would otherwise record the agent's spend twice:

- `agentCents` — executing the agent. Identical across providers for one
  execution, so only summed from the execution's own run row.
- `judgeCents` — that provider's scoring. Rolled up from `eval_score.token_usage`,
  which today has no aggregate destination at all.

**Scores are append-only.** Refreshing means run again and append, never
overwrite. The only permitted update is a run reaching a terminal status.

`label` is never coerced to pass/fail across evaluators — "Perfectly Correct"
and "Yes" come from different scales.

### 2. Splitting execution from scoring

`runDataset` today executes and judges in one loop
(`EvalService.ts:119-260`), and `result` is `const`-scoped inside the per-case
`try` while the insert happens outside it — only `result.toolCalls.length`
escapes. So this is a real refactor, not a free read:

- `produceTranscripts(orgId, datasetSlug, opts)` — executes the agent per case,
  captures the ordered `toolCalls` into an outer-scoped binding with a defined
  empty value on the error path, writes `eval_case_result` rows including
  `trajectory`, and returns them.
- `scoreTranscripts(provider, transcripts)` — grades, writes `eval_score` rows.

`runDataset` keeps its current signature and behaviour by calling
`produceTranscripts` then `scoreTranscripts('vocion', …)`. **AgentCore is never
reachable from `runDataset`.** All five existing callers stay byte-for-byte
unaffected, and the automatic `LearningCandidateService` path never makes an AWS
call.

### 3. Concurrency

Everything that can run at once, does — bounded for throughput, not for budget.
Total spend is the same either way; the bound exists because unbounded fan-out
earns 429s from the model provider and throttling from AgentCore, which costs
more in retries than it saves in wall clock.

- **Providers** — fully parallel. Independent once transcripts exist.
- **Cases within a dataset** — parallel up to a configured limit, replacing
  today's sequential `for (let i = 0; i < items.length; i++)`.
- **Datasets** — parallel at the schedule level.

Default limit 8, configurable, raised once real 429 behaviour is observed.

What survives concurrency: `eval_case_result.itemIndex` already fixes storage
order regardless of completion order, and per-case `latencyMs` is measured per
call. What changes meaning: a run's `startedAt`/`completedAt` span stops being
the sum of its parts, so no metric may derive per-case timing from it.

### 4. The provider registry

Mirrors `libs/sources/registry.ts` — a module-level map with
`registerProvider` / `getProvider` / `listProviders` — rather than an ad hoc
two-item list.

```ts
// packages/core/src/services/evals/providers/types.ts
export type EvalScoreProvider = {
  id: string;
  label: string;
  isAvailable: (orgId: string) => Promise<ProviderAvailability>;
  score: (input: ScoreInput) => Promise<ProviderScore[]>;
};
```

`id` is `string`, not a closed union, so a third provider does not break every
`switch` keyed on the literal type.

`isAvailable` returns a reason, not a bare boolean, and checks **region as well
as credential**. AgentCore Evaluations is not in every region, and a provider
that claims availability then fails every case produces N per-case error states
instead of one clean "not available" before the run starts. Availability
otherwise reuses the rule the codebase already has: a live credential row for a
platform means the org uses it (`libs/platforms/registry.ts`).

When only one provider is available, no provider filter renders and the page
looks exactly as it does today.

Every function is declared at module level and takes what it needs as arguments.

### 5. Spans without OpenTelemetry

```
packages/core/src/services/evals/providers/agentcoreSpans.ts
  buildSessionSpans(transcript: CaseTranscript): SpanDocument[]
```

One root span per session, one child per tool call carrying name and arguments,
one for the final response. Pure function, no I/O, fixture-testable. Isolated
because it is the piece most likely to need adjustment against real AWS
responses.

### 6. YAML authoring

`EvalDatasetManifestSchema` (`schemas.ts:875`) gains an optional `evaluators`
block and optional per-case ground truth. Existing manifests keep applying
unchanged.

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
        - {label: On voice, value: 1}
        - {label: Off voice, value: 0}
items:
  - input: refund my order 4471
    rubric: must confirm the order before refunding
    expectedTrajectory: [lookup_order, check_refund_policy, issue_refund]
    assertions:
      - states the refund amount
      - gives a timeframe
    checks:
      - toolCalled: issue_refund
      - outputMatches: '\$[0-9,]+\.[0-9]{2}'
      - outputNotContains: "I don't have access"
      - latencyUnderMs: 4000
```

Three distinct things, deliberately not merged: `rubric` for our judge,
`assertions`/`expectedTrajectory` as AgentCore ground truth, and `checks` as our
own deterministic vocabulary.

`checks` is a **closed set**, each operator a module-level function with its own
test: `toolCalled`, `toolNotCalled`, `outputMatches`, `outputContains`,
`outputNotContains`, `latencyUnderMs`, `turnsUnder`. No inline executable code
in a manifest.

### 7. Evaluator sync stays out of the applier

`applier.ts` makes zero external calls today, and the repo already has a seam for
this: `libs/sources/upsert.ts` writes `source_install` config while
`services/SourceSyncService.ts` does the network work under Temporal.

So apply writes desired state only:

```
eval_evaluator
  id            serial primary key
  org_id        text not null
  dataset_slug  text not null
  provider      text not null
  slug          text not null
  level         text
  config        jsonb not null
  remote_id     text
  remote_arn    text
  synced_at     timestamp
  sync_error    text
  unique (org_id, dataset_slug, provider, slug)
```

A Temporal activity performs `CreateEvaluator` / `UpdateEvaluator`, reusing
`remote_id` so repeat syncs update rather than duplicate, and passing a
`clientToken` so a retry after a crash between the AWS success and the local
write cannot orphan a remote evaluator. Apply never blocks on AWS and never
fails because of it.

### 8. One workflow, running and collecting

```
services/temporal/workflows/evalRefresh.ts
services/temporal/activities/produceEvalTranscripts.ts
services/temporal/activities/scoreEvalTranscripts.ts
services/temporal/activities/syncEvalEvaluators.ts
```

`evalRefresh(orgId, datasetSlug, runGroupId)`:

1. Execute the dataset once, cases concurrent within the bound, producing
   transcripts.
2. Score with every available, enabled provider **in parallel**, one `eval_run`
   row and its `eval_score` rows per provider.

No async polling step — batch and online are out of scope, and the on-demand
`Evaluate` call returns results in its response.

Required mechanics, none of which the first draft specified:

- **Registration is not automatic.** `scripts/temporal-worker.ts:58` bundles
  `workflowsPath: require.resolve('../services/temporal/workflows')`, so new
  workflows and activities must be added to the `workflows/index.ts` and
  `activities/index.ts` barrels or the worker never sees them.
- **Timeouts and retries**, following `sourceSyncWorkflow.ts:14-21`:
  `startToCloseTimeout: '30 minutes'`, `maximumAttempts: 3`, exponential
  backoff.
- **Idempotency.** Temporal activities are at-least-once, and `runDataset`
  always INSERTs a fresh `eval_run`. A `runGroupId` generated once by the
  workflow is stored on `eval_run` and made unique per provider, so a retried
  activity cannot add a phantom point to the trend line.

Schedule id `eval-schedule-<orgId>-<datasetSlug>`, matching
`mission-schedule-` / `source-sync-` at `libs/temporal/client.ts:82,143`.

**Refresh button and API are the same thing.** `POST /api/v1/evals/[slug]/refresh`
starts the workflow the schedule starts and returns `runId` immediately with
status `running`. This retires the acknowledged hack in the existing route,
which awaits the whole run and says so in its own comment. `RunDatasetButton.tsx`
is repointed at the new route in the same step; the old route is not deleted
until it is.

The button reads "Run evals now", not "Refresh" — it starts real work.

### 9. UI

One page, one list, each score chipped with provider and evaluator name,
filterable by either. The filter renders only when more than one provider is
available.

- `dashboard/evals/page.tsx` — dataset cards gain a per-provider pass rate.
- `dashboard/evals/[slug]/page.tsx` — a trend chart over `startedAt`, one line
  per provider-and-evaluator, annotated where `dataset_version` changes so a
  content edit is visible rather than silently smoothed.
- `dashboard/evals/[slug]/runs/[runId]/page.tsx` — all scores per case grouped
  by provider, plus run-level scores from SESSION and TRACE evaluators.
- The technical score renders beside `agreementRate` from
  `AdoptionService.ts:567`.

States, which is where this screen can most easily lie:

- No run yet reads "no runs yet", never `0%`.
- A run in flight reads "running" and never renders a partial result as a score.
- A provider that errored reads "AgentCore scoring failed — <reason>" with the
  Vocion scores still shown.
- A provider unavailable for the org's region says so once, before any run.

## Testing

No test makes a live AWS or LLM call.

Note for whoever picks this up: `EvalService` has **no** existing unit tests, and
`modelUpgradeTest.test.ts` tests the pure `compareEvalRuns` over hand-built rows
with `vi.mock('@/libs/DB')`. There is no repo precedent for mocking
`runAgentDeep` or `buildChatModelForOrg`, so the trajectory test below
introduces the first one.

Unit:

- `produceTranscripts` threads ordered `toolCalls` into
  `eval_case_result.trajectory`, and a case that throws still writes a row with
  an empty trajectory. Requires mocking `runAgentDeep`.
- A reversed tool sequence does not compare equal to the expected trajectory.
- `buildSessionSpans` produces the expected tree for a two-tool transcript, and
  an empty tool list yields a valid single-span session.
- AWS parsing: a well-formed `EvaluateResponse` maps to rows; empty
  `evaluationResults` yields none and no crash; a result with `errorCode`
  records the error rather than a score of zero.
- Each `checks` operator including its failing case.
- `isAvailable` returns unavailable-with-reason for a missing credential and for
  an unsupported region.
- Evaluator sync writes `sync_error` and leaves the dataset applied when
  `CreateEvaluator` throws; a second sync calls `UpdateEvaluator` with the stored
  `remote_id` and creates no duplicate.
- A replayed activity with the same `runGroupId` does not create a second
  `eval_run`.
- Concurrency: N cases with a limit of 2 never exceeds 2 in flight, and results
  land at the correct `itemIndex` regardless of completion order.

Route:

- `POST /evals/[slug]/refresh` returns a typed error, not a 500, when the AWS
  call times out or is denied.
- Run detail returns Vocion scores with an AgentCore failure noted rather than
  failing the response.

End-to-end, as committed spec files:

- The Evals section renders the technical score beside the agreement rate.
- A dataset with no runs renders "no runs yet", not `0%`.
- With AgentCore unavailable, no provider filter renders.

## Build order

1. Migration: `eval_score` with indexes, `eval_run.provider`,
   `eval_run.dataset_version`, `eval_case_result.trajectory`. All additive,
   nullable or const-default, PGlite-safe, nothing needs `concurrent/`.
2. Split `runDataset` into `produceTranscripts` + `scoreTranscripts`, capture
   the trajectory, mirror the judge's grade into `eval_score`. No behaviour
   change for any of the five callers.
3. Provider registry and the `vocion` provider over the split.
4. Bounded concurrency across cases.
5. `checks` vocabulary and its manifest schema.
6. `evaluators` manifest block and the `eval_evaluator` table — desired state
   only, no AWS calls yet. **Before** any AgentCore wiring, so there is a way to
   say which evaluators run before anything can run them.
7. `buildSessionSpans` and the `agentcore` provider against fixtures. Still no
   live calls.
8. `evalRefresh` workflow, both activities, barrel registration, the refresh
   route, `RunDatasetButton` repointed, the schedule. First real AWS call
   happens here.
9. UI: provider chips, filter, trend chart with version annotations, placement
   beside the alignment numbers.

Steps 1-7 touch no external service. Step 8 is the first point where something
can be wrong in a way a fixture would not catch.

## Open questions

- **Cost per scheduled refresh.** Built-in AgentCore evaluators bill per token,
  custom ones per evaluation. Live AWS pricing must be checked before a default
  cadence is set; default to manual-only until someone opts in.
- **Which regions support AgentCore Evaluations**, checked against live AWS docs,
  since `isAvailable` depends on it.
- **When `eval_case_result.score` / `verdict` / `rationale` get dropped.** The
  dual write is deliberate but is two sources of truth for one grade.
- **Normalising `value` to 0..1.** Numerical scales are evaluator-defined, so a
  cross-evaluator average may not mean anything. Store raw, decide per
  evaluator.

## What this design deliberately does not do

- No CloudWatch reads, no OpenTelemetry, no production-traffic sampling.
- No Lambda deploy pipeline.
- No live AWS call behind a page load, and none from `runDataset`.
- No blending of provider scores into a single headline number.
