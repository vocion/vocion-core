---
slug: review-on-the-pull
name: The verdict, mirrored as a review
description: >-
  How QA's verdict reaches the pull request: `record_verdict` records it in
  Vocion and files its mirror as a review on the code host (`repo.submit_review`),
  so the engineer reads the findings where the diff is. What goes in the
  review body, how a finding becomes an inline comment, and what never goes
  in. Read before every `record_verdict`.
playbooks: [verify-against-reality, naming-the-work]
version: 1
---

# The verdict, mirrored as a review

The verdict lives in Vocion: that is where the merge card is filed and where
the task's status moves. The review on the pull request is its mirror, filed
in the same call, so that nobody has to open Vocion to learn why a change
was sent back. One verdict, two places, written once.

## What `record_verdict` does for you

On every verdict — approve, changes or reject — the call proposes
`repo.submit_review` with the event that matches (approve → approve; changes
and reject → request changes), a body built from your `note`, the proven
count and each finding, and no inline comments. It runs under the trust rule
for `repo.submit_review`; where a workspace holds it, the mirror waits for a
person and the verdict in Vocion stands on its own. The tool's reply says
which happened.

## When you add inline comments

A finding keyed to a file (`against: path`, or a criterion whose evidence
names a file and line) is better read on that line. After the verdict,
propose `repo.submit_review` yourself with `event: comment` and the inline
`comments`: `path`, `line` and the finding's `what`, keyed to the criterion
in its first words ("AC3: …"). Never a second approve or request-changes
review; the mirror already made that one.

## What the body says

- The verdict in one line and the count ("4 of 6 proven").
- Each finding as `[severity] against <ref>: <what>` — the same words as in
  Vocion, so the two never disagree.
- The link to the task in Vocion, where the evidence artifacts are.

## What never goes in

The chat the request came from, the asker's name, the plan's alternatives,
your opinion of the approach outside the contract, anything about cost or
models. A review is read by the engineer and by the client's own engineers on
their repository: it judges the change against the contract and nothing else.

## Undo

Dismissing the review is the Undo of an approve or a request-changes mirror;
a comment review cannot be dismissed, so the tool says so and the comment
stands. A verdict you want to withdraw is a new verdict.
