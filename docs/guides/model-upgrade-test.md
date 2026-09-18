# The model-upgrade test

A frontier model release should not send you back to the drawing board. If a
role is defined around the job — its context, its systems, its standards, its
approval gates — then the model underneath it is one component, and a better
model should make the role you already have better. This guide is how you
check that claim for one role, with numbers, in an afternoon.

The test runs an agent's eval dataset twice: once on the model the role runs
on today (the **baseline**), once on the release you are evaluating (the
**candidate**). The same judge grades both. You read the result on three
questions, in this order.

## The three questions

**1. What can the role finish now that still needed a person last week?**
Pass rate, and the list of cases that flipped from `fail` to `pass`. A case
passes when the judge says the output meets the rubric — client-ready, in the
template, with the numbers checked — so a gained case is a piece of work that
no longer needs the final-mile fix.

**2. Where does the stronger model remove a handoff or a retry?**
Model turns per case and tool calls per case. A role that used to loop three
times before it produced the document, or hand a browser step back to a
person, shows up here as fewer turns. Median latency is the same story in
wall-clock.

**3. Does the cost per completed job drop — even if the price per token rose?**
Total cost across all cases, and then the one number that matters: **cost per
passed case**. A model with a higher list price that finishes more of the
cases, in fewer turns, can be cheaper per finished piece of work. That is the
metric to buy on. Price per token is an input; cost per passed case is the
outcome.

The comparison view puts those seven figures side by side with a change
column, then lists the cases that changed verdict, then every case. The same
comparison is published as a briefing to the agent's team. Per the
[Product Design Manifesto](../DESIGN-PRINCIPLES.md), the report leads with the
outcome — cost per completed case, pass rate, handoffs removed — and the
token, turn and cent tables sit underneath as the evidence for it.

## Running it

From the dashboard: open the dataset under **Evals**, type the baseline and
candidate model ids into **Model upgrade test**, and press **Compare
models**. Both runs execute, then you land on the comparison.

From the command line:

```bash
npm run eval:upgrade --workspace @vocion/core -- \
  --dataset proposal-writer-upgrade \
  --baseline gpt-5.6-sol \
  --candidate gpt-6-astra
```

Add `--org <projectId>` when `VOCION_DEFAULT_ORG` is not set, `--no-briefing`
to skip publishing, and `--baseline-provider` / `--candidate-provider`
(`anthropic` | `openai` | `bedrock`) only for an id whose shape does not say
which vendor serves it. The script exits `0` when the candidate's pass rate is
at least the baseline's — the CI-shaped reading of "no worse".

Over the API:

```http
POST /api/v1/evals/{slug}/model-upgrade-test
Authorization: Bearer vcn_live_…
Content-Type: application/json

{ "baselineModel": "gpt-5.6-sol", "candidateModel": "gpt-6-astra" }
```

Returns `201 { baselineRunId, candidateRunId, briefingId, comparison }`. Any
two finished runs of a dataset can also be compared after the fact at
`/dashboard/evals/{slug}/compare?baseline={runId}&candidate={runId}`.

## What a good dataset looks like

The dataset is the role's job, written down as cases — see
[Eval dataset](../entities/eval-dataset.md) for the file format. For a
model-upgrade test specifically:

- **Self-contained inputs.** Put the deal context, the brief, the numbers in
  the `input`. The test is about the model's judgement on the same facts, not
  about whether a connector was synced this morning.
- **Rubrics that name the final mile.** "Follows the proposal template",
  "cites two named past engagements", "pricing marked as a draft range" — the
  things a person used to fix before it could go out. Those are the criteria
  a better model should start passing.
- **Eight to fifteen cases.** Enough that one flipped case is a signal and not
  the whole result; few enough that both runs finish while you watch.
- **Tags for slicing.** `final-mile`, `computer-use`, `judgement` — so you can
  see which kind of work moved.

## Reading the result honestly

- **Unpriced models read as $0.** Cost comes from `libs/pricing.ts`. If a side
  is not in the table the view says so and leaves cost per passed case blank
  rather than printing a number that would make the candidate look free. Add
  the price and re-run.
- **Judge on the same model, both sides.** The judge runs on the `classifier`
  role regardless of the override, so the grading is held constant. Changing
  the judge between runs would make the comparison about the judge.
- **Runs are sequential.** The two runs share the agent's tools and budget
  row; running them concurrently would make latency a function of
  contention.
- **Cost per passed case is undefined when nothing passed.** It is shown as
  `—`, not `$0.00`.
- **This is one role, one dataset.** A model that wins for the proposal
  writer may not win for the analyst. Run the test per role; the roles that
  benefit get the upgrade, the others keep what works.

## What this is for

If every major model release forces a redesign, the model is carrying too much
of the architecture. The role, the business context, the systems and the
standards belong to the business and should stay put. This test is how you
find out whether the frontier moved your workforce forward — without
starting another pilot.

Related: [Eval dataset](../entities/eval-dataset.md) ·
[Agent](../entities/agent.md) (`harness.model`, `harness.modelProvider`) ·
[Where an agent turn runs](../agent-execution.md)
