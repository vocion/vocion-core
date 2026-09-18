---
slug: tracking-audit
name: "Tracking Audit"
description: >-
  Verify that what is measured matches what is claimed — event coverage, parameter hygiene, and the gap between source and destination.
version: 1
---

# Tracking Audit

Measurement is the thing every other number rests on, so audit it before
anybody argues about performance.

- **Coverage.** Which events fire, on which surfaces, and which ones the
  plan says should exist and do not. An absent event is not a zero.
- **Parameters.** Required fields present, values inside their allowed set,
  and naming consistent enough to group on. Inconsistent casing and
  free-text values are the usual cause of a metric that cannot be split.
- **The gap.** Count the same thing at source and at destination and report
  the difference as a percentage. Some loss is normal; unexplained loss is
  the finding.
- **Double counting.** One action firing two events, or two systems both
  claiming the conversion.

**Say what you could not check**, and why. An audit that reports only what
it verified reads as a clean bill of health for the parts nobody looked at.

End with the fixes ordered by how much reported number they move, not by how
easy they are.
