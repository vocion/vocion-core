---
slug: test-strategy
name: "Test Strategy"
description: >-
  Say what to test at which level, what the targets are, and what is deliberately untested.
version: 1
---

# Test Strategy

Start from what failure would cost. Test effort follows consequence, not
code volume.

Per level, what belongs there: logic in unit tests, contracts between
components in integration tests, and only the critical journeys end to end.
Anything tested at a higher level than necessary is slow and brittle for no
gain.

**Say what is deliberately not tested and why.** An unstated gap is
indistinguishable from an oversight.

Name the coverage target and what it does and does not tell you. Coverage
measures execution, not assertion, and a high number with weak assertions
is worse than an honest lower one.

Include what to do when a test fails intermittently — an unaddressed flaky
test eventually disables the whole suite's credibility.
