---
slug: write-task-contract
name: Writing a task contract
description: >-
  How to turn a brief or a named request into an engineering task contract a
  headless worker can execute in isolation and a machine can check when it is
  done: what one task is, what the objective, allowed paths, acceptance
  criteria and required checks have to say, how risk class and budgets are
  chosen, why every task carries the id of the request that asked for it and
  the slug of the repository it lands in, how the repository's risk floor
  overrides the PM's guess, what the task's own title has to say and
  what fails review for one, and the three WIP limits that decide whether
  a task is dispatched at all. Read before writing or dispatching any task,
  and when a returned task shows assumptions the contract should have carried.
playbooks: [naming-the-work, designing-a-surface]
version: 3
---

# Writing a task contract

A **task contract** is the whole interface between what somebody asked for and
what a worker does. The worker cannot see the conversation, cannot ask a
question, and will finish something whether or not the contract was clear —
so everything the contract leaves out comes back as an assumption, an attempt,
or a change nobody wanted.

The contract is an `engineering_task` record. It is also the durable thing a
person reads: the run underneath it is a lease that may be claimed three times,
but the task is one task the whole way through.

## Every task says why it exists

**`why`** is REQUIRED on every task, and it is normally the `why` of the
`request` this task serves, copied across. It differs only when the task is
one part of a larger ask and that part has its own reason. `whyNote` carries
the one line of evidence behind the codes.

A task with no `why` is a task to close, not to dispatch, and
`review-against-contract` returns it unread. This is not bookkeeping: the
reason is what a person reads when they ask "why this, why now" of something
already in flight, and a reason nobody can produce after the fact is usually a
reason that never existed. Where the request itself carries no reason, the
honest move is to go back to triage, not to invent one here.

## The title names the change, literally

Before anything else, the record's **`title`**. It is what a person sees in
the backlog, in Review, in the merge queue, and — because the worker derives
both from it — in the commit subject and the pull request title. It is
**required**, and it has one form: the imperative, naming the user-visible
outcome and where it happens.

> Allow a person to email a document link to recipients from the document page.

Apply the stranger test before you dispatch: **could a stranger read this
title and tell you what will be different afterwards?** If they would have to
open the record to find out, the title is wrong.

**What fails review.** The reviewer returns the contract, unread, when the
title:

- describes the **situation** instead of the change — "Ship the email
  wordmark the invite email already points at" says what the author found,
  not what will be true afterwards;
- is a **noun phrase** or a heading — "Wordmark work", "Content policy
  detail page", "Analytics";
- names a **file path, a framework or an internal module** when the change is
  not about that thing — "in `apps/send-web`" is where the code lives, "on
  the document page" is where the person is;
- is the **objective pasted in** and truncated by the list;
- is a **joke, a headline, or a pun**;
- **hides a smoke test** behind product language — a deliberate verification
  run is titled `Smoke test: <what it exercises>`;
- omits the `(attempt N)` suffix where several records share one `taskId`;
- runs past **100 characters**, or past 70 without a reason.

The full standard, including the four other names one piece of work carries,
is the **naming-the-work** playbook. Read it before writing a title, not
after a reviewer sends one back.

## A task that changes a page carries the surface standard

