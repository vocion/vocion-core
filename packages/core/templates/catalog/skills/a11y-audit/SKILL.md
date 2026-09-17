---
slug: a11y-audit
name: "Accessibility Audit"
description: >-
  Test against the authored conformance target and report each failure with its fix.
version: 1
---

# Accessibility Audit

Test against the target in force, and say which it is.

Cover at minimum: contrast for text and meaningful non-text, keyboard
reachability and visible focus, target size, semantic structure and heading
order, labels and names for every control, status messages, and behaviour
at high zoom.

Per failure: the criterion, where it occurs, what a user experiences, and
the specific fix. A criterion reference with no consequence attached gets
triaged as paperwork.

Distinguish failures from improvements. A conformance failure and a
suggestion are different obligations and must not be mixed in one list.

**Colour alone is never sufficient** to carry meaning — check that
separately, because automated tools miss it.
