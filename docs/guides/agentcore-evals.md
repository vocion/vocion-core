# Evals graded by AWS AgentCore

Vocion's own judge is not the only opinion you can get about an agent. If your
workspace runs on AWS, a dataset can be scored by Amazon Bedrock AgentCore
Evaluations instead, and the eval section says so everywhere the numbers
appear.

One eval, one grader. An eval scored by two judges has two pass rates and so
answers nothing: to compare the graders, point two datasets at the same agent
and read them side by side, where it is obvious that they are two
measurements.

## Set one up, start to finish

Five steps. Nothing here needs an AWS console visit except making the key.

**1. Make an IAM key AWS will accept.** AgentCore Evaluations needs an access
key pair — long-lived (`AKIA…`) or temporary (`ASIA…`) — whose policy allows
every AgentCore call Vocion's eval code makes. Print that policy, with your
account, region and eval execution role filled in, and attach it to the key's
IAM user or role through your own IaC:

```bash
ENV=dev AWS_PROFILE=<operator-profile> REGION=<region> \
  bash infra/agentcore/check-evals-key.sh --print-policy
```

It covers the datasets (`CreateDataset` and the example calls), `Evaluate`,
custom evaluators (`CreateEvaluator`, `UpdateEvaluator`), batch evaluations
(`StartBatchEvaluation`, `GetBatchEvaluation`), online evaluation configs, and
`iam:PassRole` on the eval execution role `provision.sh` created. The create,
start and `Evaluate` calls sit on `"*"` because AWS gives them no resource type
to scope to; everything else is scoped to your account's resources.

A key missing any of these does not fail the run. It degrades it quietly:
"Could not copy these cases to AgentCore" means no `CreateDataset`, "Some
evaluators this dataset declares could not be set up" means no
`CreateEvaluator`, and the scores come back without those checks. So check
the key before the first run, and again after every core pin bump:

```bash
PRINCIPAL_ARN=arn:aws:iam::<account>:user/<key-user> \
ENV=dev AWS_PROFILE=<operator-profile> REGION=<region> \
  bash infra/agentcore/check-evals-key.sh
```

It asks IAM's policy simulator, so it makes no AgentCore call and costs
nothing. Run it with an operator profile allowed `iam:SimulatePrincipalPolicy`,
not with the eval key. It exits non-zero and names each denied action.

**2. Connect it to the workspace.** `/dashboard/developers` → **API
credentials** → add a credential on the **AWS** platform. It takes two fields,
`accessKeyId` and `secretAccessKey`. One AWS credential per workspace; saving a
second replaces the first.

**3. Check the region.** The deployment's `AWS_REGION` decides where the calls
go, and AgentCore Evaluations does not exist everywhere. Vocion ships the list
it knows — `us-east-1`, `us-west-2`, `eu-central-1`, `ap-southeast-2` — and
refuses the run with one sentence rather than failing every case if you are
somewhere else. When AWS adds a region, set `VOCION_AGENTCORE_EVAL_REGIONS`
rather than waiting for a Vocion release.

**4. Write the dataset.** `evals/<slug>.yaml` in your workspace. The smallest
thing that works:

```yaml
# evals/refund-quality.yaml — one dataset per file, no wrapping key
slug: refund-quality
name: Refund handling
agentSlug: support-agent
provider: agentcore
items:
  - input: I want a refund for order 1182.
    expectedTrajectory: [lookup_order, issue_refund]
```

`provider: agentcore` is the whole switch. With no `evaluators` block you get
`Builtin.TrajectoryInOrderMatch`, which runs no model and so costs nothing per
case — a deliberate default, because the alternative is turning on a judge
somebody has to pay for without being asked. Add an `evaluators` block when you
want more, as below.

**5. Apply and run.** `./scripts/apply-workspace.sh` (or whatever your
deployment runs on push), then open `/dashboard/evals/refund-quality` and press
refresh. The page shows the copy landing in AWS — including AWS's own dataset
id, which is what you search for in the Bedrock console — and then the scores,
each with the explanation AWS wrote.