Any contract that adds or changes a dashboard page, a panel, a column, a
badge or an empty state names the **designing-a-surface** playbook in its
acceptance criteria, because a page is the one artifact where meeting the
letter of a contract and producing the wrong thing are easiest to do at once.
Two rules decide most of it: an index page displays decisions and meaning
while a detail page displays records and evidence, and a missing optional
capability makes the interface smaller rather than filling it with blank
cells. Write the criteria in those terms ("the queue reads as four lanes with
the reason as a sentence"), never as "add a column for `meta.state`".

## Every task carries its request and its repository

`requestId` is the id of the **`request`** record that asked for this — one
noun, whatever door it came through: a bug report, a store review, a support
email, a dogfood note — and `requestSummary` is that request in the asker's
own words. **Required.** A task with no request is a task to close, not to
dispatch. This is not bookkeeping: it is the one rule that stops the factory
building things nobody asked for, and it is the thing the reviewer reads last,
to check that a change which satisfies every criterion actually serves what
was asked.

`repoSlug` is the slug of the **`repo`** record the change lands in.
**Required.** The contract cites that record's `checks` by name — never a
command you wrote yourself — and takes its risk floor from that record's
`riskDefaults`. A repository with no record is one the factory does not touch;
say so and stop rather than writing a task against a URL.

`productSlug` names the product served, so the reviewer can read its written
promises before approving.

## What one task is

One repository, one objective, no questions. Split when:

- the change spans two repositories — two tasks, with a dependency edge;
- part of it has to be accepted before the rest can start — write the edge in
  `dependencies`, by task id, so nothing is discovered at run time;
- two parts have different risk classes — a docs change riding along with a
  schema change is reviewed at the schema bar, which is how cheap work gets
  expensive.

## The five fields that do the work

(Beside the title, which is covered above and is just as required.)

**`objective`** — the outcome, in one or two sentences. Not steps. If you
cannot state it without naming the files to edit, you do not understand the
task well enough to dispatch it, and neither will the worker.

**`allowedPaths`** — the blast radius, agreed before the work starts. Narrow
enough that a diff outside them is obviously wrong, wide enough that the task
is possible. This is the cheapest check in the whole system: it is decided
without reading the diff.

**`acceptanceContract`** — what has to be true, one line each, each line
standing on its own and checkable by a person or a command. "Works correctly"
is not a criterion. "The endpoint returns 404 for an unknown id, with a test
that fails without the change" is.

**`requiredChecks`** — the exact commands, in the order they run. Deterministic
and repeatable: a check nobody can run again is not a check, and nothing is
accepted on a worker's assurance that it tested it. Include the check that
fails *before* the change wherever the work is a fix — a test that passes
against both trees proves nothing.

**`riskClass`** — `docs`, `marketing`, `deps`, `ui`, `logic`, `auth`,
`billing`, `schema`, `infra`. Choose it by what breaks if the change is wrong,
never by how large the diff is. It is what decides how much evidence the merge
takes, so overstating it is as expensive as understating it is dangerous.

**The repository's floor wins.** Before you settle on a class, match every
glob in `allowedPaths` against the repository's `riskDefaults`. Where a path
you allow falls under a guarded glob, the task's class is **at least** what
that glob says: a "docs" task whose paths include `policy/**` is `logic`, and
a "ui" fix that reaches into `billing/**` is `billing`. Say in the contract
which path raised it. The reviewer checks this before reading the diff and
rejects a contract that sits below its floor — so a class you understate is
not a faster merge, it is a rejected one. This is also why a bug fix can be
fast: the danger is in the files a fix touches, not in the word "bug", and
the floor is what says which files.

**`sizeClass`** — `major`, `minor` or `patch`, carried from the request. It
is what the release it rides in inherits (the largest class aboard), and a
`major` task is the one the initiative limit counts.

**`decisionCost`** — the minutes of a person's attention the merge ask will
take: 1 for docs or deps, 5 for ui or logic, 60 for anything that changes an
architecture, a price, a plan limit or a promise. The promoter sums this over
open asks before dispatching another task, so estimate it honestly rather than
low.

## Budgets, model policy, attempts

`tokenBudget` and `wallClockBudget` are sized for the work, not for comfort: a
task that needs more than its budget was scoped wrong, and the run stopping is
the signal that says so. `modelPolicy` says which tier to run on in the
workspace's own words. `attempt` starts at 1 and rises only when the next
attempt carries **something the previous contract did not say** — a failing
check, an assumption made explicit, a path added. Raising the attempt with the
same contract is paying twice for the same misunderstanding.

## Before you dispatch: the three WIP limits

The backlog is unbounded and cheap — a request costs nothing to hold. The
queue in front of a person is bounded and expensive. Three limits keep the
second from filling up with the first:

1. **Decision WIP — a budget of human minutes, not a count.** Sum the
   `decisionCost` of every open ask (merge asks, honest-answer asks, questions
   for a person). While the sum is under the day's budget — start at **60
   minutes** — promote the next task; when it is over, stop dispatching and
   say so. Ten docs merges is a coffee; ten architecture asks is a week, and
   the count would have called them the same.
2. **Execution WIP** — how many workers run at once and what each may spend.
   Core already holds this: the agent's period budget (`agent_budget`) and the
   per-run cap. Name it in the plan; do not rebuild it in the contract.
3. **Initiative WIP — at most one big thing in flight.** A new product, a
   major feature, a shared platform change. While one initiative is open, **do
   not decompose a second** — however good the request. Say so as an ask: name
   the open initiative, the one that is waiting, and let a person decide which
   comes first. Two initiatives in flight is how neither ships.

What promotes a request from the backlog to the queue is the lead's mission
tick, ranking open requests by value against the standing goals and the
product's promises, then dispatching in that order until a limit is hit.

## Read it back as the worker

Before dispatching, read the contract as the thing that will execute it:

0. Does it say **why** it exists, in codes from the closed list, and does the
   note name evidence a person could check? A task that cannot answer that is
   not dispatched.
1. What does it not say that the worker would have to assume?
2. Which acceptance criterion cannot be checked by a command or by a reviewer
   reading the diff?
3. What would a reasonable worker do outside `allowedPaths`, and should that be
   in them or in a second task?

Every assumption you can see now is one you write into the contract instead of
reading in the result. Where you cannot make a criterion checkable, **do not
dispatch**: write the question that would make it checkable and put it on the
review queue for a person. An unanswerable contract is the only thing worse
than no task at all.

## The receipt

Report each planning pass in five lines: tasks written (each with its request
id and repository), dependency edges, decision minutes open against the budget,
what you did not turn into a task and why, what a person has to decide before
anything is dispatched.

## Written before the decision, frozen by it

The contract is drafted BEFORE anyone is asked to approve the build, and it is
what they are approving (review, 2026-09-24: "the approval happens before the
commitment is clear"). Write it with `status: draft`; nothing dispatches a
draft. The build card carries its acceptance criteria as **done when**, its
`estimateCents` as a range, its `decisionCost` as the review minutes, and
`mainRisk` — the one thing most likely to go wrong, in a sentence a person can
weigh. When the person approves, `acceptanceFrozenAt` is written from that
card and the draft becomes the contract; anything you would change after that
is a renegotiation, said out loud, never a quiet edit.

Two fields belong on the REQUEST beside the contract, because they are about
the outcome and not the change: `expectedResult` (what should be different for
people) and `howWeCheck` (the metric, observation or requester confirmation
that will show it, naming a source a person can open). A contract with no
expected result can still be built; it can never be called a success.

And one field for the merge, written now while the paths are fresh:
`rollback` — how the change is put back if the health check fails, in one or
two lines somebody can follow at 2am. A merge that is a deploy is not proposed
without it.
