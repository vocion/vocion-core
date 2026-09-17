# The eval lives in the provider, not only in our database

Follow-up to `2026-09-16-eval-score-providers-design.md`. That design made a
dataset name one grader. This one makes the dataset a real resource in that
grader's account, so "an AgentCore eval" is an AgentCore eval and not a Vocion
eval with an AWS judge attached.

Revised after architect, tech-lead, QA and product review. Where a review
changed a decision, the reason is kept in the text rather than dropped.

## What this buys, and what it does not

Being honest about this shapes every decision below: **scoring does not depend
on the published dataset.** `referenceInputsFor` sends the expected answer, the
assertions and the expected trajectory inline with each `Evaluate` call
(`src/services/evals/providers/agentcore.ts:247`), and `score()` never reads a
remote dataset id. Reproducibility already comes from our own
`eval_dataset.version` recorded on `eval_run.datasetVersion`.

So publishing buys three things: the eval is visible and versioned in the
customer's own AWS account, a support engineer can open it in the console, and
the batch and online modes — which do read an AWS dataset — become a runner
swap rather than a rebuild. It does not buy a better score, which is why a
failed publish must not cost anyone a run.

## What is wrong today

An AgentCore dataset exists only in `eval_dataset`. AWS holds no dataset, no
versions and no history.

Two smaller things were wrong alongside it and are already fixed on this
branch: `checks` on a non-Vocion dataset were applied and then silently never
run, and `eval_dataset.items` declared four fields while seven were stored.

## What AgentCore actually offers

Verified against AWS's live documentation on 2026-09-16:

- Datasets are real resources: `CreateDataset`, `GetDataset`, `ListDatasets`,
  `UpdateDataset`, `DeleteDataset` on `bedrock-agentcore-control`, all present
  in the `@aws-sdk/client-bedrock-agentcore-control` this repo already depends
  on. Dataset evaluation is in public preview.
- A dataset has a Draft and published integer versions. Examples are mutated on
  the Draft — `AddDatasetExamples`, `UpdateDatasetExamples`,
  `DeleteDatasetExamples`, `ListDatasetExamples` — and a version is cut with
  `CreateDatasetVersion`. Mutations are asynchronous (HTTP 202), all-or-nothing
  per request, capped at 1,000 examples and 5 MB.
- **`exampleId` is AWS's, not ours.** Inline examples are assigned generated
  UUIDs, so `scenario_id` is a field *inside* the example content. Every diff
  therefore starts by listing the Draft and matching on that embedded field.
- While a mutation or a version cut is in flight the dataset is `UPDATING` and
  **all writes are blocked**; a failed one can leave the Draft partially
  modified and the status `UPDATE_FAILED`.
- The `AGENTCORE_EVALUATION_PREDEFINED_V1` scenario shape is `scenario_id`,
  `turns[].input`, `turns[].expected_response`, `expected_trajectory`,
  `assertions`, `metadata` — which maps onto `EvalDatasetItem` almost field for
  field.
- AWS never runs your agent. Its runners invoke it client-side, or a batch job
  reads sessions out of CloudWatch. We keep our runner.

## The shape of the change

**Publishing is a provider capability, not a branch.** The run path must never
say `if (provider === 'agentcore')`.

```ts
// src/services/evals/providers/types.ts
export type PublishDatasetRequest = {
  orgId: string;
  datasetSlug: string;
  datasetName: string;
  description: string | null;
  items: EvalDatasetItem[];
  /** What we published last time, so the provider can update rather than create. */
  remoteId: string | null;
};

export type PublishedDataset = {
  remoteId: string;
  remoteVersion: string;
  status: string;
};

export type EvalScoreProvider = {
  // …id, label, isAvailable, score as today
  /** Omitted by a provider that keeps no dataset of its own, such as ours. */
  publishDataset?: (request: PublishDatasetRequest) => Promise<PublishedDataset>;
};
```

