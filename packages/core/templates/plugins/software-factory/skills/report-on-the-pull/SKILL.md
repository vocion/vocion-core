---
slug: report-on-the-pull
name: The report on the pull request
description: >-
  The shape of the engineer's report, written on the pull request where the
  reviewer and the person who merges read it: the request and the issue key,
  each acceptance criterion with how the diff meets it, the checks that ran
  and their result, every assumption the contract forced, and what is still
  broken. Read before opening the pull request and before any `repo.comment_pull`
  on it.
playbooks: [verify-against-reality, house-voice]
version: 1
---

# The report on the pull request

The run's structured output is for the machine. The pull request body is for
the two people who decide: the reviewer and the merger. They read it without
the conversation, without the worker's log and often on a phone. It says
everything they need and nothing else.

## The body

In this order, with these headings:

1. **What this is for** — the request's title and id, the issue key when
   there is one, the objective in one sentence.
2. **The change** — three to six lines on what was done and where, naming
   files only where a reader would open them.
3. **Acceptance** — the `acceptanceContract`, line by line, each followed by
   how the diff meets it and where to look (a file and line, a test name, a
   screenshot artifact). A line not met says *not met* and why.
4. **Checks** — each of `requiredChecks` with its result and the run's URL.
   A red check says what failed and whether it is the change's.
5. **Assumptions** — every decision the contract did not make, with what you
   chose and what the other choice was. This is the section the reviewer reads
   first.
6. **Still broken / known failures** — anything you saw and did not fix, with
   why it is outside this contract.
7. **Rollback** — one line: revert the pull request; anything else that would
   have to be undone (a migration, a config).

## After the first push

Read your own checks with `repo_read_check_logs` before the report says
anything about them. A later push that changes the picture gets a comment
(`repo.comment_pull`), not a rewritten body: the comment names what changed
since the last report and which acceptance lines it affects. Undo deletes it.

## What is never in it

Model names, token counts, run ids, the conversation, the worker's host, an
apology. The reviewer judges the change against the contract; everything in
the report is there to make that judgment faster.