A run that finds nothing to score is the usual first result, and the usual
cause is `expectedTrajectory` naming tools the agent does not have. The tool
names are the agent's own, spelled exactly.

## Field reference

On the dataset:

| Field | What it does for AgentCore |
|---|---|
| `provider: agentcore` | Sends this dataset's transcripts to AWS. Omitted, you get `vocion`. |
| `evaluators` | Which AgentCore evaluators run. Each entry must repeat `provider: agentcore`; a mismatch is refused when the workspace is applied. |

On each case:

| Field | Read by | Notes |
|---|---|---|
| `input` | always | The message sent to the agent. Cannot be blank — the file is refused. |
| `expectedTrajectory` | SESSION evaluators | The tools this case should call, in order. The only ground truth scored without a model. |
| `expectedOutput` | TRACE and TOOL_CALL evaluators | What a good answer contains, not the exact words. |
| `assertions` | every level | Facts the answer must state. Handed to a judge model as instructions — not string-matched. |
| `rubric` | judges | Per-case grading criteria. |
| `checks` | **`vocion` only** | Refused on an AgentCore dataset, because they would be written, applied and then silently never run. |

On each evaluator:

| Field | Notes |
|---|---|
| `builtin` | A list of AWS evaluator ids, e.g. `Builtin.TrajectoryInOrderMatch`. Named, never created. |
| `slug` | Names a custom evaluator. Vocion creates it in your account on first use and updates it when you edit the file. |
| `level` | `SESSION`, `TRACE` or `TOOL_CALL`. Decides which ground truth AWS will accept — see below. |
| `instructions` | The grading prompt for a custom judge. |
| `ratingScale` | What that judge may return: `categorical` labels, each with a `label`, a numeric `value` and an optional `description`, or a `numerical` list of values. The value is what gets plotted, so a label with no number would have no position on the chart. |
| `model` | Which model judges. The provider's default when omitted. |
| `lambdaArn` | An existing Lambda of yours. Wins over `instructions` on the same evaluator. |

**The level is not cosmetic.** AWS validates the ground truth against it and
refuses the whole request for a field that does not belong: a SESSION-level
evaluator accepts `expectedTrajectory` and `assertions` and rejects
`expectedOutput`; TRACE and TOOL_CALL are the other way round. Vocion sends
only the fields the level accepts, so a case that authors both is fine — but it
does mean an expected answer is invisible to a trajectory evaluator, and a
trajectory is invisible to a judge. If you want both graded, name both
evaluators.

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

## Three ways AgentCore evaluates, and what each one answers

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
means an agent instrumented and delivering spans there. On-demand needs none of
that — it is the shape Vocion's dataset runner uses, and it works wherever your
agent runs.

Vocion supports all three, and they answer different questions. On demand is
the primary path because it is synchronous and always available; batch runs
beside it as the audit trail; online watches production. The last two are both
off by default and both cost money while they run — each has its own section
below, with what it does and does not tell you.

Worth being clear about what the live-traffic shape can and cannot tell you.
Nobody wrote down the right answer for a real customer's question, so online
evaluation judges a session against itself: was the reply responsive, was it
grounded in what the tools returned. That is a health signal, not a pass rate.
The way the two meet is a person promoting a bad live session into a dataset
and writing the expected answer — after which it is a regression case like any
other.

## Tracing the agent runtime, so AWS can see real runs

Everything above scores cases Vocion ran on purpose. Batch evaluation, online
evaluation and the GenAI Observability console all want something else: the
spans from your agent's real work, in your own AWS account. The agent runtime
emits those, and this section is how to turn them on and how to tell whether
they arrived.

**What you get.** Each turn becomes a trace in CloudWatch: the prompt, the
reply, every tool call with its arguments and its result, and the timings. Two
things follow from having them. A person can open the GenAI Observability
console and watch a session without going through Vocion — which is what a
client's own security or ops team usually wants. And batch evaluation becomes
possible, because it finds sessions by reading the `aws/spans` log group rather
than being handed a transcript.

