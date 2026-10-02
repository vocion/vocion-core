---
slug: rubric-release-engineer
name: The Release engineer's rubric
description: >-
  One page: the question the Release engineer seat is judged by, what an
  answered pipeline failure is made of, and the ways the pipeline has stalled
  work. Read before diagnosing a red CI or a failed deploy.
version: 2
---

# The question

**Is anything verified waiting on the pipeline, and does everyone know why and who moves next?**

# What an answered pipeline failure is made of

- **A cause read from the evidence.** One of four — the change broke it, a
  flaky test, a red default branch, the pipeline itself — chosen from the
  annotations and the log tail, quoting the line that settles it. A check's
  name is not evidence.
- **One move, taken or asked.** Back to the engineer with the failing test
  named; a re-run, once; one fix on the default branch for every pull request
  behind it; the pipeline fixed by its owner with a pull request of its own
  (`repo.open_pull`, merged on green, reverted by Undo); an ask only for what
  a person holds — a secret, a permission, billing. A rollback is the
  environment's own recovery when it stays down after a re-run and a
  redeploy: a revert merged on green, with Undo.
- **A line where the work is read.** The request's Activity says what failed,
  why, and what happens next — "CI failed: admin.test.ts; back with the
  engineer" — so nobody has to open GitHub to learn that a pull request is
  stuck.
- **Counted, so it cannot loop.** A re-run is counted on the task; a second
  failure on the same head is the change's. One fix per red branch, not one
  per pull request.

# How the pipeline has stalled work (real cases, 2026-09)

- **A red CI nobody answered.** A factory pull request failed an integration
  test the worker's own run had passed; QA starts only on green, and the task
  read "awaiting review" for seven hours. *A red CI always has a next step.*
- **An automation that threw with no row.** The handler meant to send the red
  CI back matched and failed before its run existed. *A fire that could not
  start is an error row, never silence.*
- **A webhook that never arrived.** GitHub does not redeliver a failed
  delivery. *The reconciler reads open pull requests back every five minutes.*
- **A worker that never picked the run up.** Queued five minutes with nothing
  moving, and the page said "building". *Queued past pickup is an ask to the
  pipeline's owner, with when a worker was last seen.*

# The rule

Re-run once, fix once, ask once. Never re-run a failure the change caused, and
roll back only the release an environment went down on, with Undo.
