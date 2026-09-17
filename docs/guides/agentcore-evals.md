# Evals graded by AWS AgentCore

Vocion's own judge is not the only opinion you can get about an agent. If your
workspace runs on AWS, a dataset can be scored by Amazon Bedrock AgentCore
Evaluations instead, and the eval section says so everywhere the numbers
appear.

One eval, one grader. An eval scored by two judges has two pass rates and so
answers nothing: to compare the graders, point two datasets at the same agent
and read them side by side, where it is obvious that they are two
measurements.

## What AgentCore actually does

AgentCore never runs your agent. Vocion runs the dataset, produces a
transcript for each case, and hands that transcript to AgentCore's synchronous
`Evaluate` API, which reads it and says what it thinks. That has three
consequences worth knowing before you plan around it:

- **No OpenTelemetry, no CloudWatch, no hosting on AgentCore Runtime.** The
  spans go in the request body. Your agent can run anywhere.
- **A synchronous score is not stored anywhere.** There is no
  `GetEvaluation` for an `Evaluate` call, so a score Vocion does not write down
  is gone — which is why every score lands in `eval_score` as it arrives.
  AgentCore does persist other things: evaluators, datasets and their versions,
  and batch evaluation jobs all live in your account.
- **The grader never sees your agent run.** It reads a finished transcript, so
  a score is about that one execution and nothing else — rerunning the dataset
  is a new measurement, not a second opinion on the old one.

## Three ways AgentCore evaluates, and the one we use

AWS offers evaluation in three shapes, and they answer different questions:

- **On-demand** — you hand it the spans for one session and it scores them
  synchronously. This is the one Vocion uses: our runner executes the cases and
  posts each finished transcript to `Evaluate`.
- **Batch** — you start a job and the service finds the sessions itself, out of
  CloudWatch Logs, scores them server-side and hands back per-evaluator
  averages. Useful for a baseline over a window of real production traffic.
- **Online** — a standing configuration that scores a sampled percentage of
  live sessions continuously, writing scores to CloudWatch as they happen.

The last two read your agent's OpenTelemetry traces out of CloudWatch, which
means an agent instrumented and delivering spans there. Vocion's agents trace
to Langfuse today, so on-demand is the shape that works without asking anyone
to rebuild their observability. Nothing about the datasets or the evaluators
changes if that later becomes possible — only who runs the cases.

Worth being clear about what the live-traffic shape can and cannot tell you.
Nobody wrote down the right answer for a real customer's question, so online
evaluation judges a session against itself: was the reply responsive, was it
grounded in what the tools returned. That is a health signal, not a pass rate.
The way the two meet is a person promoting a bad live session into a dataset
and writing the expected answer — after which it is a regression case like any
other.

## Where the cases live

A dataset graded by AgentCore exists twice: in your workspace file, which is
where you edit it, and as a real AgentCore dataset inside your own AWS account,
which Vocion keeps in step.

The copy happens at the top of a run, before a single agent call is made. If it
is going to fail — bad credentials, a region without the feature, a dataset AWS
will not accept — the failure lands before anyone has spent money on model
calls.

What it does, in order:

- Hashes the cases. If the hash matches what was last published and the last
  publish succeeded, nothing is sent at all. A nightly schedule on an untouched
  dataset makes no AWS calls.
- Otherwise it works out the difference against AWS's draft — cases added,
  changed and dropped — sends only that, and cuts a new dataset version. Each
  version is immutable, so a run can always say which cases it measured.
- Requests are split at AWS's ceilings of 1,000 examples and 5 MB, so a large
  dataset lands in several calls and one version.
- Only one publisher per dataset at a time, held by a Postgres advisory lock. A
  schedule firing next to a hand-pressed run makes the second one skip the copy
  and run anyway, rather than queue behind an AWS round trip.

**A failed copy does not stop the eval.** Scoring never reads the published
dataset — each `Evaluate` call carries that case's expected answer, assertions
and expected trajectory in the request body — so a run whose publish failed is
scored exactly like any other. The failure is written down, the dataset page
says the copy is out of date, and the next run tries again.

The dataset page shows which of four states you are in: not copied yet, in step,
behind (cases edited here since the last copy), or a copy that failed with the
reason. It also shows AWS's own id for the dataset, which is what you need to
find it in the Bedrock console.