**What it costs.** Span ingestion is billed per span, and turning this on turns
on a bill that grows with traffic. Transaction Search is what writes spans into
CloudWatch Logs; `infra/agentcore/provision.sh` enables it and sets the
indexing rule to 1%, which keeps the indexed (more expensive) portion small
while every span is still stored and searchable. Check AWS's CloudWatch pricing
page before enabling it in production — do not take a number from this guide.

### Turning it on

Tracing is on by default when you deploy the runtime:

```bash
ENV=dev AWS_PROFILE=<your-aws-profile> bash infra/agentcore/deploy-runtime.sh
```

To deploy a runtime that emits nothing:

```bash
OBSERVABILITY=false ENV=dev AWS_PROFILE=<your-aws-profile> bash infra/agentcore/deploy-runtime.sh
```

Two things have to be in place first, and `infra/agentcore/provision.sh` does
both:

- **Transaction Search on, in the region the runtime runs in.** Without it the
  X-Ray OTLP endpoint takes the spans and nothing reaches CloudWatch Logs.
- **The runtime role can write traces.** `xray:PutTraceSegments` is the action
  the OTLP traces endpoint checks, and the role provision.sh creates has it.

### How it is put together, and why

The pieces are worth knowing because each one fails quietly rather than loudly.

- **The exporter is AWS's OpenTelemetry distro**, loaded by `--require` in the
  Dockerfile. It owns the connection to CloudWatch and signs the requests with
  the runtime's own credentials. It is the one dependency that is installed in
  the image rather than bundled, because it has to run before any of our code.
- **The spans come from OpenInference's LangChain instrumentation**, registered
  by hand in `packages/agent-runtime/src/telemetry.ts`. By hand because the
  runtime ships as a single esbuild bundle, so there is no module loading left
  for auto-instrumentation to hook. The scope name it emits,
  `@arizeai/openinference-instrumentation-langchain`, is one AWS documents as
  supported; a scope AWS does not recognise makes it refuse the whole session
  with "Provided input has no spans with supported scope".
- **`session.id` is set per turn**, from the caller's session id, and carried
  on the OpenTelemetry context so every span in the turn picks it up —
  including the ones from inside a tool. A span without it is accepted, looks
  correct in the console, and matches no evaluation.

The environment variables the deploy script sets, and what each one decides,
are documented in `infra/agentcore/deploy-runtime.sh` next to the code that
sets them.

### Checking that spans actually arrive

In order, cheapest first.

```bash
# 1. Is the runtime deployed with tracing on?
aws --profile "$AWS_PROFILE" --region us-west-2 bedrock-agentcore-control \
  get-agent-runtime --agent-runtime-id "$RUNTIME_ID" \
  --query 'environmentVariables.AGENT_OBSERVABILITY_ENABLED'

# 2. Is Transaction Search on in this region?
aws --profile "$AWS_PROFILE" --region us-west-2 xray get-trace-segment-destination

# 3. Did any spans land in the last hour?
aws --profile "$AWS_PROFILE" --region us-west-2 logs start-query \
  --log-group-name 'aws/spans' \
  --start-time "$(($(date +%s) - 3600))" --end-time "$(date +%s)" \
  --query-string 'fields @timestamp, attributes.session.id, name | limit 20'
```

The runtime also says so itself. If it starts with
`AGENT_OBSERVABILITY_ENABLED` set but nothing is carrying OpenTelemetry
context — the usual cause being a container started without the `--require`
flag — it logs a line naming that, because the alternative is spans that arrive
with no session id and evaluations that quietly score nothing.

Two symptoms and what they mean:

| What you see | What it is |
| --- | --- |
| No trace at all in the console | Transaction Search off, or the role cannot write traces |
| Traces present, but an evaluation scores nothing | Spans have no `session.id` — check the runtime's startup log |

## Batch evaluation: a score someone can check without you

The on-demand path returns a score and AWS keeps nothing. That is fine for a
trend line and weak as evidence — the only record is a row in Vocion, and "our
tool says our agent is good" is not what a client's security team is asking
for.

