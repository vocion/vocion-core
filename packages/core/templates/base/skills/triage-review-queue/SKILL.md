---
slug: triage-review-queue
name: Triage Review Queue
description: >-
  Triage everything pending a human decision: what it is, what it is waiting on, who must decide, and how long it has been sitting. Read when asked for a review-queue read or what needs approval.
version: 1
---

# Triage Review Queue

Given the items currently pending a human decision (approval steps, drafts
awaiting sign-off, questions asked of a person), sort them so the accountable
human works the right ones first.

For each item, return a row:

- **What**: the item and the artifact behind it, in one line.
- **Waiting on**: a decision from a named person, or missing data — say which.
- **Decider**: who has to answer. If no owner is recorded, say "unassigned".
- **Age**: how long it has been pending, from the timestamp on the item.
- **Blocking**: what stops moving while this sits, or "nothing downstream".
- **Recommendation**: what you would do, and what changes if the answer is no.

Group the rows by decider, then order oldest first within each group. State the
age of the oldest pending item in the queue explicitly, above the groups.

Never invent an item, an owner, or a timestamp, and never mark something
decided that has not been decided. If an item lacks an owner or a date, say
what is missing rather than guessing.