**Remote identity gets its own table**, `eval_dataset_remote`, keyed by
`(dataset_id, provider)`: `remote_id`, `remote_version`, `cases_hash`,
`status`, `sync_error`, `synced_at`. Not five columns on `eval_dataset`,
because a dataset's `provider` is mutable and a rewritten workspace file can
flip it. With a row per provider, flipping to `vocion` and back does not need
clearing logic, a second provider needs no migration, and there is somewhere to
record the sync error — which `eval_evaluator.syncError` already proves is the
difference between "unsynced" and "unsynced because AWS said this".

**Where it runs: the top of `runDatasetAndScore`, before `produceTranscripts`
(`src/services/EvalService.ts:394`).** Not "where evaluators are created" — an
earlier draft of this spec said that, and it was wrong: `resolveAgentcoreEvaluators`
runs inside `score()`, which happens after every case has already been executed.

**A failed publish degrades; it does not fail the run.** The error is recorded
on the remote row, the page says the eval could not be synced, and the run goes
ahead — the scores are just as valid, because the ground truth travels with the
`Evaluate` call. This is the same answer `pushEvaluator` already gives for a
failed evaluator sync, and the reasoning is the same: running without it is a
smaller lie than refusing to measure anything at all.

**Serialize per dataset.** Two publishers diffing the same Draft will collide,
because AWS blocks writes while the dataset is `UPDATING`. A Postgres advisory
lock keyed on `eval_dataset.id`, held across the publish, makes the schedule and
a hand-pressed run wait for each other instead of leaving a half-applied Draft.
A publish that cannot take the lock skips, and the run proceeds unpublished.

**The cases hash decides whether anything is sent**, and covers only what gets
published — scenario ids, inputs, expected responses, assertions, trajectories.
A renamed description does not cut a version; a changed case does.

**Trust, but verify the remote exists.** A hash match skips the diff, but a
`ResourceNotFoundException` — the customer deleted the dataset in the console,
or a credential now points at a different account — is treated as "not
published here", which recreates it and records the new id rather than failing
forever against a resource nobody has.

**`scenario_id` is `<datasetSlug>-<index + 1>`**, the same key
`eval_case_result.itemIndex` already uses, so a case can be followed from our
table into the AWS console.

**Republishing diffs by `scenario_id`**: list the Draft, add the new ids,
update the changed ones by AWS's `exampleId`, delete the ones the file dropped,
then cut a version. Not delete-all-then-add, which would leave an interrupted
rewrite holding fewer cases than either side ever declared. A diff that fails
partway leaves the stored hash untouched, so the next attempt resends the whole
diff rather than assuming the first half landed.

**One client token per AWS call, derived from that call's own payload** — not
one token for the whole reconcile. A crash between the delete and the version
cut must be able to retry the tail without the token having already been spent
on a different request.

**Batches respect AWS's ceiling**: 1,000 examples and 5 MB per request, chunked
with the version cut last, and a dataset too large for a single chunked publish
says so before the first call rather than surfacing an opaque AWS 4xx.

**`eval_score.raw`** — one nullable jsonb holding the provider's untouched
response. A field is promoted out of it into a column the moment something
reads it to draw a number; the typed columns stay typed, because the pass rate,
the trend and the per-evaluator breakdown are SQL over `value`, `label`,
`provider` and `evaluator_slug`.

## What a person sees

- **The first publish is not silent.** Until a dataset has ever been published,
  the page says so plainly — "These cases have not been sent to AWS yet. The
  next run copies them into your AWS account first." Cases leaving Vocion for
  an external account is a boundary crossing, and it should not first become
  visible in an AWS bill.
- **Two versions, both named**: ours and AWS's, with a distinct state when they
  differ — "cases changed since the last sync; the next run publishes them
  first."
- **The remote id is on the page**, monospace, so a support engineer can find
  the dataset in the console instead of reading the database.