Batch evaluation answers the other way round. AWS reads the spans the agent
runtime really wrote into CloudWatch, grades them server-side, keeps the job,
and writes the per-session detail to a log group in the customer's own account.
Someone who has never used Vocion can open it and read the result.

It is **off by default** and turning it on spends money on the customer's AWS
bill, so it is a decision, not a default.

### Turning it on

Two environment variables on the Vocion deployment:

```bash
# Start a batch job alongside every AgentCore-graded eval run.
VOCION_AGENTCORE_BATCH_EVALS=1

# Only if the runtime was deployed with a different service name or the spans
# go somewhere other than the shared group. Defaults shown.
VOCION_AGENTCORE_SPAN_SERVICE_NAMES=vocion_agent_runtime_dev
VOCION_AGENTCORE_SPAN_LOG_GROUPS=aws/spans
```

Preconditions, all of which are the tracing section above: the agent runtime
deployed with tracing on, Transaction Search enabled in the region, and the
org's AWS credential connected. With the flag on and any of those missing, no
job is started and the on-demand run is unaffected.

`VOCION_AGENTCORE_SPAN_SERVICE_NAMES` must match the `service.name` the runtime
was deployed with, exactly. This is the quietest failure in the whole feature:
a name that matches nothing makes AWS find zero sessions, grade all of them,
and report success. Vocion treats a job that graded nothing as a failure for
exactly this reason, but the fix is to check the name.

### What happens, in order

1. The dataset runs. Each case is executed by the agent, and because the eval
   runner names the session, the runtime stamps every span from that case with
   `session.id = <dataset-slug>-<case-index>`.
2. The on-demand scores are produced and stored, exactly as before. Everything
   after this point is the audit trail and cannot affect them.
3. Vocion starts a batch job naming those session ids, carrying the same
   expected answers, and writes the job's identifiers to `eval_batch_job`
   before AWS is called — so a crash cannot lose a job that is running.
4. The Temporal workflow sleeps and polls, up to half an hour. Nothing is held
   open while it waits.
5. When the job stops, the per-evaluator averages are stored under the
   `agentcore-batch` provider, and the job row records where AWS wrote the
   per-session detail.

### Reading the result

A batch score is **an average over sessions**, not a per-case result. It is
filed under its own provider id so it never shares a line with on-demand
scores, which are a different kind of number. The per-case detail lives in
AWS, not in Vocion.

```bash
# What the job did.
aws --profile "$AWS_PROFILE" --region us-west-2 bedrock-agentcore \
  get-batch-evaluation --batch-evaluation-id "$BATCH_ID"

# Every job Vocion has started.
aws --profile "$AWS_PROFILE" --region us-west-2 bedrock-agentcore list-batch-evaluations
```

In the console: CloudWatch → GenAI Observability → Bedrock AgentCore →
Evaluations.

### What each failure means

| What you see | What it is |
| --- | --- |
| "found no sessions" | The service name, the log group or the session ids do not match what the runtime emitted. Check `VOCION_AGENTCORE_SPAN_SERVICE_NAMES` first |
| `COMPLETED_WITH_ERRORS` | Some sessions graded, some did not. The averages are kept and cover fewer cases than the dataset has |
| `FAILED` | AWS refused the job. `errorDetails` says why — usually the credential cannot read the log group |
| No job at all | The flag is off, the dataset is not graded by AgentCore, or the org has no AWS credential |

### Cost

Batch is cheaper than on demand: **$0.0018 per 1,000 input tokens and $0.009
per 1,000 output** against $0.0024 and $0.012 for the same built-in evaluators
(read from AWS's pricing page on 2026-09-17 — check it again before committing
to a cadence, and do not trust this paragraph). Running batch alongside
on-demand means paying for both, which is the price of the audit trail.

## Online evaluation: scoring live traffic continuously

The two paths above grade cases somebody wrote. This one grades what real
people actually asked the agent: AWS samples a share of live sessions, scores
them as they happen, and publishes the results as CloudWatch metrics you can
alarm on.

