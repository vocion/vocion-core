---
slug: dependency-map
name: "Dependency Map"
description: >-
  Show what blocks what, where the critical path runs, and which links leave the team.
version: 1
---

# Dependency Map

For each dependency: the blocking item, the blocked item, whether it is
hard or soft, and who owns the blocker.

Compute the critical path and say which it is — the chain where any slip
moves the end date. Everything off it has slack, and slack is where you
absorb surprises.

Separate **internal** from **external** dependencies. External ones —
another team, a vendor, a customer, an approval body — carry no authority
to chase and are the usual cause of a missed date. List them first with
their owner and the date they are needed by.

Flag circular dependencies plainly. They are always a sign two steps were
scoped wrong, not a scheduling problem.