- **A sync failure is its own banner**, like the existing grader-unavailable
  one, and says the run still happened.
- **The provider tooltip stops being about grading alone.** It now says the
  cases themselves are copied: "This dataset's cases are copied into AWS
  Bedrock AgentCore and stored there, then graded on each run. AWS bills your
  account."

## Work, in order

Each step leaves the branch green on its own.

1. **Migration 0110 and the schema**: `eval_dataset_remote`, and `raw jsonb` on
   `eval_score`. `ADD COLUMN IF NOT EXISTS`, statement breakpoints, an entry
   appended to `meta/_journal.json`. No `ALTER COLUMN` anywhere — the widened
   `items` shape is a Drizzle `$type` annotation, not a Postgres type.
2. **`publishDataset` on the provider type**, optional, deliberately not
   implemented by the Vocion provider.
3. **`providers/agentcoreDatasets.ts`**, unwired and fully unit-tested against a
   mocked SDK: the scenario converter, the Draft diff, the chunked mutations,
   the bounded poll, and one small orchestrator. Shared client construction and
   client-token helpers move out of `agentcoreEvaluators.ts` so there is one of
   each.
4. **Wire it into `runDatasetAndScore`** behind the advisory lock, degrading on
   failure, recording the remote version on the run. The one commit that
   changes runtime behaviour, and the smallest it can be.
5. **UI** — the states above.
6. **Docs** — publishing, what it costs, and the plain statement that Vocion
   never deletes an AWS dataset.

## Tests, and the bug each one catches

No test makes a live AWS call; the SDK is mocked throughout.

- **Converter**: ground truth lands in the fields AWS reads; a case with none of
  them still produces a valid scenario rather than keys set to `undefined`; an
  empty input is refused before any AWS call.
- **First publish**: creates the dataset, cuts a version, and stores id,
  version and hash on the remote row.
- **No-op**: a second run with unchanged cases leaves `cases_hash` and
  `synced_at` exactly as they were — asserted on the row, not on whether a mock
  was called.
- **Change**: an edited case updates by AWS's `exampleId` and cuts a new
  version; a removed case is deleted rather than left scoring; a swap of two
  cases rewrites both, because ids are positional; a description-only edit
  publishes nothing.
- **Failure**: `CREATE_FAILED` after a 202 fails the publish naming the
  dataset; a dataset still `CREATING` when the poll times out says which one
  stalled; a diff that fails partway leaves the hash unchanged so the next run
  resends it; a `ResourceNotFoundException` against a stored id recreates
  rather than looping.
- **Degradation**: a publish that fails still produces a run with scores, and
  the failure is readable on the remote row.
- **Ceiling**: more than 1,000 cases publishes in chunks with one version cut.
- **Backward compatibility**: an existing `agentcore` dataset with no remote row
  renders and runs, and old runs with `eval_score.raw` null still render.
- **E2E**: the dataset page shows where the eval is defined, both versions, and
  the not-yet-synced state. The seed fixture gains remote rows for the
  AgentCore dataset, since it writes rows directly and never publishes.

## What this design does not do

- **No batch or online evaluation.** Both need our agent's OpenTelemetry traces
  in the customer's CloudWatch. When that exists it swaps the runner and reuses
  every resource here.
- **No import of a dataset authored in AWS.** The workspace file stays the
  source of truth; adopting an existing AWS dataset by name is a later,
  additive change against the same table.
- **No deletion, ever.** Removing an eval from the workspace leaves its AWS
  dataset in place, as removing an evaluator already does. Vocion does not
  delete resources in someone else's account, and the guide says so plainly.
  The gap this leaves — our side has no retire sweep for datasets at all, so a
  dropped dataset is simply orphaned locally — is worth its own change and is
  not smuggled into this one.
- **No live-traffic interface on the provider type.** Inventing it before a
  second provider exists would guess wrong about where each vendor reads traces
  from.
