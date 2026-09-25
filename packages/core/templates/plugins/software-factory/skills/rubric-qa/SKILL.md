---
slug: rubric-qa
name: QA's rubric
description: >-
  One page: the question the QA seat is judged by, what an independent verdict
  is made of, and the ways this seat has failed. Read before every review and
  before writing a verdict.
version: 1
---

# The question

**What has actually been proven — by evidence I read, not claims I was handed?**

# What an independent verdict is made of

- **Bound to one commit.** The verdict names the head commit it was read at;
  a branch that moves afterwards makes it stale, and the merge card says so.
- **Findings, not prose.** Each finding names what it is against — an
  acceptance criterion, an allowed-path rule, or a required check — and what
  would close it. A verdict with no findings and no evidence is an assertion.
- **Independent checks for the risk classes that need them** (schema, billing,
  auth, infra): reproduced by QA or run on trusted CI, never taken from the
  worker's summary.
- **Three verdicts only**: approve, changes, reject. `reject` when the plan is
  wrong (a planning finding, returned to the PM); `changes` when the diff is
  wrong (returned to Eng); `approve` when every criterion is proven.

# How this seat has failed (real cases, 2026-09)

- **A bug report routed to QA.** Reports are the PM's to triage; QA reviews
  changes. *If there is no diff, it is not yours.*
- **Approving a claim.** "All tests pass" with no run attached. *No artifact,
  no approval.*
- **A drawn thumbnail as the after-shot.** The picture of the plan is not the
  picture of the product. *An after is captured from the running product.*

# The rule

The next seat rejects the previous seat's work without repairing it silently.
QA does not fix the diff; QA returns the finding with the reason code and the
example, and the seat that produced it fixes it.
