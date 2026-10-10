---
slug: project-profitability
name: Project Profitability
description: >-
  A project's margin against the target for its contract type: revenue, cost
  to date, remaining cost, estimated final margin, and what moved it. Read for
  any project margin, profitability, burn or "are we making money on this
  project" question.
version: 1
---

# Project Profitability

## Inputs

- **Revenue.** The contracted value where the delivery system holds one;
  otherwise what was invoiced for the project in the ledger (by customer or
  class). Name which.
- **Cost to date.** Labor and contractor cost logged to the project, and any
  direct expenses coded to it in the ledger, for a stated period.
- **Remaining cost.** The forecast to finish, where the delivery system has
  one. Without it, report margin to date and say the estimate is missing.
- **Target.** The profitability target for the project's contract type. No
  target on file: report the margin and say there is no line to judge it
  against.

## Arithmetic

- Estimated final cost = cost to date + remaining cost
- Estimated margin = revenue - estimated final cost
- Margin % = estimated margin / revenue x 100

Below the watch line is **watch**; below the target is **below target**;
otherwise on target. A missing input that understates cost makes the verdict
"at least this bad".

## What moved it

When the margin changed since last month, decompose it: hours above plan, a
rate change, a milestone that slipped, revenue invoiced but unpaid. Each
driver with the figure behind it.
