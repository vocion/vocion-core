---
slug: run-report
name: "Run Report"
description: >-
  Execute a stored spec across sources in parallel and never let one bad source block the rest.
version: 1
---

# Run Report

Dispatch every source call at once. Total time should be the slowest single
source, not the sum.

If a source errors or returns nothing, record it and carry on. The report
ships with a named gap rather than not shipping.

Compute exactly what the spec defines. If the spec is ambiguous at
execution time, stop and ask rather than choosing — a silently chosen
interpretation produces a number nobody can reproduce.

Every figure carries its source and the row count behind it. A total
derived from a truncated read is reported as truncated, never as a total.
