---
slug: review-against-contract
name: Reviewing against the contract
description: >-
  The reviewer's procedure for a finished engineering task: what is read and
  what is deliberately not, the order that makes the review cheap (paths,
  checks, criteria, then the request), how findings are keyed to the contract,
  the three verdicts and what each one means, the rule that a disagreement
  with the implementer becomes an ask rather than a third opinion, why nothing
  is approved without verification artifacts, and why a contract below its
  repository's risk floor is rejected unread. Read before every review, and
  before deciding whether a known failure can ship.
playbooks: [verify-against-reality, naming-the-work, designing-a-surface]
version: 2
---

# Reviewing against the contract

A review answers one question: **does this change meet the contract it was
dispatched under?** Not whether it is how you would have written it, and not
whether the worker worked hard.

## A change to a page is reviewed against the surface standard too

A page change can satisfy every acceptance criterion and still be wrong,
because the criteria are about what the page contains and the standard is
about what it MEANS. So when the diff touches a page manifest, a panel, a
column, a badge or an empty state, read it against the
**designing-a-surface** playbook and return it when it renders stored codes
or state names a person would have to learn the schema to read, draws a field
no visible row can fill, says "not recorded" in a cell, repeats one missing
fact on every row, puts evidence on an index page, presents a queue as
ordered with no visible order, adds a second affordance that opens what the
row already opens, or answers a question that belongs to another surface.

## What you read, and what you do not

You read four things: the **task contract**, the **diff**, the
**`verification`** entries (each check, its exit code, its one-line summary and
the artifacts that carry the proof), and the repository's **`riskDefaults`**.
Plus the request in the asker's own words, which you read last, and the
product's written **promises**, which you read before approving anything —
the product's own written `promises`. What
counts as proof for each kind of check is the `verify-against-reality`
playbook; a check whose proof is not on its table is not proven.

You do **not** read the implementer's conversation. An account of how a change
was made cannot make the change correct, and reading it is how a reviewer
starts grading effort instead of work. If you find yourself wanting it, what
you actually want is a line the contract was missing.

## The order, which is what makes this cheap

0. **The reason.** Does the task carry a `why`, with at least one code from
   the closed list? A task that cannot say why it exists is a task nobody can
   justify, and it is returned `reject` before the diff is read: the finding
   is a planning finding, and the fix is triage, not another attempt. Do not
   supply the reason yourself. Inferring one from the title or the request's
   age is how the field becomes decoration, and a field a person cannot trust
   is worse than an empty one.
1. **The floor.** Match every path in `allowedPaths` and `filesChanged`
   against the repository's `riskDefaults`. If any path falls under a glob
   whose class is higher than the task's `riskClass`, the contract is wrong,
   not the work: return `reject` naming the path, the class the floor demands
   and the class the contract claimed, and do not read the diff. A contract
   below its floor would put a change in front of a person at the wrong bar,
   and the bar is the whole point.
2. **Paths.** Every path in `filesChanged` against `allowedPaths`. A diff
   outside them is a contract violation: name the paths, return `changes`, and
   stop. It is not read on its merits, because the blast radius was agreed
   before the work started and this change is not the one that was agreed.
3. **Verification.** Every entry in `requiredChecks` has a `verification`
   entry, run against the commit in the record, with its exit code and **at
   least one artifact** — the JUnit report, the Playwright trace, the
   screenshot, the curl of the deployed URL. A check with no exit code was not
   run; a check with no artifact is a claim, not a proof; and a task with an
   empty `verification` is **not reviewable** — return `changes` asking for the
   evidence, whatever the diff looks like. You never approve on a worker's
   word that it tested something. A non-zero exit the worker decided was
   acceptable is a `knownFailure` — see below.
4. **Criteria.** Each line of `acceptanceContract`, one at a time, against the
   diff. Quote the hunk that satisfies it, or say plainly that it is not
   satisfied. A criterion you cannot decide from the diff is a criterion that
   was not checkable, and that finding goes back to the PM.
5. **The request, and the promises.** Read the `request` record in the
   asker's own words. A change that meets every criterion and does not serve
   what was asked is `changes`, not an approval — and the criterion that was
   missing is the actual finding. Then read the product's `promises`: a change
   that touches the surface a promise describes is a person's decision at the
   high bar however small the diff, and you say which promise.

## Findings are keyed to the contract

Every finding names the acceptance criterion it fails, the allowed-path rule it
violates, or the required check that did not pass. A finding you cannot key to
the contract is a **preference**: say it in one line, addressed to the PM
for the next contract, and do not hold the change for it. This is what keeps
review from becoming an unbounded opinion surface, and it is why the contract
is written before the work rather than inferred after it.

Write each finding on the task, typed, beside the verdict — `verdict.findings[]:
{against: criterion|path|check, ref, severity: block|fix|note, what, closeBy}`
— `against` and `ref` say what on the contract it fails, in the contract's own
words; `severity` says what it does: **block** keeps the merge ask from being
filed (the merge action refuses it and names the finding), **fix** rides on the
next attempt's contract line, **note** goes to the PM for the next contract. A
`block` finding and an `approve` verdict cannot both be true; if you have one,
the verdict is `changes` or `reject`.

## The three verdicts

- **approve** — every criterion met, every required check run and passed
  with its evidence attached, no path outside `allowedPaths`, the contract at
  or above its floor. The merge then goes on a person's queue as an ask
  carrying the task's `decisionCost` and the verification artifacts one tap
  away; you do not merge, and nothing you do merges.
- **changes** — something specific and checkable is wrong, and you can say
  exactly what would make it right. The next attempt carries that line.
- **reject**: the task carries no `why`, the change does not serve the
  request, the contract sits below its repository's risk floor, or it is
  outside the contract in a way another attempt on the same contract would
  not fix. A reject is a planning finding, not a worker finding; say which
  contract line was wrong.

## Known failures

A `knownFailure` the worker declared is a **decision for a person**, never
something you quietly approve around. Surface it with the criterion it touches,
the check output behind it, and your own reading of whether the change is worth
having without it. Say what you recommend; do not decide it.

## A disagreement becomes an ask

When the worker's `assumptions` contradict your reading of the contract, do not
dispatch another worker to break the tie and do not decide it yourself. **Raise
it as an ask for a person**, with three things side by side: the contract line,
the worker's assumption, and the hunk of the diff it produced. A third opinion
from a third model is not evidence; it is a vote, and votes are how a factory
learns nothing.

The answer a person gives is the valuable part: it goes back into the next
contract as a line, so the same disagreement is not had twice.

## The receipt

Report the verdict, then the findings in the order above, each keyed to what it
fails, each with the diff hunk, exit code or artifact behind it. Then the one
line a person needs to decide the merge: what this changes, what it risks, what
is still broken on purpose, and how many minutes of their attention it should
take.

## The verdict is about one commit

Write the verdict ON THE TASK, through `update_object`: `verdict: {value,
commitSha, at, by, note, independentChecks}`. `commitSha` is the head you read
the diff and the evidence at, and it must equal the task's own `commitSha`; a
branch that moves after your review carries an approval of code nobody read,
and the merge card says STALE until you re-read the head (review,
2026-09-24). `note` is the one sentence for the person who will merge: what
they are accepting and the one risk to know.

Withholding the engineer's conversation does not make the engineer's own
verification independent. `independentChecks` lists the checks that ran on
trusted CI (the pull request's check runs) or that you reproduced yourself;
for a `schema`, `billing`, `auth` or `infra` risk class it must be non-empty
before the merge is proposed — a healthy HTTP response and a screenshot are
not evidence for a migration.
