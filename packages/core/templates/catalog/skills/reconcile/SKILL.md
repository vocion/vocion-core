---
slug: reconcile
name: "Reconcile"
description: >-
  Compare two sources against a match key and produce an exception list, never a silent merge.
version: 1
---

# Reconcile

Name both sources and which one is the source of record before you start.
Totals come from that one. Never sum across both.

Match on the authored key. Where only a weaker key is available — a name
rather than an identifier — the match is uncertain: keep the row in the
exception list marked as an unverified match rather than treating it as
matched or as missing.

Produce four buckets: matched, in source A only, in source B only, and
matched-but-different. The last one is where the real work is; show the
field, both values, and the difference.

An empty or truncated read is not a zero. If a source returned fewer rows
than expected, or was cut off, say so at the top and do not publish a total
you cannot defend.
