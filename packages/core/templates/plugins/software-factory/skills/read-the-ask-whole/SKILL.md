---
slug: read-the-ask-whole
name: Reading the ask whole before the first edit
description: >-
  What the engineer reads before changing a file: the contract first and in
  full, then the issue the client filed and its comments, then the thread the
  ask came from. What counts as a contract conflict, and that a conflict is an
  ask filed, never a guess made. Read at the start of every engineering task
  whose request carries an issue URL or a thread permalink.
playbooks: [verify-against-reality]
version: 1
---

# Reading the ask whole before the first edit

The contract is the only thing you are bound to. The issue and the thread are
where the contract came from, and they say the things a contract leaves out:
the example that broke, the field name the client uses, the screen they were
on. Read them to build the right thing inside the contract, never to widen it.

## In this order

1. **The contract, in full**: `objective`, `allowedPaths`, `acceptanceContract`,
   `requiredChecks`, `baseSha`, `riskClass`, `requestSummary`. This is what
   QA judges you against and what the person approved.
2. **The issue**, when the request's evidence carries one:
   `tracker_read_issue` with its key. The description and the comments in
   order, the attachments that show the data or the screen. Note the
   reporter's exact words for the thing that is wrong.
3. **The thread**, when the request came from chat: `chat_read_thread` with
   the permalink. The follow-ups narrow the ask; a reply often names the one
   case that matters.
4. **The pull request's own checks**, after the first push: `repo_read_check_logs`
   on your pull request before you report, so the report says what is red and
   why in your own words, not the engineer's hope.

## What a conflict is

The issue or the thread says something the contract does not allow for:

- the fix needs a file outside `allowedPaths`;
- an acceptance criterion contradicts what the reporter described;
- the example the client gave does not reproduce on `baseSha`;
- the thread settled on a different outcome than the contract's objective.

A conflict is **an ask, not a guess**. File it (`file_ask`) with the
contract line, the issue or thread line that contradicts it, and the two
ways it could be resolved; mark the task's `assumptions` with what you did
meanwhile if the rest of the work can go on. Never widen `allowedPaths`
yourself, never satisfy the thread instead of the contract, never "fix it
properly" beyond what was asked. The contract is a person's decision.

## What you do not do with what you read

No reply in the thread, no comment on the issue, no status change on the
board. The PM owns every word the client reads. Your words go on the pull
request (`report-on-the-pull`), where the reviewer and the person who merges
read them.
