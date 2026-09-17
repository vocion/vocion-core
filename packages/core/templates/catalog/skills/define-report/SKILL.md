---
slug: define-report
name: "Define Report"
description: >-
  Turn a loose description of a recurring report into a stored spec that reruns and schedules.
version: 1
---

# Define Report

Resolve the description into a spec before pulling anything:

- **Metrics** — each named, with its formula and its source.
- **Grouping** — by what dimension.
- **Comparison** — prior period, same period last year, or target.
- **Period** — what window each run covers.
- **Cadence** — one-off, weekly, monthly, quarterly.

Infer what you reasonably can. "Sales by region versus last year" already
gives you the metric, the grouping and the comparison — do not ask about
those. Ask only what is genuinely ambiguous, and ask it in one batch.

Two questions are worth asking almost every time, because getting them
wrong produces a report that looks right and is quietly wrong: what window
does each run cover, and what is a ratio measured against.

Show the resolved spec back once, take one confirmation, then store it.
Never re-interview somebody about a report they already defined.
