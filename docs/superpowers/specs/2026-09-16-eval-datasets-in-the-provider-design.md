# The eval lives in the provider, not only in our database

Follow-up to `2026-09-16-eval-score-providers-design.md`. That design made a
dataset name one grader. This one makes the dataset a real resource in that
grader's account, so "an AgentCore eval" is an AgentCore eval and not a Vocion
eval with an AWS judge attached.

## What is wrong today

An AgentCore dataset exists only in `eval_dataset`. AWS holds no dataset, no
versions, and no history. Three smaller things are wrong with it as well:

1. `checks` written on an AgentCore dataset never run. `scoreChecks` is called
   inside the Vocion provider alone, so those cases are quietly scored without
   the deterministic part their author wrote.
2. `eval_dataset.items` is typed as `input / expectedOutput / rubric / tags`
   while we store and read `assertions`, `expectedTrajectory` and `checks`
   through a cast. A future writer trusting the column type drops the ground
   truth AgentCore scores against.
3. The guide says "AWS stores nothing", which is true of the synchronous
   `Evaluate` call and false of AgentCore generally: datasets, dataset
   versions, evaluators and batch jobs all persist.

## What AgentCore actually offers

Verified against AWS's live documentation on 2026-09-16:

- Datasets are real resources: `CreateDataset`, `GetDataset`, `ListDatasets`,
  `UpdateDataset`, `DeleteDataset` on `bedrock-agentcore-control`, all present
  in the `@aws-sdk/client-bedrock-agentcore-control` version this repo already
  depends on. Dataset evaluation is in public preview.
- A dataset has a Draft and published integer versions. Examples are mutated
  on the Draft — `AddDatasetExamples`, `UpdateDatasetExamples` (by
  `exampleId`), `DeleteDatasetExamples`, `ListDatasetExamples` — and a version
  is cut with `CreateDatasetVersion`. Mutations are asynchronous (HTTP 202) and
  all-or-nothing, capped at 1,000 examples and 5 MB per request.
- The `AGENTCORE_EVALUATION_PREDEFINED_V1` scenario shape is
  `scenario_id`, `turns[].input`, `turns[].expected_response`,
  `expected_trajectory`, `assertions`, `metadata` — which maps onto our
  `EvalDatasetItem` almost field for field.
- AWS never runs your agent. Its own runners invoke the agent client-side, or
  a batch job reads sessions out of CloudWatch. We keep our runner.

## The shape of the change

**Publishing is a provider capability, not a branch in the run path.** The run
path must never say `if (provider === 'agentcore')`; a second provider should be
a new file and a registry entry, as scoring already is.

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

**Columns are provider-neutral.** On `eval_dataset`: `remote_dataset_id`,
`remote_dataset_version`, `remote_cases_hash`, `remote_synced_at`,
`remote_status`. Nothing named `aws_*`, because the next provider fills the
same five.

**The cases hash decides whether anything is sent.** The hash covers the
published content only — input, expected output, assertions, trajectory,
scenario ids — so a rename of the dataset's description does not cut a new
version, and a changed case does.

**`scenario_id` is `<datasetSlug>-<index + 1>`.** Stable, readable in the AWS
console, and the same key `eval_case_result.itemIndex` already uses, so a case
can be followed from our table to AWS's. Reordering cases rewrites contents
rather than ids, which is the same thing our own case results already do.

**Republishing diffs by `scenario_id`**: list the Draft's examples, add the new
ids, update the changed ones by `exampleId`, delete the ones the file dropped,
then cut a version. Not delete-all-then-add: an interrupted rewrite would leave
a dataset with fewer cases than either side ever declared.

**Where it runs.** At the top of the `runEvalDataset` activity, before any case
executes, exactly where custom evaluators are already created. `workspace:apply`
stays offline, so an unreachable AWS endpoint still cannot stop a workspace
landing its agents and playbooks.

**Failure is loud.** A publish that fails fails the run before a single model
call, because a run scored against a dataset version AWS does not have is a
number nobody can reproduce.

**Idempotency, twice.** The stored `remote_dataset_id` stops a second create
when our row survived; a deterministic `clientToken` (org + slug + cases hash)
stops one when AWS accepted a create whose response we never saw. The same
belt-and-braces `agentcoreEvaluators.ts` already uses.

**`eval_score.raw`** — one nullable jsonb holding the provider's untouched
response. A field is promoted out of it into a column the moment something
reads it to draw a number; until then it stays in the blob. The typed columns
stay typed, because the pass rate, the trend and the per-evaluator breakdown
are SQL over `value`, `label`, `provider` and `evaluator_slug`.

## Work, in order

1. **Migration 0110 + schema.** The five `remote_*` columns on `eval_dataset`,
   `raw jsonb` on `eval_score`, and widen the `items` column type to the full
   `EvalDatasetItem`. `ADD COLUMN IF NOT EXISTS`, statement breakpoints, and an
   entry appended to `meta/_journal.json`.
2. **`publishDataset` on the provider type**, optional, with the Vocion
   provider deliberately not implementing it.
3. **`providers/agentcoreDatasets.ts`** — the scenario converter, create,
   diff-and-update, version, and a bounded poll for `ACTIVE` with a timeout
   that says which dataset stalled.
4. **Reconcile in `runDatasetAndScore`** — hash, compare, publish when it
   differs, store id/version/hash/status/time, and record the remote version on
   the run's metrics so a point on the chart names the dataset AWS scored.
5. **Refuse `checks` on a non-Vocion dataset** in the manifest schema, naming
   the offending case, since nothing would ever run them.
6. **UI** — the dataset page says where the eval is defined and at which
   version, and when it last synced. The list card is unchanged apart from copy.
7. **Docs** — scope the "AWS stores nothing" claim to synchronous calls, and
   add the three evaluation modes with a sentence on why we use on-demand.

## Tests, and the bug each one catches

- Converter: ground truth lands in the fields AWS reads (`expected_response`,
  `expected_trajectory`, `assertions`); a case with none of them still produces
  a valid scenario rather than keys with `undefined`.
- Publish, against a mocked SDK — no live AWS call anywhere in the suite:
  creates once and stores the id; a second run with unchanged cases sends
  nothing; a changed case updates by `exampleId` and cuts a version; a removed
  case is deleted rather than left scoring; a create whose response was lost
  does not create twice, because the client token is deterministic.
- Run path: publishing happens before any transcript is produced, and a failed
  publish leaves no run row and no model calls.
- Manifest: `checks` on an AgentCore dataset is refused with a message naming
  the case.
- E2E: the dataset page shows where the eval is defined and its version.

## What this design does not do

- No batch or online evaluation. Both need our agent's OpenTelemetry traces in
  the customer's CloudWatch, which we do not have; when it exists, it swaps the
  runner and reuses every resource here.
- No import of a dataset authored in AWS. The workspace file stays the source
  of truth for now; adopting an existing AWS dataset by name is a later,
  additive change to the same columns.
- No live-traffic interface on the provider type. Inventing it before a second
  provider exists would guess wrong about where each vendor reads traces from.
