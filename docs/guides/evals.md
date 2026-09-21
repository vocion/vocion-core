# Evals in Vocion

**Who this is for:** anyone who needs to understand, set up, run, explain or
debug agent evaluation in Vocion. You do not need to have used AWS. You do not
need to know what a span is. You need to be able to edit a YAML file and run a
shell command.

**What you will be able to do by the end:** write an eval, run it, read the
result, explain to someone else exactly who graded it and how, and know where to
look when a number seems wrong.

Read sections 1 to 4 and you will understand the design. Follow section 5 and you
will have a working eval. Section 6 onward is reference and deep dives.

---

## Table of contents

1. [What an eval is, and why the word causes arguments](#1-what-an-eval-is-and-why-the-word-causes-arguments)
2. [Three rules the design is built on](#2-three-rules-the-design-is-built-on)
3. [The grader is a plug, not a hard-wired part](#3-the-grader-is-a-plug-not-a-hard-wired-part)
4. [The kinds of test you can run](#4-the-kinds-of-test-you-can-run)
5. [Tutorial, part one: an eval graded by Vocion](#5-tutorial-part-one-an-eval-graded-by-vocion)
6. [Tutorial, part two: the same eval graded by AWS](#6-tutorial-part-two-the-same-eval-graded-by-aws)
7. [The same case, side by side](#7-the-same-case-side-by-side)
8. [Deep dive: the wiring behind the Vocion grader](#8-deep-dive-the-wiring-behind-the-vocion-grader)
9. [Deep dive: the wiring behind the AgentCore grader](#9-deep-dive-the-wiring-behind-the-agentcore-grader)
10. [Where to check results](#10-where-to-check-results)
11. [Troubleshooting](#11-troubleshooting)
12. [What it costs](#12-what-it-costs)
13. [How this will evolve](#13-how-this-will-evolve)

---

## 1. What an eval is, and why the word causes arguments

An **eval** is a driving test for your agent.

You fix a route — the same set of questions, every time. You send the agent down
it. Then someone watches and says how it did.

The word causes arguments because the industry uses "eval" for at least four
different things: a unit test with a string comparison, a model scoring another
model's prose, a dashboard of production metrics, and a research benchmark. They
are all called evals and they answer completely different questions.

So here is the definition this system uses, and it is worth being pedantic about
it, because everything else follows:

> **An eval is a fixed set of inputs, run through your agent, with a grader
> giving each result a score that is written down and never changed.**

Three words in that sentence are doing heavy lifting:

- **Fixed.** The questions do not change between runs. If they changed, a drop
  in the score might mean the questions got harder, and you would have no way to
  tell.
- **Grader**, as a separable role. Who grades is a decision you make per eval,
  not something baked into the product.
- **Never changed.** A score is a measurement of one moment. Re-measuring makes
  a new score; it does not correct the old one.

### What an eval is not

| Not this | Why it matters |
|---|---|
| A monitor | An eval tells you how the agent does on *your* questions. It says nothing about live traffic. |
| A guarantee | A passing eval means the agent handled the cases you thought of. |
| A single number | The pass rate is a headline. The useful part is which cases failed and what the grader said about them. |

---

## 2. Three rules the design is built on

If you remember nothing else from this document, remember these. Every surprising
thing in the rest of the guide falls out of one of them.

### Rule one: run once, grade separately

The agent runs **once** per eval run and produces a transcript — what it said,
which tools it called, how long it took, whether it blew up. Grading happens
afterward, on that stored transcript.

**The analogy:** the candidate drives the route once. The examiner watches the
drive. If each examiner made the candidate drive their own separate route, and
the two examiners gave different marks, you would never know whether the
examiners disagree or the candidate simply drove differently the second time.

This is why the grader interface takes transcripts and returns scores, and has no
way to run the agent itself. It is a deliberate restriction.

### Rule two: the grader is a plug

Vocion ships two graders today. The code that runs an eval does not contain the
word "AWS" anywhere, and does not have a `switch` listing the graders it knows.
It asks a registry for the grader by name and calls the same functions on
whatever comes back.

That is not tidiness for its own sake. It means the answer to "can we use a
different grading service next year" is yes, and the change is one new file.

### Rule three: a score is never rewritten

Nothing in the system updates a score row. Re-running an eval creates a new run
with new scores, sitting next to the old ones.

**The analogy:** you do not go back and erase last year's test result because
this year's was better. The point of keeping both is the line between them.

---

## 3. The grader is a plug, not a hard-wired part

### What a grader has to be able to do

Any grader — the two shipped today, or one added in 2027 by a company that does
not exist yet — has to provide exactly this:

```ts
export type EvalScoreProvider = {
  /** Stored in `eval_run.provider` and `eval_score.provider`. */
  id: string;
  /** What a person sees on the filter and the score chips. */
  label: string;
  isAvailable: (orgId: string) => Promise<ProviderAvailability>;
  score: (request: ScoreRequest) => Promise<ProviderScore[]>;
  publishDataset?: (request: PublishDatasetRequest) => Promise<PublishedDataset>;
};
```

Four required pieces and one optional one:

- **`id`** — the short name that goes in the YAML and gets stored on every row.
- **`label`** — what a human sees on screen.
- **`isAvailable`** — "can you grade for this customer right now, and if not,
  why not?" The *why not* is required, and that is not politeness. "No AWS
  credential connected" means the feature is simply off for this customer and
  nothing should appear in the interface. "Credential present, but this region
  has no evaluation service" means it looks available and then fails on every
  single case — which reads, to the person watching, as *the agent* being broken.
  Saying which, once, before anything runs, is the entire difference.
- **`score`** — take transcripts, hand back scores.
- **`publishDataset`** — optional, and only for a grader that keeps its own copy
  of your questions in its own system. Vocion's grader keeps the cases in
  Postgres and has nothing to publish, so it simply does not implement this. The
  runner asks *whether the function exists* rather than asking which grader this
  is.

### What a score looks like, whoever produced it

Every grader returns the same shape, so one page can display any of them:

```ts
export type ProviderScore = {
  /** Our evaluator name, or the provider's id such as `Builtin.ToolSelectionAccuracy`. */
  evaluatorSlug: string;
  evaluatorName?: string | null;
  level: EvalScoreLevel; // 'TOOL_CALL' | 'TRACE' | 'SESSION'
  value?: number | null; // a number, when the evaluator produces one
  label?: string | null; // a word, when the evaluator produces one
  explanation?: string | null; // why, in plain English
  errorCode?: string | null; // set when the evaluator itself failed
  itemIndex?: number; // which case; omitted for a whole-run score
};
```

Two details worth pausing on.

**`value` and `label` are both optional, and neither is forced into the other.**
A trajectory matcher naturally produces "pass, and here is a 1". A five-point
judge naturally produces "Mostly helpful", where the number only means something
next to that evaluator's own scale. Squashing both into one column would make
them look comparable when they are not.

**`errorCode` exists so a broken evaluator is never recorded as a zero.** A zero
says *the agent answered badly*. An error says *there was no answer*. A trend
line that cannot tell those apart will show you an outage as a quality
regression, and you will spend a day hunting a prompt bug that was never there.

### What is plugged in today

| `id` | Label | Runs where | Keeps its own copy of your questions |
|---|---|---|---|
| `vocion` | Vocion | Inside Vocion | No |
| `agentcore` | AWS AgentCore | In the customer's AWS account | Yes |
| `agentcore-batch` | (audit trail, see §9) | In the customer's AWS account | Yes |

`agentcore-batch` is not a grader you choose in YAML. It is the same AWS grader
reading the agent's real recorded behaviour rather than a transcript we handed
it. Section 9 explains why that distinction is the whole point.

### What a third grader would take

Concretely, if someone shipped a competing evaluation service tomorrow:

1. A new file next to the others, exporting an object with those five fields.
2. One `registerProvider(theNewOne)` line.
3. Adding its `id` to the list of names the YAML accepts.

Nothing else. The run path, the storage, the dashboard, the trend chart and the
comparison page all work by asking the registry rather than by knowing the names.

> **Being honest about the seam:** the *interface* is grader-agnostic. Two things
> around it are not yet. The list of names the YAML accepts is a fixed list of
> two, so a third grader is a one-line schema change rather than zero. And some
> vocabulary below — trajectory ground truth, evaluator levels — is named the way
> AWS names it, because AWS is the only outside grader we have had to fit so far.
> A second one would probably push those toward neutral names. That is known,
> deliberate debt, not an oversight.

---

## 4. The kinds of test you can run

This is the section most people actually need, and the one most guides skip.
"Eval" covers several fundamentally different kinds of test, and choosing the
wrong kind is the most common way to end up with numbers nobody trusts.

There are four, and they differ in the only way that matters: **what decides the
answer.**

### 4.1 Deterministic checks — a tick-box on a clipboard

**What decides:** a string or number comparison, in code.

**The analogy:** the examiner's clipboard has a box that says "used the mirror".
Either they did or they did not. Two examiners with the same clipboard always
agree.

```text
checks:
  - toolCalled: lookup_order
  - outputNotContains: "guarantee"
  - latencyUnderMs: 8000
```

The whole vocabulary, and it is a closed list on purpose:

| Check | True when |
|---|---|
| `toolCalled: x` | The agent called tool `x` |
| `toolNotCalled: x` | It did not call `x` |
| `outputContains: "text"` | The answer contains that text |
| `outputNotContains: "text"` | It does not |
| `outputMatches: "regex"` | The answer matches that regular expression |
| `latencyUnderMs: 8000` | The answer came back in under 8 seconds |
| `turnsUnder: 4` | The conversation took fewer than 4 turns |

| Pros | Cons |
|---|---|
| Free — no model call, no cloud account | Cannot judge whether an answer is *good* |
| Cannot be flaky: same transcript, same result, forever | Closed vocabulary — no arbitrary code |
| Instant | Brittle if you match on exact wording |

**Why the vocabulary is closed:** letting people put arbitrary code in a config
file means sandboxing it, timing it out, and accepting that a config file is now
a way to execute code inside the application. A fixed list covers what people
actually mean by "check it did the thing", and the escape hatch for anything
beyond it is §4.4.

**What you get back:** one score per check, at `TOOL_CALL` level, `value` 1 or 0,
`label` `pass` or `fail`, and an explanation sentence such as
`Never called lookup_order. Tools used: search, reply.`

### 4.2 LLM-as-judge — an examiner with an opinion

**What decides:** a language model reads the question, the answer and your
standard, then gives a verdict.

**The analogy:** "was the lane change smooth and safe?" No tick-box answers that.
You need someone with judgement — and you need to write down what you are asking
them to judge, or two examiners will disagree.

```text
rubric: "Must not promise a delivery timeline we do not control"
assertions:
  - "names the refund amount"
  - "tells the customer when to expect it"
```

**`assertions` look like an assertion library and are not one.** They are
natural-language facts handed to the judge, which reads them for *meaning*, not
as string matching. "Refunded $42.50" satisfies "names the refund amount" even
though the words differ. If you want a literal comparison, that is §4.1.

| Pros | Cons |
|---|---|
| Judges quality, tone and completeness — the things that matter | Costs tokens on every case, every run |
| Handles paraphrase, so the agent is not punished for wording | Two runs can disagree at the margin |
| Explains itself in a sentence you can act on | As vague as your rubric: "be helpful" scores noise |

**How the wobble is controlled here:** the judge runs at temperature 0 on a fixed
role, whatever model the agent under test is using. Two runs of one dataset are
graded by the same judge under the same settings. That is the only reason
comparing two runs means anything — and it is also why changing the judge model
resets your baseline, which is worth writing on the ticket when you do it.

**What you get back:** one score per case, at `TRACE` level, `value` from 0.0 to
1.0, `label` `pass`, `fail` or `error`, and a one-sentence rationale.

### 4.3 Trajectory matching — the route on the map versus the route driven

**What decides:** comparing the list of tools the agent called against the list
you said it should call. No model, no opinion.

```text
expectedTrajectory: [lookup_order, issue_refund]
```

| Pros | Cons |
|---|---|
| Free — list comparison, not inference | Says nothing about whether the answer was any good |
| Never flaky | Needs you to actually know the right sequence |
| The cheapest useful signal in the system | Strict about order, when order sometimes does not matter |

If what you care about is *did the agent take the right steps*, reach for this
first. It is the only scoring AWS does without calling a model, which makes it
free, which makes it the right thing to smoke-test with.

### 4.4 Custom evaluation code — bring your own examiner

**What decides:** a Lambda function the customer wrote, deployed and owns.

```text
evaluators:
  - provider: agentcore
    slug: pii-scan
    lambdaArn: arn:aws:lambda:us-west-2:111122223333:function:pii-scan
```

This is the escape hatch. If your grading rule is "cross-reference against our
order database" or "run our existing PII scanner", no rubric and no tick-box will
express it, and this will.

**Nothing in Vocion deploys that Lambda.** We reference the ARN; the customer
builds, deploys, versions and pays for the function. That is a real boundary, not
a missing feature: running customer code inside our process is exactly what the
closed vocabulary in §4.1 exists to avoid.

| Pros | Cons |
|---|---|
| Arbitrary logic — anything you can write | You own a deployed function, forever |
| Runs in the customer's account, on their data | AWS-only today |

### 4.5 Which grader supports which kind

This is where the plug-in design shows its seams, and you should know them before
you write a file.

| Test kind | Vocion grader | AgentCore grader |
|---|---|---|
| Deterministic checks (§4.1) | **Yes** | **No** — use §4.4 instead |
| LLM-as-judge (§4.2) | Yes, one built-in judge | Yes, a catalogue plus custom judges |
| Trajectory matching (§4.3) | No | **Yes** |
| Custom code (§4.4) | No | Yes, your Lambda |

> **The system refuses the mismatch rather than ignoring it.** Put `checks` on a
> dataset graded by AgentCore and the workspace file is **rejected when you apply
> it**, naming the case. This is deliberate. The alternative — accepting the file
> and silently never running those checks — means the case reports a pass rate
> that reads as though the checks had passed. A loud refusal costs you two
> minutes; a silent skip costs you a false sense of coverage for months.

---

## 5. Tutorial, part one: an eval graded by Vocion

We will build a real eval end to end. It needs no AWS account, no provisioning
and no credentials, and it takes about ten minutes.

**The scenario:** a support agent that handles refunds. We want to know two
things — does it actually look the order up before promising anything, and is the
answer any good?

### Step 5.1 — Write the file

Eval datasets live in your workspace directory under `evals/`, one file per
dataset. Create `evals/refund-quality.yaml`:

```yaml
slug: refund-quality
name: Refund answers
description: Does the support agent look up the order before promising a refund?
agentSlug: support-agent
provider: vocion

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

  - input: where is my order 4821
    expectedOutput: Gives the current status and does not offer a refund
    rubric: Answering a status question with a refund offer is wrong
    checks:
      - toolCalled: lookup_order
      - toolNotCalled: issue_refund
```

Read what we just did, line by line:

- **`provider: vocion`** names the grader. It is also the default, so a dataset
  with no `provider` line behaves exactly like this one — every eval written
  before graders were pluggable still works untouched.
- **`agentSlug`** is which agent gets tested. The dataset is useless without it.
- **`rubric`** and **`assertions`** are the judge's brief (§4.2).
- **`checks`** are the tick-boxes (§4.1). Notice case two has *only* checks and a
  rubric — it is mostly asking "did it avoid doing the wrong thing", which
  tick-boxes answer perfectly and cheaply.

### Step 5.2 — Apply it

```bash
npx tsx src/scripts/apply-workspace.ts --project <your-project-slug>
```

Apply reads the file, validates it and writes the dataset to the database. **If
the file is wrong, this is where you find out**, with the file and the case
named.

**Check it worked:** the dataset appears in the dashboard under **Evals**.

### Step 5.3 — Run it

Either press **Run** on the dataset page, or:

```bash
curl -X POST https://<your-vocion-host>/api/v1/evals/refund-quality/runs \
  -H "Authorization: Bearer <your-api-token>"
```

Here is what happens inside, in order, because knowing this is what lets you
debug it later:

1. **The grader is resolved and asked whether it can work.** If it says no, the
   run **stops here with that reason**. It does not quietly grade with something
   else. A silent substitution would put a score on your trend line that was
   produced by a different examiner, with nothing on the page saying so.
2. **The dataset is synced to the grader**, if that grader keeps its own copy.
   Vocion's does not, so this does nothing here.
3. **The agent runs every case.** This is the expensive part.
4. **Transcripts are written down**, before any grading.
5. **The grader scores them**, and the scores are written.

### Step 5.4 — Read the result

Open the run. For case one you will see something like:

| Evaluator | Level | Value | Label | Explanation |
|---|---|---|---|---|
| Vocion judge | TRACE | 0.9 | pass | Confirms the $42.50 refund and gives a 3–5 day window without promising delivery. |
| `check:toolCalled:lookup_order` | TOOL_CALL | 1 | pass | Called lookup_order. |
| `check:outputNotContains:guarantee` | TOOL_CALL | 1 | pass | Answer does not contain "guarantee". |
| `check:latencyUnderMs:8000` | TOOL_CALL | 0 | fail | Took 9,240ms, over the 8,000ms limit. |

Four scores for one case, from two different kinds of test, each saying something
the others cannot. That is the whole point of having both kinds.

### Step 5.5 — Make it fail on purpose

**Do this.** An eval you have never seen fail is an eval you do not know works.

Change a check to something you know is false:

```text
    checks:
      - toolCalled: a_tool_that_does_not_exist
```

Re-apply, re-run. That check must come back `fail`, with
`Never called a_tool_that_does_not_exist. Tools used: ...`. If it comes back
`pass`, something is wrong with your setup and you have just saved yourself from
trusting it. Change it back.

**You now have a working eval.** Everything from here is about a second opinion.

---

## 6. Tutorial, part two: the same eval graded by AWS

### Why you would bother

Everything in part one was graded by us, inside our system. For most work that is
exactly right.

But there is one question it cannot answer: **"prove it, without asking me to
trust your tool."**

When a client's security team, an auditor, or a buyer asks how you know the agent
behaves, "our own dashboard says so" is a weak answer. A score sitting in *their*
AWS account, produced by *AWS* reading what the agent genuinely did, is an answer
they can check without us — and could still check if they stopped using us
tomorrow.

That is what this half buys. It is the only reason to pay the setup cost, and if
nobody is asking you that question, part one is enough.

### Step 6.1 — Copy the dataset, do not convert it

```bash
cp evals/refund-quality.yaml evals/refund-quality-aws.yaml
```

**Copy rather than switch.** One dataset has one grader, deliberately. If the
same dataset flipped between graders, its trend line would contain two examiners'
marks with nothing on the chart saying where it changed hands. As two datasets,
each has its own history, and comparing them is something you set up on purpose.

### Step 6.2 — Change what has to change

```yaml
slug: refund-quality-aws
name: Refund answers (AWS graded)
description: The same questions, graded independently in our own AWS account.
agentSlug: support-agent
provider: agentcore

evaluators:
  # AWS's own evaluators, named by id.
  - provider: agentcore
    builtin:
      - Builtin.TrajectoryInOrderMatch # no model call, so free
      - Builtin.Correctness # a judge model, so it costs tokens

  # A judge we write, created in the customer's AWS account.
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
    expectedTrajectory: [lookup_order, issue_refund]
    assertions:
      - names the refund amount

  - input: where is my order 4821
    expectedOutput: Gives the current status and does not offer a refund
    expectedTrajectory: [lookup_order]
```

Four changes, and each one teaches something:

**The `checks` are gone.** They have to be — §4.5. The tool-order rule they were
expressing has moved to `expectedTrajectory`, which is AWS's free equivalent. The
`outputNotContains: "guarantee"` rule has no equivalent here at all; if you truly
need it, it belongs in a Lambda (§4.4), or you keep the Vocion dataset for it.
Being told this by a refused file beats discovering it from a suspiciously
perfect score.

**You now name your evaluators.** Vocion has one judge and you get it. AWS has a
catalogue, and you pick from it.

**`expectedTrajectory` earns its keep.** It is ground truth for the trajectory
evaluators, and those cost nothing to run.

**`level: SESSION` on the custom judge** says what it looks at: `TOOL_CALL` is one
tool call, `TRACE` is one turn, `SESSION` is the whole conversation. Pick the
smallest thing that can answer your question — a session-level judge cannot tell
you *which* turn went wrong.

### Step 6.3 — Provision AWS

Everything up to now needed no AWS account. This step does. Section 9 explains
what each piece is and why; this is the short version.

```bash
# First: confirm which AWS account you are about to change.
aws --profile <your-aws-profile> sts get-caller-identity

ENV=dev REGION=us-west-2 AWS_PROFILE=<your-aws-profile> \
  bash infra/agentcore/provision.sh
```

Then connect that account's access key for the org in the Vocion interface.

> **Two different AWS identities, on purpose.** The command above runs as *your*
> profile. The key you connect in Vocion is what every eval call uses at runtime.
> They are separate because the platform's own AWS identity holds the encryption
> key wrapping every tenant's data — a customer-scoped call quietly falling back
> to it would be a privilege escalation, not a billing surprise.
>
> **Nothing currently checks that the two point at the same AWS account.** If you
> provision with one and connect a key for another, the symptom is "found no
> sessions", which sends you hunting for a typo that is not there. Compare the
> account ids first.

### Step 6.4 — Apply and run

The same two commands as before. What happens differently inside:

- At step 1, the grader is asked `isAvailable`. No AWS key connected, or a region
  with no evaluation service, and **the run stops with that reason**.
- At step 2, the dataset is genuinely published — your cases are copied into the
  customer's AWS account and versioned there. If that publish fails, **the run
  continues anyway** and records the failure. Scoring does not read the published
  copy; the expected answers travel with each scoring request. Refusing to
  measure because a mirror is stale would be the larger loss.

### Step 6.5 — Read the result

| Evaluator | Level | Value | Label | Explanation |
|---|---|---|---|---|
| `Builtin.TrajectoryInOrderMatch` | SESSION | 1 | — | Tools matched the expected order. |
| `Builtin.Correctness` | TRACE | 1.0 | Correct | The agent confirmed the refund and stated the amount, matching the expected response. |
| `tone-check` | SESSION | 1 | Calm | The reply apologises without attributing fault to the customer. |

Different evaluator names, different levels, the same shape on the page. That
sameness is rule two from §2 paying off.

### Step 6.6 — The independent version

What you have so far is AWS grading a transcript **we handed it**. Better than
nothing, but the honest version is AWS grading what the agent **actually did**,
read from the customer's own logs.

That is batch evaluation, it is opt-in per deployment, and it is what section 9
is about:

```bash
VOCION_AGENTCORE_BATCH_EVALS=1
```

With it on, after the run above finishes, Vocion asks AWS to go and grade those
same conversations from the recorded evidence. The result lands in the customer's
CloudWatch, under their control, whether or not Vocion is in the picture.

---

## 7. The same case, side by side

One question — `"I want a refund for order 4821"` — under both graders.

| | **Vocion** | **AgentCore** |
|---|---|---|
| Setup needed | None | AWS account, provisioning, tracing, a connected key |
| Deterministic checks | Yes, seven operators | No — a Lambda you own |
| Judge | One built-in, temperature 0 | A catalogue, plus judges you write |
| Free scoring | All `checks` | Trajectory evaluators only |
| Ground truth used | `rubric`, `assertions`, `expectedOutput` | Those plus `expectedTrajectory` |
| Where the score lives | Vocion's database | Vocion's database, and the customer's AWS account |
| Who can verify it | Anyone with Vocion | Anyone with the AWS account, **without Vocion** |
| Who pays | Our model bill | The customer's AWS bill |
| Grades what the agent really did | The stored transcript | The transcript — or, in batch, the recorded spans |

**How to choose, in one line each:**

- **Is the agent getting better or worse?** Vocion. No setup, no AWS bill, and
  the checks catch the boring regressions for free.
- **Does someone need to verify the score without trusting us?** AgentCore, with
  batch turned on — that is the only configuration that answers the question.
- **Both?** Keep both datasets. They are cheap to maintain and they answer
  different questions.

---

## 8. Deep dive: the wiring behind the Vocion grader

**Short version: there is none.** You can skip this section and lose nothing
operational. It is here so that "no setup" is a statement you can defend rather
than a claim you are repeating.

**No credential to connect.** The grader's `isAvailable` always answers yes.
Every organisation can use its own judge, so there is no key to be missing and no
region to be wrong about. That is also why a workspace with no AWS shows no
grader filter at all, rather than showing one with everything greyed out.

**The judge.** One model call per case, at temperature 0 on a fixed classifier
role, given the input, the answer, the rubric if there is one, the expected
output as *guidance* rather than a literal target, and the assertions. It returns
strict JSON: a verdict, a score from 0 to 1, and a one-sentence rationale.

**When the model returns something that is not JSON**, that is recorded as an
error on the score rather than thrown away or scored zero — §3, `errorCode`.

**When the agent run itself failed**, the case is recorded as an error, not a
zero, for the same reason.

**The checks.** Each operator is a small standalone function taking the
transcript and its argument. A check with a broken regular expression is reported
as an authoring mistake, explicitly, rather than as a failed check — because "the
agent got it wrong" and "your pattern does not compile" must never look the same
on a results page.

---

## 9. Deep dive: the wiring behind the AgentCore grader

This section teaches the AWS concepts from zero. If you already know
OpenTelemetry and CloudWatch, skip to §9.5.

**Why any of this exists:** for AWS to grade what the agent genuinely did, AWS
has to be able to *see* what the agent genuinely did. Everything below is
plumbing to make that true.

### 9.1 A span is one thing that happened

When code is **instrumented**, it emits a small record every time it does
something interesting — calls a model, runs a tool, enters a step. That record is
a **span**: a name, a start and end time, and a bag of labels.

**The analogy:** a span is one line in a ship's log. "14:02, called the order
lookup tool, took 240ms."

Spans nest. A **trace** is a tree of spans sharing one id — one complete
operation, such as a single turn of a conversation. A **session** groups several
traces: the whole conversation.

**The session id is the single most important identifier in this integration.**
"Grade this conversation" means "grade the spans carrying this session id".

### 9.2 OpenTelemetry and ADOT

**OpenTelemetry** is the vendor-neutral standard for emitting spans — a
cross-industry agreement about what a span looks like, so tools can read each
other's. **ADOT** is AWS's build of it, already knowing how to authenticate to
AWS endpoints.

The agent container loads it at startup with
`node --require @aws/aws-distro-opentelemetry-node-autoinstrumentation/register`.
It must be `--require`d rather than imported, because instrumentation has to
install itself *before* the libraries it patches get loaded — like putting the
recorder in the room before the meeting starts.

**Why LangChain is instrumented by hand.** Automatic instrumentation works by
intercepting module loading: when your code asks for a library, it hands back a
wrapped copy. Our agent runtime ships as a **single bundled file** with every
dependency already inlined — so there is no module loading left to intercept, and
auto-instrumentation silently does nothing. That is why `telemetry.ts` attaches
the LangChain instrumentation explicitly. If you ever see spans with no LangChain
detail, look there first.

### 9.3 How the session id gets onto every span

Each turn runs inside `withSession(...)`, which puts the session id into
OpenTelemetry's **context** — an ambient value that travels with the async call
stack, so every span created during that turn picks it up without anyone passing
it around.

There is a subtlety that caused a real bug: OpenTelemetry needs a **context
manager** registered, or `context.with()` runs your code but the value never
actually propagates. ADOT registers one. Without it, spans come out with no
session id, the batch job matches nothing, and reports success. `telemetry.ts`
probes for this at startup and complains loudly, precisely so that failure is
visible.

### 9.4 Transaction Search, and the two IAM roles

Spans go to an X-Ray endpoint, where the evaluation service cannot read them.
**CloudWatch Transaction Search** is the switch that changes that: turn it on and
AWS *also* writes every span as a log event into a log group called `aws/spans`,
which is what the evaluation service reads.

Two consequences: nothing works until it is on, and turning it on **starts a
bill**, charged by span volume. `provision.sh` turns it on and sets sampling to
1%.

| Role | Who uses it | For what |
|---|---|---|
| `VocionAgentRuntimeRole-<env>` | The agent runtime | Running your agent: models, logs, spans, pulling the container |
| `VocionAgentCoreEvaluationExecution` | The AWS evaluation service | **Online evaluation only** — reading spans on your behalf while nobody is watching |

**Batch evaluation uses no execution role.** It is a direct call made with the
credentials Vocion holds for that organisation. Only the standing, continuous
kind needs an identity AWS can assume by itself.

### 9.5 The join, which is the whole integration

```
   ┌───────────────────────────────────────────────────────────────┐
   │ VOCION                                                        │
   │                                                               │
   │  eval dataset (YAML)                                          │
   │        │                                                      │
   │        │ evalCaseSessionId("refund-quality-aws", 0)           │
   │        │     = "refund-quality-aws-0"                         │
   │        v                                                      │
   │  EvalService ──── invoke, with payload.sessionId ────┐        │
   │        │                                             │        │
   │        │ scores (immediate)                          │        │
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
   │       StartBatchEvaluation ─────────>  ┌─┴─────────v───────┐  │
   │       "grade sessions                  │ AgentCore         │  │
   │        [refund-quality-aws-0, ...]     │ Evaluations       │  │
   │        in vocion_agent_runtime_dev"    └─────────┬─────────┘  │
   │                                                  │            │
   │                    /aws/bedrock-agentcore/evaluations/...     │
   │                    (per-session scores + explanations)        │
   └───────────────────────────────────────────────────────────────┘
```

Vocion builds each case's session id from the dataset slug and the case number,
sends it to the agent, and the runtime stamps it on every span. Later, the batch
job asks AWS to grade sessions *by those same names*. Both sides build the string
with the same function.

**If they ever drift apart, AWS finds zero sessions, grades all zero of them, and
reports success.** That is the quietest failure in the feature, which is exactly
why a job that graded nothing is treated as a failure rather than a pass.

Three things must line up, or the job matches nothing:

| Must match | Set by | Read by |
|---|---|---|
| `session.id` | `withSession()` in the runtime | `filterConfig.sessionIds` in the batch request |
| `service.name` | `OTEL_RESOURCE_ATTRIBUTES` at deploy time | `VOCION_AGENTCORE_SPAN_SERVICE_NAMES` |
| log group | Transaction Search (`aws/spans`) | `VOCION_AGENTCORE_SPAN_LOG_GROUPS` |

### 9.6 Three shapes of AWS grading

"AWS grades it" means three different things, with different prerequisites:

| | Reads | Needs tracing? | Kept in AWS? | Runs when |
|---|---|---|---|---|
| **On-demand** | A transcript we put in the request | No | No | During the run |
| **Batch** | The spans the agent really emitted | **Yes** | Yes | Minutes after |
| **Online** | Live production traffic, sampled | **Yes** | Yes | Continuously, until switched off |

**On-demand** is what §6.5 showed. Simple, needs no provisioning beyond a key —
and the weakest claim, because AWS graded what *we told it* happened.

**Batch** is the honest one, and everything in this section exists for it.

**Online** grades production traffic on a standing configuration. It **cannot use
ground truth** — nobody wrote down the right answer for a real customer's
question — so it is a health signal, not a pass rate. Evaluators needing ground
truth are refused rather than quietly dropped, so you cannot publish a
meaningless number that looks like correctness. It bills for as long as it
exists, which is why it is always created switched off.

Its configuration has **two separate statuses**, answering different questions:
`status: ACTIVE` means the configuration exists; `executionStatus: ENABLED` means
it is sampling traffic and **spending money**. Collapsing them would tell someone
they are paying when they are not, or worse, the reverse.

### 9.7 What AWS does while a batch job runs

You start a job and wait minutes. On the other side:

1. **It queries CloudWatch Logs** for spans in your log groups, filtered to your
   service names and the session ids you named.
2. **It reconstructs each conversation** from those spans — prompt, tool calls in
   order, final answer.
3. **It runs each evaluator over each conversation.** Trajectory evaluators
   compare tool order and cost nothing. Judge evaluators call a model and cost
   tokens on the customer's bill.
4. **It writes one record per conversation per evaluator** into
   `/aws/bedrock-agentcore/evaluations/batch-evaluations/results/default`, each
   with a score, a label, and its reasoning in plain English.
5. **It publishes CloudWatch metrics** under `Bedrock-AgentCore/Evaluations`, so
   dashboards and alarms are possible.
6. **The API starts returning per-evaluator averages** — averages only. The
   per-conversation detail lives in that log group, in the customer's account,
   which is rather the point.

Meanwhile a workflow inside Vocion polls the job once a minute for up to thirty
minutes and writes the scores back under the provider id `agentcore-batch`, kept
apart from on-demand scores because they are a different kind of number: an
average over conversations, not a per-case result.

### 9.8 Configuration, and two rough edges

| Variable | Needed for | Without it |
|---|---|---|
| `VOCION_AGENTCORE_BATCH_EVALS=1` | Batch | No batch job starts; everything else is unchanged |
| `VOCION_ENV` | **Effectively everything** | Defaults to `dev`, so production hunts for dev spans and finds none |
| `VOCION_AGENTCORE_SPAN_SERVICE_NAMES` | Overriding the default | Derived from `VOCION_ENV` |
| `VOCION_AGENTCORE_SPAN_LOG_GROUPS` | Overriding the default | Defaults to `aws/spans` |
| `VOCION_AGENTCORE_EVAL_EXECUTION_ROLE_ARN` | Online only | Online setup refuses before calling AWS |

Two known rough edges, worth knowing before you hit them:

- **`VOCION_ENV` is not set by the deploy scripts.** Set it explicitly per
  environment, or batch evaluation on production looks for dev spans.
- **The evaluation role ARN is written to SSM but never read back.**
  `provision.sh` puts it at `/vocion/agentcore/<env>/eval-execution-role-arn`;
  nothing loads it into the application. Copy it across by hand.

---

## 10. Where to check results

### In Vocion

**Evals → your dataset → a run.** You get the grader's name on a badge, a pass
rate, every case with its transcript, each case's scores, and whole-run scores
listed separately — because session-level evaluators grade the conversation
rather than any one turn.

The trend chart on the dataset page is the thing to actually watch. One run tells
you little; the line tells you whether you are improving.

### In the AWS console

**Are spans arriving at all?** CloudWatch → Logs → Log groups → `aws/spans`.

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
  "attributes": { "session.id": "refund-quality-aws-0" }
}
```

> **Do not judge a log group by `storedBytes`.** It lags by hours and reports `0`
> on a group that is actively being written to. Check streams or events instead.

**Did the grading happen?** CloudWatch → Logs → Log groups →
`/aws/bedrock-agentcore/evaluations/batch-evaluations/results/default`, one
stream per job:

```json
{
  "name": "gen_ai.evaluation.result",
  "attributes": {
    "gen_ai.evaluation.name": "Builtin.Correctness",
    "session.id": "refund-quality-aws-0",
    "gen_ai.evaluation.score.value": 1.0,
    "gen_ai.evaluation.score.label": "Correct",
    "gen_ai.evaluation.explanation": "The agent responded with 'Paris.' which is the correct capital of France. This matches the expected response exactly."
  }
}
```

That `explanation` field is the thing worth showing a client: AWS, in its own
words, saying why it scored the agent as it did.

### In the database

| Table | Holds |
|---|---|
| `eval_run` | One row per run — which grader, which dataset version, which model |
| `eval_case_result` | One row per case: the answer, the tools called, the latency |
| `eval_score` | The scores. `case_result_id` is nullable, because whole-run evaluators judge a conversation rather than one case |
| `eval_evaluator` | Desired state of custom evaluators. Apply writes here and stops; the outside call happens later, so an apply never fails because a cloud was unreachable |
| `eval_dataset_remote` | Where a grader's own copy of the dataset lives, and whether it is current |
| `eval_batch_job` | The pointer to a running job. Written **before** the call, so a restart cannot lose track of something already spending money |
| `eval_online_config` | The standing online configuration, plus the last thing AWS said about it |

---

## 11. Troubleshooting

### Any grader

| Symptom | Likely cause | Confirm | Fix |
|---|---|---|---|
| Apply refuses: "evaluator is for X, but this dataset is graded by Y" | Evaluator provider differs from the dataset's | Read the YAML | Make them match — they cannot be mixed |
| Apply refuses: "case N has checks, which only run under the vocion grader" | `checks` on a non-Vocion dataset | Read the YAML | Use `expectedTrajectory`, a Lambda, or keep a Vocion copy (§4.5) |
| Run stops immediately: "cannot grade this dataset right now" | The grader said it is unavailable; the reason is in the message | Read the message | Fix what it names. It will not silently grade with something else |
| A case scored `error`, not a number | The agent run failed, or the judge returned unparseable output | Read the explanation on the score | An error is not a zero — fix the run, not the prompt |

### Vocion grader

| Symptom | Likely cause | Fix |
|---|---|---|
| A check reports `Invalid regular expression` | `outputMatches` pattern does not compile | Fix the pattern — an authoring error, not an agent failure |
| Judge scores wobble run to run | Rubric too vague to decide from | Make the rubric specific, or move the rule to a `check` |
| Scores shifted with no code change | The judge model changed | Treat it as a new baseline and note it |

### AgentCore grader

| Symptom | Likely cause | Confirm | Fix |
|---|---|---|---|
| "Found no sessions" | Service name mismatch | Read `service.name` from a span | Match `VOCION_AGENTCORE_SPAN_SERVICE_NAMES` to it |
| "Found no sessions", service name right | `VOCION_ENV` unset, so it looked for `…_dev` | `echo $VOCION_ENV` | Set it per environment |
| "Found no sessions", all config right | Provisioning account ≠ the connected key's account | Compare the role ARN's account with the key's | Reconnect the right key |
| `aws/spans` completely empty | Transaction Search off | `aws xray get-trace-segment-destination` | Re-run `provision.sh` |
| `aws/spans` empty, Transaction Search ACTIVE | Runtime deployed without tracing | Check the runtime's environment | Redeploy without `OBSERVABILITY=false` |
| Spans arrive with no `session.id` | No context manager registered | Look for the `[telemetry]` warning at startup | Confirm the container starts with `--require …/register` |
| Spans arrive with no LangChain detail | Manual instrumentation did not register | Look for the registration line at startup | Check `telemetry.ts` ran before the server |
| Online setup refuses an evaluator | It needs ground truth, which live traffic has none of | Read the refusal — it names the evaluator | Score that with a dataset instead |
| `ValidationException` on the job name | Name outside AWS's allowed pattern | Read the error | Names are built for you; do not hand-build them |
| AccessDenied reading `aws/spans` | Missing CloudWatch Logs read permission | Read the error | Re-run `provision.sh`; check the key's policy |

**The general method:** work outward from the agent. Spans before sessions,
sessions before jobs, jobs before scores. Nearly every failure is one of the
three joins in §9.5 not lining up.

---

## 12. What it costs

**Vocion grading:** one judge model call per case per run, on our bill. Checks
are free. A 20-case dataset run daily is 600 judge calls a month.

**AgentCore grading**, from AWS's published pricing read on 2026-09-17 — **check
the live page before quoting these**, they change:

| | Input | Output |
|---|---|---|
| Built-in evaluators, on-demand | $0.0024 / 1K tokens | $0.012 / 1K tokens |
| Built-in evaluators, **batch** | $0.0018 / 1K tokens | $0.009 / 1K tokens |
| Custom evaluators | $1.50 per 1,000 evaluations | — |

Three things worth internalising:

- **Batch is about 25% cheaper than on-demand.** Cost is not a reason to avoid
  the more defensible path.
- **Trajectory evaluators are free.** If tool choice is what you care about, you
  can measure it at no cost — which is also what makes them the right thing to
  smoke-test the plumbing with, before switching on anything that bills.
- **Span ingestion costs money too**, by volume into CloudWatch Logs, plus
  storage. Sampling is 1%.

**The agent's own tokens are usually the bigger bill.** Grading a case costs
a judge call; *running* it costs a whole tool-using turn, and the loop re-sends
everything the agent fetched on every later turn. One measured case on a 240 KB
event listing spent 912,786 input tokens over 13 turns — about fifteen times
the page itself — and a handful of those took an AWS account past its daily
Bedrock token quota (`ThrottlingException: Too many tokens per day`).

Two things follow:

- **Eval runs ask the vendor to cache the prompt prefix.** `produceTranscripts`
  passes `promptCache: true` into every case, which builds the model as a
  caching subclass (`libs/llm/promptCache.ts`) and sends `cache_control` on
  each call — Bedrock turns that into `cachePoint` blocks on the system
  prompt, the tool list and the last message. Repeat reads then bill at cache
  rates instead of full price. Set `promptCache: false` on a run to turn it
  off, and `harness.promptCache` on the agent to decide for that agent in
  either direction — the agent wins.
- **Weigh a source before you write a case against it.** A dataset whose
  cases each read a 300 KB page is expensive whatever the grader does.

**Online evaluation is the one to watch.** It bills every day it is enabled,
whether or not anyone reads the number. That is why it is created switched off,
and why "off" means disabled rather than deleted — you keep the configuration and
the history, and stop the meter.

---

## 13. How this will evolve

Evals are a young and contested idea. Being clear about what is settled and what
is not is more useful than pretending the whole thing is finished.

### Settled, and safe to build on

- **Run once, grade separately.** Changing this would make grader comparison
  meaningless, so it will not change.
- **Scores are immutable.** The trend line is the product.
- **One grader per dataset.** Comparing graders means two datasets, on purpose.
- **An error is never a zero.** Outages must not look like regressions.
- **The grader interface.** Five fields. A new grader implements them.

### Expected to change

- **More graders.** The seat is a plug. When a third one arrives, expect the
  YAML's fixed list of names to become open, and expect AWS-flavoured vocabulary
  (`TOOL_CALL`/`TRACE`/`SESSION`, `expectedTrajectory`) to grow neutral names,
  with the current ones kept as aliases.
- **The gap in §4.5 narrowing.** Deterministic checks running only under the
  Vocion grader is a real limitation, not a principle. The honest fix is for
  checks to run over the transcript regardless of who else grades it. That is a
  change with a migration behind it, not a config flag, and it is not done.
- **The account-match check.** Nothing verifies that the account you provisioned
  and the key you connected are the same one. That is the single highest-value
  small fix in this whole area.
- **Richer trajectory rules.** Strict ordering is the only option today. "These
  tools, in any order" and "never this tool after that one" are the obvious next
  ones.

### Deliberately not planned

- **Arbitrary code in a workspace file.** It needs a sandbox, timeouts and an
  escape route out of the application. The escape hatch stays a function the
  customer owns and deploys.
- **Automatically grading everything with every grader.** Costly, and it produces
  disagreeing numbers on one page with nothing to say which is right.

---

**See also:** [Evals graded by AWS AgentCore](./agentcore-evals.md) — the field
reference for the AgentCore grader: every evaluator, which ground truth each
level accepts, and what AWS's refusal messages mean.
