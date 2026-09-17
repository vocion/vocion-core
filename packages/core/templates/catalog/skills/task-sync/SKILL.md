---
slug: task-sync
name: "Task Sync"
description: >-
  Diff an external tracker against the working task list and triage what has gone stale.
version: 1
---

# Task Sync

Pull what is assigned and open, then diff against the working list:

- In the tracker, not on the list → offer to add.
- On both → leave alone. Match on title fuzzily; minor wording differences
  are not new tasks.
- On the list, not in the tracker → flag as possibly stale.
- Closed in the tracker, open on the list → offer to close.

Then triage the list itself: anything past its date, anything sitting more
than thirty days, anything with no context attached.

Present the diff and let a person decide each one. Never sync silently in
either direction.