**Read these two limits first.** Neither is obvious from the API, and both
change what the number means.

**It cannot grade against an expected answer.** Nobody wrote down the right
reply to a real customer's question, so every evaluator here judges a session
against itself — was the reply responsive, was it grounded in what the tools
returned. That is a health signal, not a pass rate. A trajectory evaluator has
nothing to match against, so Vocion refuses to configure one and tells you
which of your choices it dropped. To grade correctness, use a dataset.

**It bills for as long as it exists.** Every sampled session is a paid judge
call on the customer's account, every day, whether or not anyone reads the
number. The sampling percentage is the dial and the enable switch is the tap;
neither is a one-way door.

### Setting it up

One prerequisite, which `infra/agentcore/provision.sh` creates: an IAM role AWS
assumes to read the spans and write the results. Creating the role costs
nothing and starts nothing.

```bash
# Creates VocionAgentCoreEvaluationExecution and writes its ARN to SSM.
ENV=dev AWS_PROFILE=<your-aws-profile> bash infra/agentcore/provision.sh

# Point Vocion at it.
VOCION_AGENTCORE_EVAL_EXECUTION_ROLE_ARN=arn:aws:iam::<account>:role/VocionAgentCoreEvaluationExecution
```

Then create the configuration from Vocion. **It is created switched off**, on
purpose: a configuration that starts sampling the moment it exists means the
first anyone hears about the cost is the bill. Look at it, then enable it.

```ts
// Exists, sampling nothing, costing nothing.
await client.evals.online.setUp({});

// Check what AWS actually thinks before spending anything.
await client.evals.online.status();

// Now it is scoring 5% of live sessions, and charging for them.
await client.evals.online.setEnabled({ enabled: true });
```

Ask for specific evaluators with `setUp({ evaluatorIds: [...] })`. Anything
needing a right answer is refused rather than dropped, and the reply names what
it would not run and why.

One configuration per workspace and region. Asking twice returns the one that
exists rather than making a second — two configurations over the same traffic
would sample it twice and bill twice.

### The two dials

```ts
// Stop sampling and stop the bill. Keeps the configuration and its history.
await client.evals.online.setEnabled({ enabled: false });

// Keep the signal, spend less on it. Usually the better answer to a bill
// that came in higher than expected.
await client.evals.online.setSampling({ samplingPercentage: 1 });

// Remove it from the customer's account entirely. Rarely what you want.
await client.evals.online.tearDown();
```

### Is it costing me anything right now?

Two different questions, which is why there are two status fields:

| `status` | `enabled` | What it means |
| --- | --- | --- |
| `ACTIVE` | `true` | Sampling live traffic and billing for it |
| `ACTIVE` | `false` | Exists, sampling nothing, costing nothing |
| `CREATING` | `false` | Not ready yet |
| `CREATE_FAILED` | `false` | Never started — `failureReason` says why, usually the execution role |

`evals.online.status()` asks AWS and updates the stored answer before returning
it, which is deliberate: AWS owns this resource, a create can fail after it
returned, and somebody can change it in the console. Telling a person they are
not being charged when they are is the one answer this must never give.

### Where the results appear

Per-session results land in `/aws/bedrock-agentcore/evaluations/results/<config-id>`
as EMF, which publishes them as CloudWatch metrics under the
`Bedrock-AgentCore/Evaluations` namespace. From there they render in CloudWatch
→ GenAI Observability → Bedrock AgentCore → Evaluations, with session, trace
and span drill-down, and they can carry a CloudWatch alarm — "page someone when
correctness drops below 0.8" — which is the thing this path can do that neither
of the others can.

### When to use which

| Question | Path |
| --- | --- |
| Did this change break anything? | On-demand, over a dataset |
| Can someone else verify that score? | Batch, in their own account |
| Is quality drifting in production? | Online |
| Is the agent correct? | Not online — it has no right answer to compare against |

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
- Only one publisher per dataset at a time, held by a lease on the publish row
  (`eval_dataset_remote.publish_lease_until`). A schedule firing next to a
  hand-pressed run makes the second one skip the copy and run anyway, rather
  than queue behind an AWS round trip. The lease expires after fifteen minutes,
  so a process that dies mid-publish does not lock the dataset out for good.
  (It is a lease rather than a Postgres advisory lock because every query here
  comes off a connection pool: the lock and its release would usually land on
  different connections, and the release would free nothing.)

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

