---
slug: review-against-contract
name: Reviewing against the contract
description: >-
  The reviewer's procedure for a finished engineering task: what is read and
  what is deliberately not, the order that makes the review cheap (paths,
  checks, criteria, then the request), how findings are keyed to the contract,
  the three verdicts and what each one means, and the rule that a disagreement
  with the implementer becomes an ask rather than a third opinion. Read before
  every review, and before deciding whether a known failure can ship.
version: 1
---

# Reviewing against the contract

A review answers one question: **does this change meet the contract it was
dispatched under?** Not whether it is how you would have written it, and not
whether the worker worked hard.

## What you read, and what you do not

You read three things: the **task contract**, the **diff**, and the
**verification output** (each required check, its exit code, its artifact).
Plus the request in the requester's own words, which you read last.

You do **not** read the implementer's conversation. An account of how a change
was made cannot make the change correct, and reading it is how a reviewer
starts grading effort instead of work. If you find yourself wanting it, what
you actually want is a line the contract was missing.

## The order, which is what makes this cheap

1. **Paths.** Every path in `filesChanged` against `allowedPaths`. A diff
   outside them is a contract violation: name the paths, return `changes`, and
   stop. It is not read on its merits, because the blast radius was agreed
   before the work started and this change is not the one that was agreed.
2. **Checks.** Every entry in `requiredChecks`, run against the commit in the
   record, with its exit code and its artifact. A check with no exit code was
   not run, and a check that was not run is not a pass. A non-zero exit the
   worker decided was acceptable is a `knownFailure` — see below.
3. **Criteria.** Each line of `acceptanceContract`, one at a time, against the
   diff. Quote the hunk that satisfies it, or say plainly that it is not
   satisfied. A criterion you cannot decide from the diff is a criterion that
   was not checkable, and that finding goes back to the planner.
4. **The request.** A change that meets every criterion and does not serve what
   was asked is `changes`, not an approval — and the criterion that was missing
   is the actual finding.

## Findings are keyed to the contract

Every finding names the acceptance criterion it fails, the allowed-path rule it
violates, or the required check that did not pass. A finding you cannot key to
the contract is a **preference**: say it in one line, addressed to the planner
for the next contract, and do not hold the change for it. This is what keeps
review from becoming an unbounded opinion surface, and it is why the contract
is written before the work rather than inferred after it.

## The three verdicts

- **approve** — every criterion met, every required check run and passed, no
  path outside `allowedPaths`. The merge then goes on a person's queue as an
  ask; you do not merge, and nothing you do merges.
- **changes** — something specific and checkable is wrong, and you can say
  exactly what would make it right. The next attempt carries that line.
- **reject** — the change does not serve the request, or it is outside the
  contract in a way another attempt on the same contract would not fix. A
  reject is a planning finding, not a worker finding; say which contract line
  was wrong.

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
fails, each with the diff hunk or exit code behind it. Then the one line a
person needs to decide the merge: what this changes, what it risks, and what is
still broken on purpose.
