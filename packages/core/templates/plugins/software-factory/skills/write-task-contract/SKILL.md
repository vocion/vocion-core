---
slug: write-task-contract
name: Writing a task contract
description: >-
  How to turn a brief or a named request into an engineering task contract a
  headless worker can execute in isolation and a machine can check when it is
  done: what one task is, what the objective, allowed paths, acceptance
  criteria and required checks have to say, how risk class and budgets are
  chosen, and why every task carries the id of the request that asked for it.
  Read before writing or dispatching any task, and when a returned task shows
  assumptions the contract should have carried.
version: 1
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

## Every task carries its request

`requestId` is the id of the named request that asked for this — a review item,
an ask, a support thread, a person's message — and `requestSummary` is that
request in the requester's own words.

This is not bookkeeping. It is the one rule that stops the factory building
things nobody asked for, and it is the thing the reviewer reads last, to check
that a change which satisfies every criterion actually serves what was asked.
**A task with no request is a task to close, not to dispatch.**

## What one task is

One repository, one objective, no questions. Split when:

- the change spans two repositories — two tasks, with a dependency edge;
- part of it has to be accepted before the rest can start — write the edge in
  `dependencies`, by task id, so nothing is discovered at run time;
- two parts have different risk classes — a docs change riding along with a
  schema change is reviewed at the schema bar, which is how cheap work gets
  expensive.

## The five fields that do the work

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

## Budgets, model policy, attempts

`tokenBudget` and `wallClockBudget` are sized for the work, not for comfort: a
task that needs more than its budget was scoped wrong, and the run stopping is
the signal that says so. `modelPolicy` says which tier to run on in the
workspace's own words. `attempt` starts at 1 and rises only when the next
attempt carries **something the previous contract did not say** — a failing
check, an assumption made explicit, a path added. Raising the attempt with the
same contract is paying twice for the same misunderstanding.

## Read it back as the worker

Before dispatching, read the contract as the thing that will execute it:

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

Report each planning pass in four lines: tasks written (each with its request
id), dependency edges, what you did not turn into a task and why, what a person
has to decide before anything is dispatched.
