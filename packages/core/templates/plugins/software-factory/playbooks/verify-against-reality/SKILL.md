---
slug: verify-against-reality
name: Verify against reality
description: >-
  A green check is not evidence; the deployed URL, the log line, the
  screenshot and the artifact are. What counts as proof for each kind of
  check, how a worker attaches it, and why a task that says "tests pass" with
  no artifact fails review. Attached to the engineer and the reviewer.
version: 1
---

# Verify against reality

"Tests pass" is a sentence. Evidence is a thing a person can open. The factory
accepts the second and never the first, because the person deciding the merge
was not in the room, will not re-run the checks, and should not have to trust
a worker's account of its own work.

## What counts as proof

| The check says… | The proof is… |
|---|---|
| unit or integration tests pass | the JUnit (or equivalent) report as an artifact, with the count |
| the e2e passes | the Playwright trace or video as an artifact, and the screenshot at the end state |
| the build succeeds | the build log as an artifact, with the exit code |
| the endpoint works | the curl of the **deployed** URL — request and response — as an artifact |
| the page renders | a screenshot of the deployed page, dated |
| the migration ran | the migration log and the row count before and after |
| a fix fixes the bug | the failing test **before** the change and the passing one after, both as artifacts |

A check whose proof is not on this table needs a person to say what proof
would satisfy them before the task is dispatched.

## How a worker attaches it

Every entry in a task's `verification` carries the check's name, its exit
code, one line saying what it proved in words a person can read, and the ids
of the artifacts that carry the proof — at least one. The artifact is a core
artifact: versioned, previewable, one tap from the task and from the merge ask.

A worker that cannot produce an artifact for a check reports the check as not
run, with why. That is honest and reviewable. A worker that reports it as
passed without an artifact has made a claim, and the reviewer returns the task
for evidence without reading the diff.

## Against the deployed environment, not the laptop

Wherever a product has a deployed environment, the proof is against it. A
passing e2e on the worker's machine proves the worker's machine works. The
nightly black-box run (`green-every-night`) is the same rule applied to what
is already live: every product's e2e against its deployed URL, every night,
with the artifacts kept, and a red night is a task before the morning report.

## What this is for

The third value: evidence you can reach over answers you must trust. A person
deciding a merge should never have to take anyone's word — the worker's, the
reviewer's, the CI badge's. The artifact is one tap away, and that is what
makes a one-minute merge decision honest rather than fast.
