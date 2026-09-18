---
slug: code-review
name: "Code Review"
description: >-
  Review for correctness, security and performance, with a failure scenario per finding.
version: 1
---

# Code Review

Every finding carries a **concrete failure scenario**: the input or state,
and the resulting wrong behaviour. A finding without one is a preference.

Priority order: correctness first, then security, then performance, then
maintainability. Style is last and should mostly be automated away.

Look specifically for: unhandled error paths, boundary conditions, queries
inside loops, unbounded growth, concurrency assumptions, unvalidated input
reaching a sink, and anything that silently swallows a failure.

Separate what must change from what would be nice. Mixing them means
neither gets the right attention.

Say what you did not review. A partial review presented as complete is how
things get through.