**Vocion never deletes a dataset from your AWS account.** Removing an eval from
your workspace file stops Vocion running it; the AgentCore dataset and its
versions stay where they are, and deleting them is a decision you make in your
own account. That is deliberate — versions are the provenance behind scores
someone may still be reading — but it does mean an abandoned eval leaves
something behind.

Cost: the judging is billed to your account as model usage, the same as any
other AgentCore evaluator call. Whether AWS charges separately for storing a
dataset and its versions is not something we have verified — check the Bedrock
AgentCore pricing page before assuming the storage is free.

## What is deterministic, and what only looks it

Exactly one thing AgentCore ships scores without a model call: **trajectory
matching**, which compares the tools the agent called against the tools you
said it should call.

Everything else is a judge model reading text. That includes `assertions`,
which looks like an assertion library and is not one — the strings you write
there are handed to a model as part of its instructions. They make the judge's
task well defined. They do not replace it.

If you want a real string or number comparison, you have two options, and the
first one is usually right.

## Deterministic checks, without AWS

Vocion runs its own `checks` in-process. No model, no AWS account, no deploy:

```yaml
evals:
  - slug: refund-quality
    name: Refund handling
    agentSlug: support-agent
    items:
      - input: I want a refund for order 1182.
        expectedTrajectory: [lookup_order, issue_refund]
        checks:
          - toolCalled: issue_refund
          - toolNotCalled: escalate_to_human
          - outputContains: '1182'
          - outputNotContains: as an AI
          - latencyUnderMs: 8000
          - turnsUnder: 4
```

The vocabulary is closed — `toolCalled`, `toolNotCalled`, `outputMatches`,
`outputContains`, `outputNotContains`, `latencyUnderMs`, `turnsUnder`.
Arbitrary code in a workspace file would mean sandboxing it, timing it out, and
giving it a way out of the app. An unrecognised check is skipped rather than
failing the run, so a file written against a newer version of Vocion still
works.

## Choosing your grader

**An eval lives in one place.** A dataset's `provider` says who grades it —
`vocion` or `agentcore` — and that is the only grader that ever runs it. Omit
the key and you get `vocion`, which is what every dataset written before this
existed gets.

One grader, not several, because a dataset scored by two judges has two pass
rates and no answer: "is refund handling above 80%?" stops having one. Move a
dataset to AgentCore by changing the key; runs recorded before the switch keep
whichever grader produced them, and the dataset page says so rather than
passing old numbers off as the new grader's work.

The `evaluators` block then tunes that grader. Every evaluator in it has to
name the dataset's own provider — a mismatch is refused when the workspace is
applied, rather than applied and left waiting for a score that cannot arrive.

```yaml
evals:
  - slug: refund-quality
    name: Refund handling
    agentSlug: support-agent
    provider: agentcore
    evaluators:
      - provider: agentcore
        builtin: [Builtin.TrajectoryInOrderMatch, Builtin.ToolSelectionAccuracy]
      - provider: agentcore
        slug: tone-check
        level: TRACE
        instructions: |
          Grade whether the reply stays warm and plain-spoken. A reply that is
          correct but reads like a policy document fails.
        ratingScale:
          categorical:
            - label: pass
              description: Warm, plain, no jargon.
            - label: fail
              description: Correct but cold, or full of jargon.
```

Built-ins are named, not defined — nothing is created in your AWS account for
them. A custom judge like `tone-check` is a real AgentCore resource: Vocion
creates it the first time a run needs it, updates it when you edit the file,
and records the id so it is never created twice. If AWS refuses, the reason is
written to the evaluator row and shown on the dataset page, and the run goes
ahead without that one rather than failing entirely.

Trajectory matching costs no tokens. Every other AgentCore evaluator is a model
call you pay AWS for, which is why none of them are on by default.

## Deterministic evaluators inside AgentCore: the Lambda path

AgentCore's own escape hatch from judges is a `codeBased` evaluator: a Lambda
function in your account that AgentCore invokes with the transcript and that
returns a score. Vocion supports referencing one. It does not deploy one, and
that is deliberate — a Lambda is your code, in your account, on your release
cycle.

