---
slug: bulk-update
name: "Bulk Update"
description: >-
  Apply one change across many records under a single approval, with the full list shown first.
version: 1
---

# Bulk Update

Show the complete list before anything is applied: every record, its
current value, its proposed value. If the list is long, show the counts and
a sample, and make the full list available — never apply what was not shown.

**One approval covers one batch.** Adding a record or changing the proposed
value after approval starts a new round. Silent scope growth after a yes is
the failure mode this rule exists to prevent.

Apply in order and report as you go. On failure, stop, report the exact
error, and say plainly which records changed and which did not. A partial
batch that reports as complete is worse than one that fails loudly.

Verify by re-reading a sample afterwards and confirm the count that changed.