Cost: the judging is billed to your account, the same as any other AgentCore
evaluator call. AWS's pricing page (read 2026-09-17) lists **$0.0024 per 1,000
input tokens and $0.012 per 1,000 output tokens** for a built-in evaluator, and
**$1.50 per 1,000 evaluations** for a custom one, with that evaluator's own
model usage billed separately. Storing a dataset and its versions carries no
line item on that page. Trajectory matching runs no model at all, so a
trajectory-only dataset costs nothing per case beyond the agent run itself.
Prices move — read the page rather than this paragraph before quoting a
number to anyone.

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
# evals/refund-quality.yaml
slug: refund-quality
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
# evals/refund-quality.yaml
slug: refund-quality
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
          value: 1
          description: Warm, plain, no jargon.
        - label: fail
          value: 0
          description: Correct but cold, or full of jargon.
items:
  - input: I want a refund for order 1182.
    expectedTrajectory: [lookup_order, issue_refund]
    expectedOutput: Confirms the refund and names the amount.
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
   # in evals/<slug>.yaml, alongside slug / name / agentSlug / provider
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
# automations/nightly-evals.yaml
slug: nightly-evals
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
- **Each evaluator gets its own line under its grader's pass rate.** An agent
  whose answers improve while its tool use rots holds a flat pass rate the
  whole way; only the per-evaluator lines show which half moved. Evaluators
  that return a label rather than a number are not plotted, because they have
  no honest position on a 0–1 axis.
- **A run a grader refused says why, on the run page.** AWS denying the
  credential and a case failing on its merits are different problems, and
  `eval_run.error_message` keeps the reason where the person who pressed the
  button will look for it.
- **A provider you have never used and cannot use is not mentioned at all.** No
  AWS credential means no AgentCore section, no empty chart, no invitation to
  set something up you did not ask about.

## When AWS refuses the request

These are real messages from `Evaluate`, with what each one means. All of them
are things Vocion now gets right — they are here because a workspace, a Lambda
or a hand-built integration can still produce them, and the wording gives no
hint on its own.

| Message | What it means |
|---|---|
| `Fields {'expectedResponse'} are not valid for SESSION-level context` | Ground truth was sent that this evaluator's level does not accept. See the level note above. |
| `Provided input has no spans with supported scope` | The spans did not name an instrumentation AWS knows how to parse. AWS reads a fixed set of scopes; anything else is not merely ignored, it fails the call. |
| `The evaluationReferenceInputs contain contexts that do not match any session` | The expected answers were addressed to a session id that no span carries. |
| `Session span data is incomplete … missing a corresponding log event` | The conversation was in span attributes. AWS reads the prompt from a `gen_ai.user.message` event and the reply from a `gen_ai.choice` event. |
| `Failed to parse tool_output from tool-span` | A tool span carried its result where its arguments belong. Arguments go in `gen_ai.tool.message`; the result goes in that span's `gen_ai.choice`. |

Every one of these fails the whole case rather than scoring it low, which is
the behaviour you want — but it does mean a misconfigured setup looks like an
agent that cannot be measured rather than an agent that is bad. The dataset
page says which it is.

## Requirements and limits

- An AWS credential connected to the workspace whose policy passes
  `infra/agentcore/check-evals-key.sh` (step 1 above).
- A region where AgentCore Evaluations exists. Vocion checks this before the
  run and says so, rather than failing every case. Set
  `VOCION_AGENTCORE_EVAL_REGIONS` to override the list when AWS adds a region.
- AgentCore's judges are billed by AWS per evaluation, on your account, at the
  rates above. Vocion does not mark them up and does not turn any of them on
  for you.
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
