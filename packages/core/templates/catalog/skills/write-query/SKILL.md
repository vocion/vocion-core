---
slug: write-query
name: "Write Query"
description: >-
  Turn a stated need into dialect-correct SQL with its assumptions written down.
version: 1
---

# Write Query

Confirm the shape of the tables before writing — column names, types, grain,
and what one row represents. Most wrong queries are right against a
different schema.

Write for the dialect in use. Date handling, window functions and string
operations differ enough to silently produce wrong answers rather than
errors.

**State the assumptions with the query**: the grain, how nulls are treated,
whether duplicates are possible, the time zone, and the period boundaries.
These are where results diverge from what somebody expected.

Prefer explicit joins and named CTEs over cleverness. Somebody will read
this in six months.
