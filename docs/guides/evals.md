# Evals: who grades your agent, and how the pieces connect

**Who this is for:** anyone who has to set up, verify, explain or debug agent
evaluation in Vocion — whether or not they have used AWS before. It assumes you
can run a shell command and read YAML. It does not assume you know what a span
is, what CloudWatch Transaction Search does, or why any of this needs an IAM
role.

Read section 1 and you will be able to explain the system to someone else. Read
through section 9 and you will be able to stand it up and prove it works.

**The one sentence to hold onto:** Vocion runs the agent, a grader scores it,
and when that grader is AWS the only thing connecting the two is a session id
written into a log group.

---

## Table of contents

1. [Two graders, and why there are two](#1-two-graders-and-why-there-are-two)
2. [A dataset, written both ways](#2-a-dataset-written-both-ways)
3. [What happens when a run happens](#3-what-happens-when-a-run-happens)
4. [The three shapes of AgentCore grading](#4-the-three-shapes-of-agentcore-grading)
5. [AWS concepts, from the ground up](#5-aws-concepts-from-the-ground-up)
6. [The architecture, end to end](#6-the-architecture-end-to-end)
7. [What AWS is doing while a job runs](#7-what-aws-is-doing-while-a-job-runs)
8. [Setting it up, with a check after every step](#8-setting-it-up-with-a-check-after-every-step)
9. [Proving it works](#9-proving-it-works)
10. [Troubleshooting](#10-troubleshooting)
11. [What it costs](#11-what-it-costs)
12. [Where it lands in the database](#12-where-it-lands-in-the-database)
13. [Choosing a grader](#13-choosing-a-grader)

---

## 1. Two graders, and why there are two

An **eval** is a fixed set of questions you put to an agent so you can tell
whether it is getting better or worse. A **grader** is whatever decides how good
each answer was.

Every eval dataset in Vocion names exactly one grader, on a single `provider`
line in its YAML — either `provider: vocion`, our own judge and the default, or
`provider: agentcore`, which hands the scoring to Amazon Bedrock AgentCore.

They answer different questions.

| | **Vocion** | **AgentCore** |
|---|---|---|
| Who scores | Our judge model, plus deterministic checks | AWS's evaluators, in the customer's own AWS account |
| Setup | None | Provision AWS, deploy the runtime with tracing, connect a key |
| Cost | Our model bill | The customer's AWS bill |
| Custom grading | `checks` and a rubric | Custom judges, plus a Lambda hook |
| Who can verify the score | Anyone with Vocion | Anyone with the AWS account, **without Vocion** |

That last row is the entire reason AgentCore support exists. "Our tool says our
agent is good" is a weak claim to a client's security team. A score sitting in
the client's own CloudWatch, produced by AWS reading what the agent really did,
is a claim they can check without us — and could still check if they stopped
using us tomorrow.

**Vocion is the default and always will be.** A dataset with no `provider` line
grades with our judge, exactly as it did before AgentCore support existed.
AgentCore is additive: a second opinion you opt into per dataset, never a
replacement.

---

## 2. A dataset, written both ways

Same questions, each grader.

### Graded by Vocion

```yaml
slug: refund-quality
name: Refund answers
agentSlug: support-agent
provider: vocion # the default; you can leave it out

items:
  - input: I want a refund for order 4821
    expectedOutput: Confirms the refund and states the amount
    rubric: Must not promise a delivery timeline we do not control
    assertions:
      - names the refund amount
      - tells the customer when to expect it
    checks:
      - toolCalled: lookup_order
      - outputNotContains: guarantee
      - latencyUnderMs: 8000
```

Two layers, doing different jobs:

- **`checks` are deterministic.** They run inside Vocion, in process. No model,
  no AWS, no cost, and they cannot be flaky — the same transcript always
  produces the same result. The whole vocabulary is `toolCalled`,
  `toolNotCalled`, `outputMatches` (a regular expression), `outputContains`,
  `outputNotContains`, `latencyUnderMs`, `turnsUnder`.
- **`rubric` and `assertions` are the judge's brief.** A model reads them and
  scores the answer. They make the judge's job well defined; they do not replace
  it. If you want a real string comparison, that is a `check`.

There is no plugin point for arbitrary grading code on the Vocion path. If what
you need is not one of those seven checks, this grader cannot express it today.

### Graded by AgentCore

```yaml
slug: refund-quality-aws
name: Refund answers (AWS graded)
agentSlug: support-agent
provider: agentcore

evaluators:
  # AWS's own evaluators, named by id.
  - provider: agentcore
    builtin:
      - Builtin.TrajectoryInOrderMatch # compares tool order — no model call, so free
      - Builtin.Correctness # a judge model, so it costs tokens

  # A judge you write, created in the customer's AWS account.
  - provider: agentcore
    slug: tone-check
    instructions: |
      Score whether the reply stays calm and never blames the customer.
    level: SESSION
    ratingScale:
      categorical:
        - {label: Calm, value: 1}
        - {label: Blaming, value: 0}

items:
  - input: I want a refund for order 4821
    expectedOutput: Confirms the refund and states the amount
    expectedTrajectory: [lookup_order, issue_refund] # ground truth for trajectory evaluators
    assertions:
      - names the refund amount
    checks:
      - toolCalled: lookup_order # still runs in Vocion — checks are grader-agnostic
```

Three things differ:

- **You name the evaluators.** Vocion has one judge; AgentCore has a catalogue
  and you choose from it.
- **`expectedTrajectory` is ground truth for the trajectory evaluators**, which
  are the only scoring AWS does with no model call — and therefore the only free
  ones. If you care about *which tools the agent used, in what order*, this is
  the cheapest signal in the whole system.
- **A custom judge is `instructions` plus a `ratingScale`.** We create it in the
  customer's AWS account, so every evaluator lives in one place.

**Evaluator levels.** `level` decides what a judge looks at: `TOOL_CALL` scores
one tool invocation, `TRACE` scores one turn, `SESSION` scores the whole
conversation. Pick the smallest thing that can answer your question — a
session-level judge cannot tell you which turn went wrong.

**Real evaluation code.** `lambdaArn` references a Lambda function the customer
has already built and deployed. Nothing in this repo deploys it — we only point
at the ARN. That is the only route to arbitrary evaluation code today, and it is
AgentCore-only.

**The schema refuses a mismatch.** An evaluator whose `provider` is not the
dataset's is rejected at apply time, because nothing would ever run it. You will
see the error when you apply the workspace, not weeks later when a number looks
wrong.

---

## 3. What happens when a run happens

`EvalService.runDatasetAndScore` does this, in order:

1. **Run the agent** over every case in the dataset. This produces transcripts —
   the answer, the tools called, the latency, any error.
2. **Write the run row and the transcripts** to the database.
3. **Score with the dataset's grader.** This is the number you see in the UI, and
   it comes back from a single call.
4. **Optionally start an AWS batch job** over the sessions that just ran — only
   when `VOCION_AGENTCORE_BATCH_EVALS=1` *and* the dataset is AgentCore-graded.

Step 4 is bolted onto the end deliberately. If it fails, you still have step 3's
score. **Batch is the audit trail, not the primary measurement.** Nothing about
turning it on can cost you the number you already had.

---

## 4. The three shapes of AgentCore grading

This is the part that surprises people. "AgentCore grades it" means three
genuinely different things, with different prerequisites.

| | What it reads | Tracing needed? | Kept in AWS? | When it runs |
|---|---|---|---|---|
| **On-demand** | A transcript Vocion puts in the request body | No | No | Step 3 above, synchronously |
| **Batch** | The real spans the agent emitted | **Yes** | Yes — job plus per-session detail | Step 4, minutes later |
| **Online** | Live production traffic, sampled | **Yes** | Yes | Continuously, until switched off |

**On-demand** is the simple one. Vocion synthesizes spans from the finished
transcript, posts them in the request body, AWS scores them and returns a number.
AWS stores nothing, so the only record is the row Vocion writes. It needs no
tracing and no provisioning beyond an AWS key. It is also the weakest claim —
AWS graded what *we told it* the agent did.

**Batch** is the honest one. AWS reads the spans the agent genuinely wrote into
CloudWatch, scores them on its own side, keeps the job, and writes per-session
detail into a log group the customer owns. Everything in sections 5 to 9 exists
to make this possible.

**Online** grades production traffic on a standing configuration. It **cannot
use ground truth** — nobody wrote down the right answer for a real customer's
question — so it is a health signal, not a pass rate. Ground-truth evaluators are
refused rather than silently dropped, so you cannot accidentally publish a
meaningless number that looks like correctness. It bills for as long as it
exists, which is why it is always created switched off.

---

## 5. AWS concepts, from the ground up

If you already know OpenTelemetry and CloudWatch, skip to section 6.

### A span is one thing that happened

When code is **instrumented**, it emits a small record every time it does
something interesting — calls a model, runs a tool, enters a step. That record is
a **span**: a name, a start and end time, and a bag of attributes.

Spans nest. A **trace** is a tree of spans sharing one `trace_id` — one complete
operation, like a single turn of a conversation.

A **session** groups traces. Several turns of one conversation share a
`session.id`. **This is the identifier the entire eval integration hangs on**,
because "grade this conversation" means "grade the spans carrying this session
id".

### OpenTelemetry is the standard; ADOT is AWS's build of it

**OpenTelemetry (OTel)** is the vendor-neutral standard for emitting spans.
**ADOT** — the AWS Distro for OpenTelemetry — is AWS's packaging of it, already
knowing how to sign requests to AWS endpoints. The agent container loads it with
`node --require @aws/aws-distro-opentelemetry-node-autoinstrumentation/register`.

It has to be `--require`d rather than imported, because instrumentation must
install itself *before* the libraries it patches are loaded.

### Why LangChain is instrumented by hand

Automatic instrumentation works by intercepting module loading — when your code
asks for `langchain`, the instrumentation hands back a wrapped copy.

Our agent runtime ships as a **single esbuild bundle**: every dependency is
already inlined into one file. There is no module loading left to intercept, so
auto-instrumentation silently does nothing.

That is why `packages/agent-runtime/src/telemetry.ts` exists. It calls
`manuallyInstrument(CallbackManagerModule)` to attach the instrumentation
directly. If you ever see spans with no LangChain detail in them, this is the
first place to look.

### Why every span carries a session id

Each turn runs inside `withSession(...)`, which puts the session id into the
OpenTelemetry **context** — an ambient value that travels with the async call
stack, so every span created during that turn picks it up without being passed
the id explicitly.

There is a subtlety worth knowing because it caused a real bug: OpenTelemetry
needs a **context manager** registered, or `context.with()` runs your callback
but the value never actually propagates. ADOT registers one. If it is missing,
spans are emitted with no session id and batch evaluation silently matches
nothing. `telemetry.ts` probes for this at startup and logs loudly if it is
wrong, precisely so this fails visibly.

### Transaction Search is the switch that makes spans readable

Spans go to an X-Ray endpoint. By default they land in X-Ray, where the
evaluation service cannot read them.

**CloudWatch Transaction Search** changes that: turn it on, and AWS also writes
every span as a structured log event into a log group called `aws/spans`. That
log group is what AgentCore Evaluations queries.

Two consequences:

- **Nothing works until Transaction Search is on.** `provision.sh` turns it on.
- **It starts a bill**, charged by span volume ingested into CloudWatch Logs.
  Sampling is set to 1%.

### The IAM roles, and which does what

| Role | Who assumes it | What it is for |
|---|---|---|
| `VocionAgentRuntimeRole-<env>` | AgentCore Runtime | Runs your agent: calls models, writes logs and spans, pulls the container from ECR |
| `VocionAgentCoreEvaluationExecution` | The AgentCore Evaluations service | **Online evaluation only.** Lets AWS read `aws/spans` on your behalf, write results, publish metrics, and call judge models |

**Batch evaluation does not use an execution role.** It is a data-plane call made
with *your* credentials — whatever key Vocion holds for that org. Only online
evaluation, which runs continuously with nobody watching, needs a role AWS can
assume by itself.

---

## 6. The architecture, end to end

```
   ┌───────────────────────────────────────────────────────────────┐
   │ VOCION                                                        │
   │                                                               │
   │  eval dataset (YAML)                                          │
   │        │                                                      │
   │        │ evalCaseSessionId("refund-quality", 0)               │
   │        │     = "refund-quality-0"                             │
   │        v                                                      │
   │  EvalService ──── invoke, with payload.sessionId ────┐        │
   │        │                                             │        │
   │        │ 3. on-demand score (immediate)              │        │
   │        v                                             │        │
   │  eval_run / eval_score  <───────────────┐            │        │
   └─────────────────────────────────────────┼────────────┼────────┘
                                             │            │
   ┌─────────────────────────────────────────┼────────────┼────────┐
   │ CUSTOMER'S AWS ACCOUNT                  │            v        │
   │                                         │   ┌──────────────┐  │
   │                                         │   │ AgentCore    │  │
   │                                         │   │ Runtime      │  │
   │                                         │   │ (your agent) │  │
   │                                         │   └──────┬───────┘  │
   │                                         │          │ spans    │
   │                                         │          v          │
   │                                         │   X-Ray endpoint    │
   │                                         │          │          │
   │                                         │  Transaction Search │
   │                                         │          │          │
   │                                         │          v          │
   │                                         │   ┌──────────────┐  │
   │                                         │   │  aws/spans   │  │
   │                                         │   │  log group   │  │
   │                                         │   └──────┬───────┘  │
   │                                         │          │ read by  │
   │   4. StartBatchEvaluation ──────────>  ┌┴──────────v───────┐  │
   │      "grade sessions                   │ AgentCore         │  │
   │       [refund-quality-0, ...]          │ Evaluations       │  │
   │       in vocion_agent_runtime_dev"     └─────────┬─────────┘  │
   │                                                  │            │
   │                    /aws/bedrock-agentcore/evaluations/...     │
   │                    (per-session scores + explanations)        │
   └───────────────────────────────────────────────────────────────┘
```

### The join, which is the entire integration

Vocion builds each eval case's session id from the dataset slug and the case
index, sends it to the agent as `payload.sessionId`, and the runtime stamps it on
every span of that turn. Later, the batch job asks AWS to grade sessions *by
those same names*.

Both sides derive the string the same way, in `evalCaseSessionId`. **If they ever
drift apart, AWS finds zero sessions, grades all zero of them, and reports
success.** That is the quietest failure in the feature, which is why Vocion
treats a job that graded nothing as a failure rather than a pass.

Three things must line up or the job matches nothing:

| Must match | Set by | Read by |
|---|---|---|
| `session.id` | `withSession()` in the runtime | `filterConfig.sessionIds` in the batch request |
| `service.name` | `OTEL_RESOURCE_ATTRIBUTES` at deploy | `VOCION_AGENTCORE_SPAN_SERVICE_NAMES` |
| log group | Transaction Search (`aws/spans`) | `VOCION_AGENTCORE_SPAN_LOG_GROUPS` |

---

## 7. What AWS is doing while a job runs

You start a job and it takes minutes. Here is what is happening on the other
side, so the wait is not a black box.

1. **AWS queries CloudWatch Logs** for spans in your `logGroupNames`, filtered to
   the `serviceNames` you gave and the `sessionIds` you named.
2. **It reconstructs each session** from those spans — the prompt, the tool calls
   in order, the final answer.
3. **It runs each evaluator over each session.** Trajectory evaluators compare
   tool order against your `expectedTrajectory` and cost nothing. Judge
   evaluators call a model and cost tokens on the customer's bill.
4. **It writes one record per session per evaluator** into
   `/aws/bedrock-agentcore/evaluations/batch-evaluations/results/default`, each
   with a score, a label, and the judge's reasoning in plain English.
5. **It publishes CloudWatch metrics** under the `Bedrock-AgentCore/Evaluations`
   namespace, so you can build dashboards and alarms.
6. **`GetBatchEvaluation` starts returning per-evaluator averages.** Note that
   the API gives Vocion *averages only* — the per-session detail lives in that
   log group, which is rather the point.

Meanwhile a Temporal workflow inside Vocion polls the job once a minute for up to
thirty minutes, then writes the scores back.

---

## 8. Setting it up, with a check after every step

Vocion grading needs none of this. Start here only when you want AWS grading.

Each step has a verification command. **Do not move to the next step until the
check passes** — every failure in section 10 comes from skipping one of these.

### Step 0 — What you need before you start

- An AWS account, and a profile on your machine that can create IAM roles, ECR
  repositories and CloudWatch resources in it.
- Docker, for building the agent runtime image.
- `python3` on the machine running the deploy script.

```bash
# Confirm which account you are about to change. Wrong credentials here
# silently build everything in the wrong place.
aws --profile <your-aws-profile> sts get-caller-identity
```

### Step 1 — Provision the AWS foundation

```bash
ENV=dev REGION=us-west-2 AWS_PROFILE=<your-aws-profile> \
  bash infra/agentcore/provision.sh
```

This is idempotent — run it as often as you like. It creates:

| What | Why |
|---|---|
| ECR repository | Somewhere to push the agent container |
| `VocionAgentRuntimeRole-<env>` | The identity your agent runs as |
| AgentCore Memory store | Conversation memory for the agent |
| **CloudWatch Transaction Search** | Makes spans readable as logs. **Starts a bill.** |
| `VocionAgentCoreEvaluationExecution` | The role online evaluation runs as |
| SSM parameters under `/vocion/agentcore/<env>/` | So the deploy scripts can find all of the above |

**Check it worked:**

```bash
# Transaction Search must say ACTIVE, destination CloudWatchLogs.
aws --profile <your-aws-profile> --region us-west-2 \
  xray get-trace-segment-destination

# The evaluation role must exist.
aws --profile <your-aws-profile> iam get-role \
  --role-name VocionAgentCoreEvaluationExecution --query 'Role.Arn' --output text
```

### Step 2 — Deploy the agent runtime with tracing on

```bash
ENV=dev AWS_PROFILE=<your-aws-profile> bash infra/agentcore/deploy-runtime.sh
```

Tracing is **on by default**; export `OBSERVABILITY=false` to opt out. The script
sets these on the runtime, and each one matters:

| Variable | What it does |
|---|---|
| `AGENT_OBSERVABILITY_ENABLED=true` | The switch ADOT reads |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | The X-Ray endpoint. ADOT only uses its signing exporter when this matches the expected pattern exactly |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf` | The only protocol that endpoint accepts |
| `OTEL_TRACES_EXPORTER=otlp` | Export traces… |
| `OTEL_LOGS_EXPORTER=none`, `OTEL_METRICS_EXPORTER=none` | …and only traces |
| `OTEL_RESOURCE_ATTRIBUTES=service.name=vocion_agent_runtime_<env>` | **The name batch evaluation matches on** |

**Check it worked:** run one conversation through the agent, wait about a minute,
then:

```bash
aws --profile <your-aws-profile> --region us-west-2 logs describe-log-streams \
  --log-group-name 'aws/spans' --order-by LastEventTime --descending --max-items 1
```

A recent `lastEventTimestamp` means spans are arriving. Nothing at all means
stop here and go to section 10 — no amount of eval configuration will help.

### Step 3 — Connect the org's AWS key in Vocion

In the Vocion UI, connect the AWS access key for the org. **Eval calls run as
the customer, never as the platform.**

#### Two identities, on purpose

Steps 1 and 2 use **your** AWS profile. Step 3 stores the **customer's** key, and
that is what every eval call uses at runtime.

They are separate deliberately. The platform's own AWS identity holds the KMS key
that wraps every tenant's data-encryption key, plus the AgentCore runtime and the
deployment role. A tenant-scoped call that quietly fell back to it would run in
our account with our permissions while looking like it ran as the customer — a
privilege escalation, not a billing surprise.

> **Nothing currently checks that these two point at the same AWS account.** If
> you provision with one profile and connect a key for a different account, the
> role exists in one place and the evaluation runs in another. The symptom is
> "found no sessions", which sends you hunting for a typo in the service name.
> Check the account first.

### Step 4 — Configure Vocion

| Variable | Required | What happens without it |
|---|---|---|
| `VOCION_AGENTCORE_BATCH_EVALS=1` | For batch | No batch job starts; on-demand scoring is unaffected |
| `VOCION_ENV` | **Effectively yes** | Defaults to `dev`, so a production deployment hunts for `vocion_agent_runtime_dev` spans and finds none |
| `VOCION_AGENTCORE_SPAN_SERVICE_NAMES` | No | Derived from `VOCION_ENV` |
| `VOCION_AGENTCORE_SPAN_LOG_GROUPS` | No | Defaults to `aws/spans` |
| `VOCION_AGENTCORE_EVAL_EXECUTION_ROLE_ARN` | For online only | Online setup refuses before calling AWS |

Two known rough edges, worth knowing before you start rather than after:

- **`VOCION_ENV` is not set by the deploy scripts.** Set it explicitly per
  environment, or batch evaluation on production will look for dev spans.
- **The evaluation role ARN is not read back from SSM.** `provision.sh` writes it
  to `/vocion/agentcore/<env>/eval-execution-role-arn`, but nothing reads it into
  the app's environment — copy it across by hand.

### Step 5 — Point a dataset at AgentCore and run it

Add `provider: agentcore` to the dataset YAML, apply the workspace, run the eval.
Then go to section 9 and prove it worked.

---

## 9. Proving it works

You should never have to take this document's word for it. Work outward from the
agent.

### Are spans arriving?

CloudWatch → Logs → Log groups → `aws/spans`. Each event is one span. Or:

```bash
aws --profile <your-aws-profile> --region us-west-2 logs filter-log-events \
  --log-group-name 'aws/spans' \
  --start-time $(( $(date +%s) * 1000 - 3600000 )) \
  --max-items 1 --query 'events[].message' --output text
```

The two fields that decide everything:

```json
{
  "resource": { "attributes": { "service.name": "vocion_agent_runtime_dev" } },
  "attributes": { "session.id": "refund-quality-0" }
}
```

If `service.name` does not match `VOCION_AGENTCORE_SPAN_SERVICE_NAMES`, or
`session.id` is missing, the batch job will match nothing. Fix that before
going further.

> **Note:** CloudWatch `storedBytes` lags by hours and reports `0` on a log group
> that is actively being written to. Check log streams or events, never
> `storedBytes`.

### Did the grading happen?

CloudWatch → Logs → Log groups →
`/aws/bedrock-agentcore/evaluations/batch-evaluations/results/default`. One
stream per job. A record looks like this:

```json
{
  "name": "gen_ai.evaluation.result",
  "attributes": {
    "gen_ai.evaluation.name": "Builtin.Correctness",
    "session.id": "refund-quality-0",
    "gen_ai.evaluation.score.value": 1.0,
    "gen_ai.evaluation.score.label": "Correct",
    "gen_ai.evaluation.explanation": "The agent responded with 'Paris.' which is the correct capital of France. This matches the expected response exactly."
  }
}
```

That `explanation` field is the thing worth showing a client: AWS saying, in its
own words, why it scored the agent the way it did.

### Is online evaluation costing anything right now?

Its configuration has **two separate statuses**, answering different questions:

- `status: ACTIVE` — the configuration exists.
- `executionStatus: ENABLED` — it is sampling traffic and **spending money**.

A configuration can sit `ACTIVE` and switched off indefinitely, costing nothing.
Collapsing the two would tell someone they are paying when they are not, or
worse, the reverse.

### A safe end-to-end smoke test

1. Create a two-case dataset with obvious right answers.
2. Point it at `provider: agentcore` with only `Builtin.TrajectoryInOrderMatch` —
   **no model call, so no cost**.
3. Run it, confirm the sessions appear in `aws/spans`.
4. Add `Builtin.Correctness` and run again. Now you are paying, but you already
   know the plumbing works.

---

## 10. Troubleshooting

| Symptom | Most likely cause | Confirm it | Fix |
|---|---|---|---|
| Job reports "found no sessions" | Service name mismatch | Read `service.name` from a span in `aws/spans` | Match `VOCION_AGENTCORE_SPAN_SERVICE_NAMES` to it |
| Job reports "found no sessions", service name is right | `VOCION_ENV` unset, so Vocion looked for `…_dev` | `echo $VOCION_ENV` on the app | Set it per environment |
| Job reports "found no sessions", everything looks right | Provisioning account ≠ the org's connected key | Compare the account in the role ARN with `sts get-caller-identity` for the org's key | Reconnect the right key |
| `aws/spans` is completely empty | Transaction Search off | `xray get-trace-segment-destination` | Re-run `provision.sh` |
| `aws/spans` empty, Transaction Search ACTIVE | Runtime deployed without tracing | Check the runtime's env for `AGENT_OBSERVABILITY_ENABLED` | Redeploy without `OBSERVABILITY=false` |
| Spans arrive but carry no `session.id` | No OTel context manager registered | Look for the loud `[telemetry]` warning in the runtime log at startup | Confirm the container starts with `--require …/register` |
| Spans arrive but have no LangChain detail | Manual instrumentation did not register | Look for `[telemetry] LangChain instrumentation registered` at startup | Check `telemetry.ts` ran before the server started |
| Apply fails: "evaluator is for X, but this dataset is graded by Y" | Evaluator provider ≠ dataset provider | Read the YAML | Make them match; they cannot be mixed |
| Online setup refuses immediately | No execution role configured | `echo $VOCION_AGENTCORE_EVAL_EXECUTION_ROLE_ARN` | Copy the ARN from SSM |
| Online setup refuses an evaluator | It needs ground truth, which live traffic has none of | Read the refusal — it names the evaluator | Score that with a dataset instead |
| `ValidationException` on the job name | Name outside `[a-zA-Z][a-zA-Z0-9_]{0,47}` | Read the error | Names are built by `batchEvaluationNameFor`; do not hand-build them |
| AccessDenied reading `aws/spans` | Role or key lacks CloudWatch Logs read | Read the error | Re-run `provision.sh`; check the org's key policy |

**The general principle:** work outward from the agent. Spans before sessions,
sessions before jobs, jobs before scores. Almost every failure here is one of the
three joins in section 6 not lining up.

---

## 11. What it costs

Pricing read from AWS's published page on 2026-09-17 — **check the live page
before quoting these to anyone**, because they change.

| | Input | Output |
|---|---|---|
| Built-in evaluators, on-demand | $0.0024 / 1K tokens | $0.012 / 1K tokens |
| Built-in evaluators, **batch** | $0.0018 / 1K tokens | $0.009 / 1K tokens |
| Custom evaluators | $1.50 per 1,000 evaluations | — |

Three things worth internalising:

- **Batch is about 25% cheaper than on-demand.** Cost is not a reason to avoid
  the more auditable path.
- **Trajectory evaluators are free.** They compare tool sequences without calling
  a model. If tool choice is what you care about, you can measure it at no cost.
- **On top of evaluation, you pay for span ingestion** into CloudWatch Logs,
  charged by volume, plus normal log storage. Sampling is 1%.

Online evaluation is the one to watch: it bills every day it is enabled, whether
or not anyone looks at the number. That is why it is created switched off, why
sampling defaults to a small share of traffic, and why "off" means disabled
rather than deleted — you keep the configuration and the history, and stop the
meter.

---

## 12. Where it lands in the database

| Table | Holds |
|---|---|
| `eval_run` | One row per run of a dataset — which grader, which dataset version, which model |
| `eval_case_result` | One row per case: the answer, the tools called, the latency |
| `eval_score` | The scores. `case_result_id` is nullable, because trace- and session-level evaluators judge a whole run rather than one case |
| `eval_evaluator` | Desired state of custom evaluators. Workspace apply writes here and stops; the AWS call happens later in a Temporal activity, so an apply never fails because AWS was unreachable |
| `eval_dataset_remote` | Where AgentCore's own copy of a dataset lives, and whether that copy is current |
| `eval_batch_job` | The pointer to a running AWS job. Written **before** the AWS call, so a restart cannot lose track of a job that is already spending money |
| `eval_online_config` | The standing online configuration — a pointer plus the last thing AWS said about it, refreshed rather than accumulated |

Batch scores are stored under their own provider id, `agentcore-batch`, and never
mixed in with on-demand scores. They are a different kind of number: an average
over sessions, not a per-case result.

---

## 13. Choosing a grader

- **Just want to know whether the agent is getting better?** Vocion. No setup, no
  AWS bill, and `checks` catch the deterministic regressions for free.
- **Need a client or an auditor to verify the score without trusting Vocion?**
  AgentCore batch. That is the only reason to pay the setup cost, and it is a
  good one.
- **Want to know whether production is healthy right now?** Online, sampled
  small — and remember it cannot speak to correctness, only to whether replies
  look responsive and grounded.
- **Comparing the two graders?** Copy the dataset and point the copy at the other
  grader. The comparison is then something someone set up on purpose, with its
  own history, rather than two disagreeing numbers on one page.

---

**See also:** [Evals graded by AWS AgentCore](./agentcore-evals.md) — the field
reference: every evaluator, which ground truth each level accepts, what AWS's
refusal messages mean.
