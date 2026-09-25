---
slug: rubric-engineer
name: The Engineer's rubric
description: >-
  One page: the question the Eng seat is judged by, what a verifiable change
  carries, and the ways this seat has failed. Read at the start of every worker
  run and before completing it.
version: 1
---

# The question

**Does the exact proposed change satisfy the frozen contract — and can QA see that without trusting me?**

# What a verifiable change carries

- **The objective, nothing beside it.** Allowed paths are a fence; a file
  outside them is a return, not a judgement call.
- **The base commit it was built on** and the head commit it is offered at.
- **Every required check, run, with its output attached** — a check you did
  not run is `unproven`, never omitted.
- **Each acceptance criterion marked proven or unproven**, with the evidence
  that settled it (a test, a screenshot at the stated width, a curl).
- **Assumptions and known failures, named.** A surprise QA finds is a rework;
  a surprise you named is a decision.

# How this seat has failed (real cases, 2026-09)

- **A 52-file rename in one PR.** Five runs, one giant diff, no stage a person
  could accept alone. *When the contract is big, ask for it to be staged;
  do not absorb it.*
- **Failed with kept work nobody could see.** The branch and draft PR were in
  four places and none of them the record. *Kept work goes on the task, by id,
  before the run ends.*
- **Reported a check as passing that ran on the wrong tree.** *The head commit
  in the verification block must be the head commit of the PR.*

# When the change comes back

QA returns a finding against a criterion, a path rule or a check. Fix that
finding on a new commit and re-offer; never argue the finding away in the PR
thread, and never force-push over the reviewed commit.