**Most teams should use Vocion's `checks` instead.** Reach for a Lambda when
you need something `checks` cannot express and you want it to run inside
AgentCore alongside your other AgentCore evaluators: scoring against a system
of record, a schema validation, a domain rule with real arithmetic in it.

To use one:

1. **Write and deploy the function.** It receives the evaluation payload and
   returns a score and an explanation. Follow the request and response shape in
   the [AgentCore Evaluations documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations.html)
   — that contract is AWS's, and it is the one to read, not this page.
2. **Let AgentCore invoke it.** The function's resource policy has to allow
   `bedrock-agentcore.amazonaws.com` to call it. Without that, every case comes
   back as an evaluator error.
3. **Reference it from the manifest:**

   ```yaml
   evaluators:
     - provider: agentcore
       slug: refund-rules
       level: TOOL_CALL
       lambdaArn: arn:aws:lambda:us-east-1:123456789012:function:refund-rules
   ```

4. **Apply the workspace and run the dataset.** Vocion creates the AgentCore
   evaluator pointing at your ARN and runs it like any other.

A `lambdaArn` wins over `instructions` on the same evaluator: an evaluator that
names a Lambda is a code-based one, and quietly grading it with a judge instead
would be a different measurement wearing the same name.

## Running, and running on a schedule

The refresh button and the scheduled refresh are the same thing — both start
the `evalRefreshWorkflow` Temporal workflow, so a hand-pressed run and a cron
run produce identical rows and the trend line cannot tell them apart.

`POST /api/v1/evals/<slug>/refresh` returns a run id as soon as the workflow is
accepted, with the run in `running`.

For a cadence, write an automation — the same place every other recurring thing
in a workspace lives:

```yaml
automations:
  - slug: nightly-evals
    when: {schedule: '0 6 * * *'}
    do: {job: refresh-evals}
```

With no input, that refreshes every dataset in the workspace. Narrow it with
`input: { dataset: refund-quality }` for one, or a list for a few. There is no
default cadence: an eval run spends model calls, and picking an hour to start
spending them is your decision, not ours. Cases execute eight at a time, and the
dataset's grader scores the finished transcripts. The whole dataset finishing
takes as long as its slowest case plus the grading, not the sum of everything.

Because the workflow id is the run group, a retried activity finds the rows it
already created. A worker dying halfway through does not put a second point on
your trend line for work that happened once.

## Reading the result honestly

Three things the UI does on purpose:

- **An evaluator that errored reads as "could not score", never as a fail.**
  "AWS timed out" and "the agent got it wrong" must not look the same.
- **A dashed line marks the run where the dataset version changed.** Scores
  either side of it are measuring different cases. Without the mark, editing
  the cases to be easier looks exactly like the agent getting better.
- **A provider you have never used and cannot use is not mentioned at all.** No
  AWS credential means no AgentCore section, no empty chart, no invitation to
  set something up you did not ask about.

## Requirements and limits

- An AWS credential connected to the workspace, with permission for
  `bedrock-agentcore:Evaluate`, and for `CreateEvaluator` / `UpdateEvaluator`
  if you author custom evaluators.
- A region where AgentCore Evaluations exists. Vocion checks this before the
  run and says so, rather than failing every case. Set
  `VOCION_AGENTCORE_EVAL_REGIONS` to override the list when AWS adds a region.
- AgentCore's judges are billed by AWS per evaluation, on your account. Vocion
  does not mark them up and does not turn any of them on for you.
- Taking an evaluator out of the workspace file retires it: it stops grading
  immediately, and the row is kept so Vocion still knows which evaluator in
  your AWS account belongs to this dataset. Putting it back in the file revives
  the same one. Vocion never calls AWS `DeleteEvaluator`, so deleting the
  evaluator in AWS is yours to do, in the console or the CLI.
- Two refreshes of the same dataset fired in the same instant can each write a
  run. The index that would make that impossible has to be built concurrently
  on a table that already has rows, and a concurrent build cannot be unique, so
  the rule lives in code instead. The visible symptom is one duplicated point
  on the trend line, not damaged data.
- Pass rates and judge scores are stored as `real`. That is display precision —
  fine for a percentage on a chart, not the column to use if scores ever become
  something anyone is billed against.
