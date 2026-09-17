---
slug: review-against-standard
name: "Review Against Standard"
description: >-
  Compare an artifact against an authored standard and report deviations by severity, each with a specific fix.
version: 1
---

# Review Against Standard

The standard is handed to you — a playbook, a design system, a code
standard, a set of contract positions. You do not invent it and you do not
soften it.

For each deviation:
- **What** — quote the exact text, clause, value or line.
- **Severity** — against the bands in the standard, not your own judgement.
- **Why it matters** — the concrete consequence, not a principle.
- **The fix** — specific and applyable. Proposed language, not "consider revising".
- **The fallback** — where the standard names one, what to accept instead.

Order by severity, highest first. Say explicitly what you checked and found
compliant, so silence never reads as "not looked at". Where the standard is
silent on something that looks wrong, say so separately and flag it as
outside the standard rather than inventing a rule to hang it on.
