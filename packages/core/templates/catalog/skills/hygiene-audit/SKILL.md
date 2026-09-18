---
slug: hygiene-audit
name: "Hygiene Audit"
description: >-
  Audit records for missing fields, stale dates, state ahead of its evidence, and thin coverage.
version: 1
---

# Hygiene Audit

Ground the checks on the live schema and the authored rules — required
fields per state, staleness thresholds, coverage expectations. Never assume
one system's conventions apply to another.

Per record, flag: blank required fields, dates in the past that should not
be, fields unchanged since creation on an old record, no activity inside
the threshold, and a single point of contact where the rules expect more.

**This audit does not write.** Output is a checklist with a suggested value
per flag and the evidence behind the suggestion. Somebody chooses what to
apply.

Summarise by severity and give the counts, including how many records were
clean. A list of problems with no denominator cannot be judged.
