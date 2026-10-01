---
slug: explain-a-red-check
name: Explaining a red check on the pull request
description: >-
  The two lines the Release engineer writes on a pull request whose check is
  red: which of the four causes it is, quoting the log line that settles it,
  and the one move that answers it. Where the explanation goes
  (`repo.comment_pull`), what it is never allowed to be, and how it is kept to
  one comment per head. Read whenever a check is red and a person or the
  engineer will read the pull request before Vocion.
playbooks: [verify-against-reality, house-voice]
version: 1
---

# Explaining a red check on the pull request

The diagnosis lives on the task (`ciDiagnosis`) and the move is already
routed. The engineer and the client's reviewers do not read the task; they
read the pull request. Two lines there save a conversation.

## Read first

`repo_read_check_logs` with the pull request URL (or the run URL): the failing
checks, the annotations, the failing step and its log tail, and whether the
base branch is red too. The explanation quotes from this and from nothing
else — not the check's name, not the engineer's report, not memory.

## The two lines

Line one: the cause, from the four, with the quote.

- **The change broke it** — "`admin.test.ts` fails on the new column: `TypeError: cannot read 'id'` (line 41). It is the change's."
- **Flaky** — "`e2e-checkout` timed out waiting for the browser; green on main at the same commit. Unrelated to the change."
- **The default branch is broken** — "`lint` fails on main too (run #412). Not this pull request's."
- **The pipeline could not run** — "The runner lost the Docker service before the first step (`Cannot connect to the Docker daemon`)."

Line two: the move, and who makes it.

- back to the engineer, the failing test named;
- re-run once (`repo.rerun_failed_checks`, done for you) — say that it was;
- one fix on the default branch, listing the pull requests it blocks;
- the pipeline fixed by this seat (`repo.open_pull`), with the change's URL
  once it is open;
- an ask to a person for what only they hold (a secret, a permission,
  billing), named exactly.

## Where it goes

`propose_action` `repo.comment_pull` with the pull request URL and the two
lines; `recordId` the task or request so the same line lands on its Activity.
Done for you; Undo deletes it. One comment per head: a new push gets a new
comment only if the cause changed. The same two lines are the answer when a
person asks in chat.

## Never

A paragraph. A guess dressed as a cause. "Looks flaky, re-running" without
the base-branch read that makes it flaky. A comment on a pull request the
factory did not open, unless a person asked for one.
