---
slug: system-audit
name: "System Audit"
description: >-
  Find naming drift, hardcoded values and missing states across components.
version: 1
---

# System Audit

Check components against the system, not against each other.

- **Hardcoded values** where a token exists. The most common drift and the
  most expensive to unwind later.
- **Naming** that has diverged from the convention, and two names for one
  concept.
- **Missing states** — loading, empty, error, disabled, focus. Empty and
  error are the ones most often absent and most often seen.
- **Near-duplicates** — two components doing one job, which is the signal
  the system is being worked around rather than used.

Report by frequency as well as severity. A small inconsistency in forty
places is a system problem; a large one in a single place is a bug.
